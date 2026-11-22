const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * "Coming soon" events (owner, 2026-11-17), end to end against the database,
 * in review-first mode (test/helpers/reviewMode.js):
 *
 *   a teaser publishes with a title, a city, a cover and a month — no venue,
 *   no tickets, no payment; buyers see it, cannot buy, and can ask to be told;
 *   opening its sales runs the full checks and waits for an admin, who can
 *   decline (the teaser stays live) or approve (it goes on sale).
 */

let server; let baseUrl;
const cleanup = { profiles: [], organizers: [], events: [] };
const PASSWORD = 'a-perfectly-long-passphrase';
const stamp = Date.now();
const ORG_EMAIL = `cs-org-${stamp}@eventsli-test.invalid`;
const ADMIN_EMAIL = `cs-adm-${stamp}@eventsli-test.invalid`;

function client() {
  let cookie = null;
  return async function call(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

const organizer = client();
const admin = client();
const buyer = client();
let eventId;
let slug;

/** The month after next, as the whole month in Toronto — a teaser's rough date. */
function roughMonth() {
  const d = new Date();
  const y = d.getUTCFullYear() + (d.getUTCMonth() + 2 > 11 ? 1 : 0);
  const m = (d.getUTCMonth() + 2) % 12;      // 0-based
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const mm = String(m + 1).padStart(2, '0');
  // Toronto is UTC-5 or UTC-4; asking the API's own rule which applies would
  // be circular, so the instants are built from the zone's offset at the time.
  const offset = (iso) => {
    const at = new Date(iso);
    const local = new Date(at.toLocaleString('en-US', { timeZone: 'America/Toronto' }));
    const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
    return utc - local;
  };
  const start = new Date(`${y}-${mm}-01T00:00:00Z`);
  const end = new Date(`${y}-${mm}-${last}T23:59:00Z`);
  return {
    startsAt: new Date(start.getTime() + offset(start)).toISOString(),
    endsAt: new Date(end.getTime() + offset(end)).toISOString(),
    ym: `${y}-${mm}`,
    exactStart: new Date(`${y}-${mm}-14T23:00:00Z`).toISOString(),
    exactEnd: new Date(`${y}-${mm}-15T03:00:00Z`).toISOString(),
  };
}
const month = roughMonth();

before(async () => {
  await require('../helpers/reviewMode').requireReview();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const o = await organizer('POST', '/auth/register', { email: ORG_EMAIL, password: PASSWORD, fullName: 'Teaser Owner' });
  cleanup.profiles.push(o.body.data.id);
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', o.body.data.id);
  await organizer('POST', '/auth/login', { email: ORG_EMAIL, password: PASSWORD });
  const org = await organizer('POST', '/organizer', {
    displayName: 'Teaser Events Co', legalName: 'Teaser Events Ltd.', country: 'CA', acceptPolicies: true,
    description: 'Runs the events this integration suite creates and deletes.',
  });
  assert.equal(org.status, 201, JSON.stringify(org.body));
  cleanup.organizers.push(org.body.data.id);

  const a = await admin('POST', '/auth/register', { email: ADMIN_EMAIL, password: PASSWORD, fullName: 'Teaser Admin' });
  cleanup.profiles.push(a.body.data.id);
  await supabase.from('profiles')
    .update({ role: 'admin', email_verified_at: new Date().toISOString() })
    .eq('id', a.body.data.id);
  await admin('POST', '/auth/login', { email: ADMIN_EMAIL, password: PASSWORD });
});

after(async () => {
  for (const id of cleanup.events) await supabase.from('events').delete().eq('id', id);
  for (const id of cleanup.organizers) {
    await supabase.from('organizer_payment_methods').delete().eq('organizer_id', id);
    await supabase.from('organizers').delete().eq('id', id);
  }
  for (const id of cleanup.profiles) {
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

test('a teaser is created with a title, a city and a month', async () => {
  const res = await organizer('POST', '/events', {
    title: `Teaser Fest ${stamp}`, country: 'CA', timezone: 'America/Toronto', city: 'Toronto',
    startsAt: month.startsAt, endsAt: month.endsAt, comingSoon: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  eventId = res.body.data.id;
  slug = res.body.data.slug;
  cleanup.events.push(eventId);
  assert.equal(res.body.data.comingSoon, true);
  assert.equal(res.body.data.status, 'draft');
  assert.equal(res.body.data.roughMonth, month.ym, 'the whole month reads back as the rough date');
});

test('publishing asks for a cover, never for a venue, tickets or payment', async () => {
  const preview = await organizer('GET', `/events/${eventId}/submission-preview`);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.data.mode, 'teaser');
  const messages = preview.body.data.blockers.map((b) => b.message).join(' | ');
  assert.match(messages, /cover image/);
  assert.doesNotMatch(messages, /venue|street address|payment/i);

  // The cover upload goes through storage; stand in for it on the row.
  await supabase.from('events').update({ cover_url: 'https://example.invalid/cover.jpg', cover_path: 'x.jpg' }).eq('id', eventId);
  assert.equal((await organizer('POST', `/events/${eventId}/accept-terms`)).status, 200);

  const submit = await organizer('POST', `/events/${eventId}/submit`);
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  assert.equal(submit.body.data.status, 'pending_review');

  const queue = await admin('GET', '/admin/approvals?limit=100');
  const row = queue.body.data.find((e) => e.id === eventId);
  assert.equal(row?.request, 'coming_soon');

  const ok = await admin('POST', `/admin/events/${eventId}/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('buyers see a teaser, cannot buy it, and can ask to be told', async () => {
  const page = await buyer('GET', `/public/events/${slug}`);
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.equal(page.body.data.comingSoon, true);
  assert.equal(page.body.data.purchasable, false);
  assert.deepEqual(page.body.data.tiers, []);

  const list = await buyer('GET', '/public/events?limit=100&city=Toronto');
  assert.ok(list.body.data.some((e) => e.slug === slug && e.comingSoon), 'listed, flagged');
  const onSale = await buyer('GET', '/public/events?limit=100&city=Toronto&onSale=true');
  assert.ok(!onSale.body.data.some((e) => e.slug === slug), 'not under "Tickets on sale"');

  const hold = await buyer('POST', `/public/events/${slug}/hold`, {
    lines: [{ tierId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
  });
  assert.equal(hold.status, 403, JSON.stringify(hold.body));

  // The database refuses a reservation too, whatever calls it.
  const { error } = await supabase.from('reservations')
    .insert({ event_id: eventId, state: 'active', expires_at: new Date(Date.now() + 600e3).toISOString() });
  assert.match(error?.message || '', /not on sale yet/);

  assert.equal((await buyer('POST', `/public/events/${slug}/notify`, { email: 'Fan@Example.com' })).status, 200);
  assert.equal((await buyer('POST', `/public/events/${slug}/notify`, { email: 'fan@example.com' })).status, 200,
    'signing up twice is the same answer');
  assert.equal((await buyer('POST', `/public/events/${slug}/notify`, { email: 'nope' })).status, 400);

  const me = await organizer('GET', `/events/${eventId}`);
  assert.equal(me.body.data.notifyCount, 1, 'one person, however they spelled it');
});

test('a live teaser is edited freely but only goes on sale through open-sales', async () => {
  const edit = await organizer('PATCH', `/events/${eventId}`, { description: 'More to come.', title: `Teaser Fest ${stamp}!` });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.data.status, 'published', 'and it stays live');

  const flip = await organizer('PATCH', `/events/${eventId}`, { comingSoon: false });
  assert.equal(flip.status, 409);
  assert.equal(flip.body.meta?.reason, 'COMING_SOON_LOCKED');

  // Not ready to sell, so refused. Since 2026-11-22 the venue is optional, so
  // the refusal names the next thing missing (a way to pay), not the venue.
  const early = await organizer('POST', `/events/${eventId}/open-sales`);
  assert.ok(early.status >= 400 && early.status < 500, JSON.stringify(early.body));
});

test('opening sales runs the full checks, waits for an admin, and can be declined', async () => {
  const filled = await organizer('PATCH', `/events/${eventId}`, {
    startsAt: month.exactStart, endsAt: month.exactEnd,
    venueName: 'Teaser Hall', venueAddress: '1 Test Street', admissionType: 'general',
  });
  assert.equal(filled.status, 200, JSON.stringify(filled.body));
  assert.equal(filled.body.data.roughMonth, null, 'exact times now');
  const tier = await organizer('POST', `/events/${eventId}/tiers`, { name: 'General', priceCents: 0, quantity: 50 });
  assert.equal(tier.status, 201, JSON.stringify(tier.body));

  const asked = await organizer('POST', `/events/${eventId}/open-sales`);
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  assert.equal(asked.body.data.salesOpenedDirectly, false);
  assert.ok(asked.body.data.launchRequestedAt);
  assert.equal(asked.body.data.comingSoon, true, 'still a teaser while it waits');

  // An edit takes the request back: the admin approves what they saw.
  const edited = await organizer('PATCH', `/events/${eventId}`, { description: 'Doors at 7.' });
  assert.equal(edited.body.data.launchRequestedAt, null);
  assert.equal(edited.body.meta?.launchWithdrawn, true);

  assert.equal((await organizer('POST', `/events/${eventId}/open-sales`)).status, 200);
  const queue = await admin('GET', '/admin/approvals?limit=100');
  assert.equal(queue.body.data.find((e) => e.id === eventId)?.request, 'open_sales');

  const declined = await admin('POST', `/admin/events/${eventId}/reject`, { reason: 'Add the age policy before opening sales.' });
  assert.equal(declined.status, 200, JSON.stringify(declined.body));
  assert.equal(declined.body.data.salesDeclined, true);
  const page = await buyer('GET', `/public/events/${slug}`);
  assert.equal(page.status, 200, 'the teaser stays live');
  assert.equal(page.body.data.comingSoon, true);
});

test('approved, it goes on sale and the notify list is closed', async () => {
  assert.equal((await organizer('POST', `/events/${eventId}/open-sales`)).status, 200);
  const ok = await admin('POST', `/admin/events/${eventId}/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.salesOpened, true);

  const page = await buyer('GET', `/public/events/${slug}`);
  assert.equal(page.body.data.comingSoon, false);
  assert.equal(page.body.data.purchasable, true);
  assert.equal(page.body.data.venue, 'Teaser Hall');

  const late = await buyer('POST', `/public/events/${slug}/notify`, { email: 'late@example.com' });
  assert.equal(late.status, 409);

  const { data } = await supabase.from('events').select('sales_opened_at, launch_requested_at').eq('id', eventId).single();
  assert.ok(data.sales_opened_at);
  assert.equal(data.launch_requested_at, null);
});
