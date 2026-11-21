const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const sessions = require('../../services/sessionService');
const portal = require('../../services/vendorPortalService');

/**
 * Vendor booking (2026-11-21, migration 20261204090000), against the real
 * database:
 *
 *   · instant mode HOLDS a booth: holds count against the quantity, a second
 *     vendor is refused the last one, and a released or lapsed hold frees it;
 *   · add-on prices come from the database and join the booth fee;
 *   · details must be complete (address, city, postal code, required
 *     documents) before signing; a hold is booked on signing when there is no
 *     card, and a card payment for a signed hold confirms it;
 *   · apply mode makes a DRAFT the organizer never sees until it is sent;
 *   · only the vendor reads or changes their booking.
 */

const stamp = Date.now();
const ACCOUNT = `acct_test_vbook_${stamp}`;
const ids = { profiles: [], organizer: null, event: null };
const tokens = {};
const emails = {};
let server; let base; let slug;

async function call(method, path, body, token) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function person(label, role = 'attendee') {
  const email = `vbook-${label}-${stamp}@eventsli-test.invalid`;
  const { data, error } = await supabase.from('profiles').insert({
    email, full_name: `Test ${label}`, role, email_verified_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(`seed ${label}: ${error.message}`);
  ids.profiles.push(data.id);
  const { token } = await sessions.issue(null, { userId: data.id, email, role, cookie: false });
  return { id: data.id, email, token };
}

const O = (path) => `/events/${ids.event}/vendors${path}`;
const B = (path = '') => `/partner/vendors/bookings${path}`;
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString();
const SIG = (name) => ({ method: 'typed', name });
const details = { businessName: 'Sweet Spot Bakery', address: '1 King St W', city: 'Toronto', postalCode: 'M5H 1A1', category: 'Food',
  socials: { instagram: '@sweetspot', website: 'ignored' } };

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const owner = await person('owner', 'organizer');
  tokens.owner = owner.token;
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: owner.id, display_name: 'Booking Org', country: 'CA', stripe_account_id: ACCOUNT,
  }).select('id').single();
  ids.organizer = org.id;
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `vbook-${stamp}`, title: 'Expo Booking', country: 'CA',
    timezone: 'America/Toronto', city: 'Toronto',
    starts_at: day(30), ends_at: new Date(Date.now() + 30 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    admission_type: 'general', purchase_mode: 'seat_only', max_tickets_per_order: 10,
  }).select('id, slug').single();
  if (error) throw new Error(`seed event: ${error.message}`);
  ids.event = ev.id;
  slug = ev.slug;

  for (const label of ['baker', 'florist', 'potter', 'stranger']) {
    const p = await person(label);
    tokens[label] = p.token;
    emails[label] = p.email;
  }
});

after(async () => {
  if (ids.event) {
    await supabase.from('vendor_applications').delete().eq('event_id', ids.event);
    await supabase.from('vendor_addons').delete().eq('event_id', ids.event);
    await supabase.from('vendor_booth_types').delete().eq('event_id', ids.event);
    await supabase.from('vendor_programs').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  await supabase.from('partner_companies').delete().in('created_by', ids.profiles);
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  await supabase.from('sessions').delete().in('user_id', ids.profiles);
  await supabase.from('profiles').delete().in('id', ids.profiles);
  await new Promise((r) => server.close(r));
});

let corner; let chair; let promo; let bakerHold;

test('the organizer sets instant booking, a required document, add-ons and a booth photo-less booth', async () => {
  const saved = await call('PUT', O('/program'), {
    isOpen: true, bookingMode: 'instant', holdMinutes: 15, categories: ['Food', 'Crafts'],
    documents: [{ id: 'insurance', label: 'Insurance certificate', required: true }, { label: 'Menu' }],
    highlights: [{ value: '80%', label: 'of exhibitors sell out' }, { value: '', label: 'dropped' }],
    defaultTerms: 'Arrive by 9am.',
  }, tokens.owner);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.bookingMode, 'instant');
  assert.deepEqual(saved.body.data.documents.map((d) => d.id), ['insurance', 'd2']);
  assert.equal(saved.body.data.highlights.length, 1);

  assert.equal((await call('PUT', O('/program'), { holdMinutes: 5 }, tokens.owner)).status, 400);

  corner = (await call('POST', O('/booths'), { name: 'Corner booth', priceCents: 50000, quantity: 1, staffPasses: 3, includes: ['Table'] }, tokens.owner)).body.data;
  chair = (await call('POST', O('/addons'), { name: 'Extra chair', priceCents: 500 }, tokens.owner)).body.data;
  promo = (await call('POST', O('/addons'), { name: 'Instagram story', kind: 'marketing', priceCents: 2500 }, tokens.owner)).body.data;
  const off = (await call('POST', O('/addons'), { name: 'Retired', priceCents: 100, isActive: false }, tokens.owner)).body.data;
  assert.equal(chair.kind, 'booth');

  const page = await call('GET', `/public/events/${slug}/vendors`);
  assert.equal(page.body.data.bookingMode, 'instant');
  assert.deepEqual(page.body.data.addons.map((a) => a.name).sort(), ['Extra chair', 'Instagram story']);
  assert.equal(page.body.data.documents[0].label, 'Insurance certificate');

  const bad = await call('POST', B(), { slug, boothTypeId: corner.id, addonIds: [off.id] }, tokens.baker);
  assert.equal(bad.status, 400);
});

test('a hold takes the last booth; add-on prices come from the database', async () => {
  const held = await call('POST', B(), { slug, boothTypeId: corner.id, addonIds: [chair.id, promo.id], priceCents: 1 }, tokens.baker);
  assert.equal(held.status, 201, JSON.stringify(held.body));
  bakerHold = held.body.data.id;

  const mine = await call('GET', B(`/${bakerHold}`), null, tokens.baker);
  assert.equal(mine.body.data.stage, 'held');
  assert.equal(mine.body.data.amountCents, 53000);
  assert.equal(mine.body.data.boothCents, 50000);
  assert.ok(mine.body.data.holdLive);
  assert.ok(mine.body.data.missing.includes('Insurance certificate'));

  assert.equal((await call('GET', B(`/${bakerHold}`), null, tokens.stranger)).status, 404);

  const second = await call('POST', B(), { slug, boothTypeId: corner.id }, tokens.florist);
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'VENDOR_SOLD_OUT');

  const booths = (await call('GET', O('/booths'), null, tokens.owner)).body.data;
  assert.equal(booths.find((b) => b.id === corner.id).held, 1);
  const board = (await call('GET', O('/applications'), null, tokens.owner)).body.data;
  assert.equal(board.applications.length, 0, 'a hold is not an application');
});

test('a lapsed hold frees the booth for the next vendor', async () => {
  await supabase.from('vendor_applications').update({ hold_expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', bakerHold);
  const florist = await call('POST', B(), { slug, boothTypeId: corner.id }, tokens.florist);
  assert.equal(florist.status, 201, JSON.stringify(florist.body));
  const { data } = await supabase.from('vendor_applications').select('stage').eq('id', bakerHold).single();
  assert.equal(data.stage, 'expired');

  const late = await call('PATCH', B(`/${bakerHold}`), details, tokens.baker);
  assert.equal(late.status, 409);
  // The florist lets it go; the baker can hold it again.
  assert.equal((await call('POST', B(`/${florist.body.data.id}/release`), {}, tokens.florist)).status, 200);
  const again = await call('POST', B(), { slug, boothTypeId: corner.id, addonIds: [chair.id] }, tokens.baker);
  assert.equal(again.status, 201, JSON.stringify(again.body));
  bakerHold = again.body.data.id;
});

test('details and required documents come before signing', async () => {
  const saved = await call('PATCH', B(`/${bakerHold}`), details, tokens.baker);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.data.business.socials, { instagram: 'sweetspot' });
  assert.equal((await call('PATCH', B(`/${bakerHold}`), { category: 'Jewels' }, tokens.baker)).status, 400);
  assert.equal((await call('PATCH', B(`/${bakerHold}`), { socials: { x: 'javascript:alert(1)' } }, tokens.baker)).status, 400);

  const early = await call('POST', B(`/${bakerHold}/checkout`), { signerName: 'Sam Baker', accept: true, signature: SIG('Sam Baker') }, tokens.baker);
  assert.equal(early.status, 400);
  assert.match(early.body.message, /Insurance certificate/);

  // A document recorded as the upload step would (storage is not part of this test).
  const path = `vendor-docs/${ids.event}/${bakerHold}/insurance-0123456789abcdef.pdf`;
  await supabase.from('vendor_applications').update({
    documents: [{ id: 'insurance', label: 'Insurance certificate', path, fileName: 'ins.pdf', status: 'pending' }],
  }).eq('id', bakerHold);
  const ready = (await call('GET', B(`/${bakerHold}`), null, tokens.baker)).body.data;
  assert.deepEqual(ready.missing, []);
  assert.equal(ready.documents[0].uploaded, true);
  assert.equal(ready.documents[0].path, undefined, 'the storage key stays on the server');
});

test('signing without card payment books the hold; the organizer reviews the document', async () => {
  const signed = await call('POST', B(`/${bakerHold}/checkout`), { signerName: 'Sam Baker', accept: true, signature: SIG('Sam Baker'), method: 'offline' }, tokens.baker);
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(signed.body.data.booked, true);
  const { data } = await supabase.from('vendor_applications').select('stage, paid_at, amount_cents, hold_expires_at').eq('id', bakerHold).single();
  assert.deepEqual(data, { stage: 'confirmed', paid_at: null, amount_cents: 50500, hold_expires_at: null });

  const board = (await call('GET', O('/applications'), null, tokens.owner)).body.data;
  assert.equal(board.applications.length, 1);
  const reviewed = await call('POST', O(`/applications/${bakerHold}/documents/insurance/review`), { status: 'rejected', note: 'Expired policy' }, tokens.owner);
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.data.documents[0].status, 'rejected');
  assert.equal(reviewed.body.data.documents[0].note, 'Expired policy');
  assert.equal(reviewed.body.data.address, '1 King St W');
});

test('a card payment for a signed hold confirms it', async () => {
  await supabase.from('vendor_applications').update({ stage: 'cancelled' }).eq('id', bakerHold);
  const held = await call('POST', B(), { slug, boothTypeId: corner.id, addonIds: [promo.id] }, tokens.potter);
  assert.equal(held.status, 201, JSON.stringify(held.body));
  const id = held.body.data.id;
  const { data: me } = await supabase.from('profiles').select('id').eq('email', emails.potter).single();
  const { error } = await supabase.rpc('vendor_sign_hold', {
    p_application_id: id, p_user_id: me.id, p_email: emails.potter, p_signer_name: 'Pat Potter',
    p_method: 'typed', p_svg: '<svg/>', p_sha256: 'x'.repeat(64), p_ip_hash: null, p_confirm: false,
  });
  assert.equal(error, null);
  await supabase.from('vendor_applications').update({ pending_session_id: `cs_vb_${stamp}`, pending_account_id: ACCOUNT }).eq('id', id);
  const session = { id: `cs_vb_${stamp}`, amount_total: 52500, payment_intent: `pi_vb_${stamp}`, metadata: { vendor_application_id: id } };
  assert.deepEqual(await portal.fulfilFromSession(session, { account: ACCOUNT }), { ok: true, alreadyPaid: false });
  const { data } = await supabase.from('vendor_applications').select('stage, paid_method, hold_expires_at').eq('id', id).single();
  assert.deepEqual(data, { stage: 'confirmed', paid_method: 'card', hold_expires_at: null });
});

test('apply mode: a draft stays out of the organizer’s board until it is sent', async () => {
  await call('PUT', O('/program'), { bookingMode: 'apply', documents: [] }, tokens.owner);
  const draft = await call('POST', B(), { slug, boothTypeId: corner.id, addonIds: [chair.id] }, tokens.florist);
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.data.mode, 'apply');
  const id = draft.body.data.id;
  const again = await call('POST', B(), { slug, boothTypeId: corner.id }, tokens.florist);
  assert.equal(again.body.data.id, id, 'one draft per vendor per event');

  const before = (await call('GET', O('/applications'), null, tokens.owner)).body.data.applications;
  assert.ok(!before.some((a) => a.id === id));

  assert.equal((await call('POST', B(`/${id}/submit`), {}, tokens.florist)).status, 400);
  await call('PATCH', B(`/${id}`), { ...details, businessName: 'Bloom' }, tokens.florist);
  const sent = await call('POST', B(`/${id}/submit`), {}, tokens.florist);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.data.stage, 'submitted');
  const board = (await call('GET', O('/applications'), null, tokens.owner)).body.data.applications;
  assert.ok(board.some((a) => a.id === id && a.businessName === 'Bloom'));
  assert.equal((await call('POST', B(), { slug, boothTypeId: corner.id }, tokens.florist)).status, 409);
});
