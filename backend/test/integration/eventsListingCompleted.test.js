const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * /events (owner, 2026-11-28): completed events stay listed, after the
 * upcoming ones and most recently finished first, with the total covering
 * both; and each card carries its sponsors and vendors — exactly the ones
 * its event page shows, never a private event's.
 *
 * Every event's title carries one made-up word, searched for, so the test
 * reads only its own events whatever else the database holds.
 */
let server; let base;
const stamp = Date.now();
const WORD = `Zephyr${stamp}`;
const ids = { events: [] };
const DAY = 86_400_000;

async function event(title, startOffsetDays, extra = {}) {
  const starts = Date.now() + startOffsetDays * DAY;
  const { data, error } = await supabase.from('events').insert({
    organizer_id: ids.organizer, slug: `listing-${title.toLowerCase().replace(/\W+/g, '-')}-${stamp}`, title: `${title} ${WORD}`,
    country: 'CA', timezone: 'America/Toronto', city: 'Toronto',
    starts_at: new Date(starts).toISOString(), ends_at: new Date(starts + 3 * 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: ids.terms,
    admission_type: 'general', purchase_mode: 'seat_only', max_tickets_per_order: 10, ...extra,
  }).select('id').single();
  if (error) throw new Error(`seed ${title}: ${error.message}`);
  ids.events.push(data.id);
  return data.id;
}

const list = async (qs) => {
  const res = await fetch(`${base}/public/events?q=${WORD}&${qs}`);
  return { status: res.status, body: await res.json() };
};

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const { data: profile } = await supabase.from('profiles').insert({
    email: `listing-${stamp}@eventsli-test.invalid`, full_name: 'Listing Org', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;
  const { data: org } = await supabase.from('organizers').insert({ owner_user_id: profile.id, display_name: 'Listing Org', country: 'CA' }).select('id').single();
  ids.organizer = org.id;
  const { data: terms } = await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single();
  ids.terms = terms.id;

  ids.soon = await event('Soon', 2);
  ids.later = await event('Later', 20);
  ids.lastWeek = await event('Last week', -7);
  ids.lastYear = await event('Last year', -300);

  const { error: sErr } = await supabase.from('event_sponsors').insert([
    { event_id: ids.soon, name: 'Partner Co', level: 'partner', sort_order: 0 },
    { event_id: ids.soon, name: 'Headline Bank', level: 'headline', sort_order: 1, logo_url: 'https://example.com/bank.png', logo_path: `events/${ids.soon}/bank.png` },
    { event_id: ids.lastWeek, name: 'Old Sponsor', level: 'gold', sort_order: 0 },
  ]);
  if (sErr) throw new Error(`sponsors: ${sErr.message}`);
  const vendor = (event_id, business_name, extra) => ({
    event_id, business_name, contact_email: `v-${stamp}@eventsli-test.invalid`, stage: 'confirmed', listed: true, paid_at: new Date().toISOString(), ...extra,
  });
  const { error } = await supabase.from('vendor_applications').insert([
    vendor(ids.soon, 'Taco Stand', { category: 'Food' }),
    vendor(ids.soon, 'Unpaid Booth', { paid_at: null }),
    vendor(ids.soon, 'Hidden Booth', { listed: false }),
    vendor(ids.soon, 'Pending Booth', { stage: 'submitted' }),
  ]);
  if (error) throw new Error(`vendors: ${error.message}`);
});

after(async () => {
  await supabase.from('vendor_applications').delete().in('event_id', ids.events);
  await supabase.from('event_sponsors').delete().in('event_id', ids.events);
  await supabase.from('events').delete().in('id', ids.events);
  await supabase.from('organizers').delete().eq('id', ids.organizer);
  await supabase.from('profiles').delete().eq('id', ids.profile);
  await new Promise((r) => server.close(r));
});

test('without withPast: finished events are left out, as before', async () => {
  const r = await list('');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.map((e) => e.id), [ids.soon, ids.later]);
});

test('withPast: upcoming soonest first, then completed most recent first, flagged past', async () => {
  const r = await list('withPast=true');
  assert.deepEqual(r.body.data.map((e) => e.id), [ids.soon, ids.later, ids.lastWeek, ids.lastYear]);
  assert.deepEqual(r.body.data.map((e) => e.isPast), [false, false, true, true]);
  assert.equal(r.body.pagination.total, 4);
});

test('pages cut across the seam between upcoming and completed', async () => {
  const one = await list('withPast=true&limit=3&page=1');
  assert.deepEqual(one.body.data.map((e) => e.id), [ids.soon, ids.later, ids.lastWeek]);
  const two = await list('withPast=true&limit=3&page=2');
  assert.deepEqual(two.body.data.map((e) => e.id), [ids.lastYear]);
  assert.equal(two.body.pagination.total, 4);
  const three = await list('withPast=true&limit=3&page=3');
  assert.equal(three.status, 200);
  assert.deepEqual(three.body.data, []);
});

test('"Tickets on sale" never lists a finished event', async () => {
  const r = await list('withPast=true&onSale=true');
  assert.deepEqual(r.body.data.map((e) => e.id), [ids.soon, ids.later]);
});

test('each card carries its listed sponsors (headline first) and its confirmed, paid, listed vendors', async () => {
  const r = await list('withPast=true&withPartners=true');
  const soon = r.body.data.find((e) => e.id === ids.soon);
  assert.deepEqual(soon.partners.sponsors.map((s) => [s.name, s.level]), [['Headline Bank', 'headline'], ['Partner Co', 'partner']]);
  assert.equal(soon.partners.sponsors[0].logoUrl, 'https://example.com/bank.png');
  assert.equal(soon.partners.sponsorCount, 2);
  assert.deepEqual(soon.partners.vendors, [{ name: 'Taco Stand', logoUrl: null, category: 'Food' }]);
  assert.equal(soon.partners.vendorCount, 1);
  const done = r.body.data.find((e) => e.id === ids.lastWeek);
  assert.deepEqual(done.partners.sponsors.map((s) => s.name), ['Old Sponsor']);
  const none = r.body.data.find((e) => e.id === ids.later);
  assert.deepEqual(none.partners, { sponsors: [], sponsorCount: 0, vendors: [], vendorCount: 0 });

  // Not asked for: not sent (the homepage's cards stay as they were).
  const plain = await list('withPast=true');
  assert.equal(plain.body.data[0].partners, undefined);
});

test('the flags are validated', async () => {
  assert.equal((await list('withPast=yes')).status, 400);
  assert.equal((await list('withPartners=1')).status, 400);
});
