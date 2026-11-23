const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const sessions = require('../../services/sessionService');
const portal = require('../../services/vendorPortalService');
const content = require('../../services/eventContentService');

/**
 * Vendors (2026-11-20), against the real database:
 *
 *   · applications open only while the organizer has the page on, and close
 *     at the deadline; required questions must be answered; once per address;
 *   · only the contact sees, accepts and pays an application;
 *   · a booth type never confirms past its quantity — enforced at acceptance;
 *   · an expired offer cannot be accepted; nothing is paid before acceptance;
 *   · staff names never exceed the booth's passes;
 *   · paid → in the public directory and on the event page; cancelled → gone;
 *   · a card payment counts only for the session and account we recorded.
 */

const stamp = Date.now();
const ACCOUNT = `acct_test_vendor_${stamp}`;
const ids = { profiles: [], organizer: null, otherOrganizer: null, event: null };
const tokens = {};
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
  const email = `vendor-${label}-${stamp}@eventsli-test.invalid`;
  const { data, error } = await supabase.from('profiles').insert({
    email, full_name: `Test ${label}`, role, email_verified_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(`seed ${label}: ${error.message}`);
  ids.profiles.push(data.id);
  const { token } = await sessions.issue(null, { userId: data.id, email, role, cookie: false });
  return { id: data.id, email, token };
}

const O = (path) => `/events/${ids.event}/vendors${path}`;
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString();
const SIG = (name) => ({ method: 'typed', name });

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const owner = await person('owner', 'organizer');
  tokens.owner = owner.token;
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: owner.id, display_name: 'Vendor Org', country: 'CA', stripe_account_id: ACCOUNT,
  }).select('id').single();
  ids.organizer = org.id;
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `vendor-main-${stamp}`, title: 'Vendor Market', country: 'CA',
    timezone: 'America/Toronto', city: 'Toronto',
    starts_at: day(30), ends_at: new Date(Date.now() + 30 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    admission_type: 'general', purchase_mode: 'seat_only', max_tickets_per_order: 10,
  }).select('id, slug').single();
  if (error) throw new Error(`seed event: ${error.message}`);
  ids.event = ev.id;
  slug = ev.slug;

  const rival = await person('rival', 'organizer');
  tokens.rival = rival.token;
  const { data: org2 } = await supabase.from('organizers').insert({ owner_user_id: rival.id, display_name: 'Rival', country: 'CA' }).select('id').single();
  ids.otherOrganizer = org2.id;

  for (const label of ['taco', 'merch', 'late', 'stranger']) {
    const p = await person(label);
    tokens[label] = p.token;
    ids[`${label}Email`] = p.email;
  }
});

after(async () => {
  if (ids.event) {
    await supabase.from('vendor_applications').delete().eq('event_id', ids.event);
    await supabase.from('vendor_booth_types').delete().eq('event_id', ids.event);
    await supabase.from('vendor_programs').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  await supabase.from('partner_companies').delete().in('created_by', ids.profiles);
  for (const id of [ids.organizer, ids.otherOrganizer].filter(Boolean)) await supabase.from('organizers').delete().eq('id', id);
  await supabase.from('sessions').delete().in('user_id', ids.profiles);
  await supabase.from('profiles').delete().in('id', ids.profiles);
  await new Promise((r) => server.close(r));
});

let truck; let stall; let tacoApp;
const form = (email, extra = {}) => ({
  businessName: 'Taco Town', contactName: 'Ana', contactEmail: email, category: 'Food',
  description: 'Street tacos and horchata from our truck.', answers: { power: true, menu: 'Tacos' }, ...extra,
});

test('the vendor page exists only while open; required questions are enforced', async () => {
  assert.equal((await call('GET', `/public/events/${slug}/vendors`)).status, 404);

  const saved = await call('PUT', O('/program'), {
    isOpen: true, headline: 'Sell at the market', categories: ['Food', 'Merch', 'Food', ' '],
    questions: [{ id: 'power', label: 'Do you need power?', type: 'yesno', required: true }, { id: 'menu', label: 'Menu', type: 'long' }],
    defaultTerms: 'Vendors arrive by 3pm.', paymentInstructions: 'E-transfer to market@example.com', vendorInfo: 'Load-in 2–4pm at Gate C.',
  }, tokens.owner);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.data.categories, ['Food', 'Merch']);
  assert.equal(saved.body.data.acceptingApplications, true);

  truck = (await call('POST', O('/booths'), { name: 'Food truck pitch', priceCents: 30000, quantity: 1, staffPasses: 2, includes: ['Power', 'Water'] }, tokens.owner)).body.data;
  stall = (await call('POST', O('/booths'), { name: '10×10 stall', priceCents: 0, staffPasses: 1 }, tokens.owner)).body.data;
  assert.equal(truck.remaining, 1);

  const page = await call('GET', `/public/events/${slug}/vendors`);
  assert.equal(page.status, 200);
  assert.deepEqual(page.body.data.booths.map((b) => b.name), ['Food truck pitch', '10×10 stall']);
  assert.equal(page.body.data.questions.length, 2);

  const missing = await call('POST', `/public/events/${slug}/vendors/applications`, form(ids.tacoEmail, { answers: {} }));
  assert.equal(missing.status, 400);
  assert.match(missing.body.message, /Do you need power/);
  const badCategory = await call('POST', `/public/events/${slug}/vendors/applications`, form(ids.tacoEmail, { category: 'Jewels' }));
  assert.equal(badCategory.status, 400);
});

test('an application becomes "New", once per address', async () => {
  const first = await call('POST', `/public/events/${slug}/vendors/applications`, form(ids.tacoEmail.toUpperCase(), { boothTypeId: truck.id }));
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const again = await call('POST', `/public/events/${slug}/vendors/applications`, form(ids.tacoEmail));
  assert.equal(again.body.data.duplicate, true);

  const board = (await call('GET', O('/applications'), null, tokens.owner)).body.data;
  assert.equal(board.applications.length, 1);
  const a = board.applications[0];
  assert.equal(a.status, 'submitted');
  assert.equal(a.requestedBoothName, 'Food truck pitch');
  tacoApp = a.id;
  const full = (await call('GET', O(`/applications/${tacoApp}`), null, tokens.owner)).body.data;
  assert.deepEqual(full.answers, [{ id: 'power', label: 'Do you need power?', answer: 'Yes' }, { id: 'menu', label: 'Menu', answer: 'Tacos' }]);

  assert.equal((await call('GET', O('/applications'), null, tokens.rival)).status, 404);
});

test('waitlist, then offer; only the contact sees it; nothing is paid before acceptance', async () => {
  assert.equal((await call('POST', O(`/applications/${tacoApp}/waitlist`), {}, tokens.owner)).body.data.stage, 'waitlisted');
  const offer = await call('POST', O(`/applications/${tacoApp}/offer`), {
    boothTypeId: truck.id, boothLabel: 'T1', terms: 'Truck terms.', expiresAt: day(5),
  }, tokens.owner);
  assert.equal(offer.status, 200, JSON.stringify(offer.body));
  assert.equal(offer.body.data.stage, 'offered');
  assert.equal(offer.body.data.amountCents, 30000, 'defaults to the booth price');
  assert.equal(offer.body.data.staffPasses, 2);

  assert.equal((await call('GET', `/partner/vendors/${tacoApp}`, null, tokens.stranger)).status, 404);
  const mine = await call('GET', '/partner/vendors', null, tokens.taco);
  assert.deepEqual(mine.body.data.map((x) => x.id), [tacoApp]);
  const view = (await call('GET', `/partner/vendors/${tacoApp}`, null, tokens.taco)).body.data;
  assert.equal(view.terms, 'Truck terms.');
  assert.equal(view.notes, undefined);

  const early = await call('POST', O(`/applications/${tacoApp}/paid`), { method: 'cash' }, tokens.owner);
  assert.equal(early.body.error, 'VENDOR_WRONG_STAGE');
  const staffEarly = await call('PATCH', `/partner/vendors/${tacoApp}`, { staff: ['Ana'] }, tokens.taco);
  assert.equal(staffEarly.body.error, 'VENDOR_WRONG_STAGE');
});

let merchApp;

test('a booth type never confirms past its quantity; an expired offer cannot be accepted', async () => {
  // A second vendor is offered the same one-pitch type.
  merchApp = (await call('POST', O('/applications'), { businessName: 'Merch Co', contactEmail: ids.merchEmail }, tokens.owner)).body.data.id;
  await call('POST', O(`/applications/${merchApp}/offer`), { boothTypeId: truck.id, terms: 'T.' }, tokens.owner);

  const accepted = await call('POST', `/partner/vendors/${tacoApp}/accept`, { signerName: 'Ana Ruiz', accept: true, signature: SIG('Ana Ruiz') }, tokens.taco);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.status, 'confirmed');
  assert.equal(accepted.body.data.payment.instructions, 'E-transfer to market@example.com');
  assert.equal(accepted.body.data.vendorInfo, 'Load-in 2–4pm at Gate C.');

  const late = await call('POST', `/partner/vendors/${merchApp}/accept`, { signerName: 'Max', accept: true, signature: SIG('Max Merch') }, tokens.merch);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'VENDOR_SOLD_OUT');

  // Re-offered a free stall, but the offer is past its date.
  await call('POST', O(`/applications/${merchApp}/offer`), { boothTypeId: stall.id, terms: 'Stall terms.', expiresAt: day(2) }, tokens.owner);
  await supabase.from('vendor_applications').update({ offer_expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', merchApp);
  const expired = await call('POST', `/partner/vendors/${merchApp}/accept`, { signerName: 'Max', accept: true, signature: SIG('Max Merch') }, tokens.merch);
  assert.equal(expired.body.error, 'VENDOR_OFFER_EXPIRED');
});

test('staff never exceed the passes; paid → listed in the directory and on the event page', async () => {
  const tooMany = await call('PATCH', `/partner/vendors/${tacoApp}`, { staff: ['A', 'B', 'C'] }, tokens.taco);
  assert.equal(tooMany.status, 400);
  const staff = await call('PATCH', `/partner/vendors/${tacoApp}`, { staff: ['Ana Ruiz', 'Sam Lee'], description: 'Best tacos in town.' }, tokens.taco);
  assert.deepEqual(staff.body.data.staff, ['Ana Ruiz', 'Sam Lee']);

  assert.deepEqual(await portal.directory(ids.event), [], 'not listed until paid');
  const paid = await call('POST', O(`/applications/${tacoApp}/paid`), { method: 'bank_transfer', reference: 'ET-9' }, tokens.owner);
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.data.status, 'paid');
  const twice = await call('POST', O(`/applications/${tacoApp}/paid`), { method: 'cash' }, tokens.owner);
  assert.equal(twice.body.error, 'VENDOR_ALREADY_PAID');

  const dir = await portal.directory(ids.event);
  assert.deepEqual(dir.map((v) => [v.name, v.booth, v.description]), [['Taco Town', 'T1', 'Best tacos in town.']]);
  const bundle = await content.publicBundle(ids.event);
  assert.equal(bundle.vendorsOpen, true);
  assert.deepEqual(bundle.vendors.map((v) => v.name), ['Taco Town']);

  const door = (await call('GET', O('/door-list'), null, tokens.owner)).body.data;
  assert.deepEqual(door.map((d) => [d.businessName, d.staff.length, d.paid]), [['Taco Town', 2, true]]);

  const opt = await call('PATCH', `/partner/vendors/${tacoApp}`, { listed: false }, tokens.taco);
  assert.equal(opt.body.data.listed, false);
  assert.deepEqual(await portal.directory(ids.event), []);
  await call('PATCH', `/partner/vendors/${tacoApp}`, { listed: true }, tokens.taco);
});

test('a card payment counts only for the session and account we recorded', async () => {
  const third = (await call('POST', O('/booths'), { name: 'Corner', priceCents: 12000 }, tokens.owner)).body.data;
  const lateApp = (await call('POST', O('/applications'), { businessName: 'Late Bakes', contactEmail: ids.lateEmail }, tokens.owner)).body.data.id;
  await call('POST', O(`/applications/${lateApp}/offer`), { boothTypeId: third.id, terms: 'Corner terms.' }, tokens.owner);
  const acc = await call('POST', `/partner/vendors/${lateApp}/accept`, { signerName: 'Lee', accept: true, signature: SIG('Lee Baker') }, tokens.late);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  await supabase.from('vendor_applications').update({ pending_session_id: `cs_test_v_${stamp}`, pending_account_id: ACCOUNT }).eq('id', lateApp);

  const session = (over = {}) => ({ id: `cs_test_v_${stamp}`, amount_total: 12000, payment_intent: `pi_v_${stamp}`, metadata: { vendor_application_id: lateApp }, ...over });
  assert.equal(portal.isVendorSession(session()), true);
  assert.equal((await portal.fulfilFromSession(session(), { account: 'acct_other' })).permanent, true);
  assert.equal((await portal.fulfilFromSession(session({ id: 'cs_other' }), { account: ACCOUNT })).ok, false);
  assert.equal((await portal.fulfilFromSession(session({ amount_total: 1 }), { account: ACCOUNT })).ok, false);
  assert.deepEqual(await portal.fulfilFromSession(session(), { account: ACCOUNT }), { ok: true, alreadyPaid: false });
  assert.deepEqual(await portal.fulfilFromSession(session(), { account: ACCOUNT }), { ok: true, alreadyPaid: true });
  const { data } = await supabase.from('vendor_applications').select('paid_method, stripe_session_id').eq('id', lateApp).single();
  assert.deepEqual(data, { paid_method: 'card', stripe_session_id: `cs_test_v_${stamp}` });
});

test('cancelling a booking takes it out of the directory; a vendor can withdraw before accepting', async () => {
  const cancelled = await call('POST', O(`/applications/${tacoApp}/close`), { outcome: 'cancelled', reason: 'Fire rules' }, tokens.owner);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.stage, 'cancelled');
  assert.ok(!(await portal.directory(ids.event)).some((v) => v.name === 'Taco Town'));

  const withdrawn = await call('POST', `/partner/vendors/${merchApp}/withdraw`, { reason: 'Double-booked' }, tokens.merch);
  assert.equal(withdrawn.body.data.stage, 'withdrawn');
  const rejectAfter = await call('POST', O(`/applications/${merchApp}/close`), { outcome: 'rejected' }, tokens.owner);
  assert.equal(rejectAfter.body.error, 'VENDOR_WRONG_STAGE');

  const removed = await call('DELETE', O(`/booths/${truck.id}`), null, tokens.owner);
  assert.deepEqual(removed.body.data, { removed: false, deactivated: true });
});

test('the floor plan: booths are picked on it, one vendor per booth, held booths cannot be deleted', async () => {
  const empty = (await call('GET', O('/floor-plan'), null, tokens.owner)).body.data;
  assert.equal(empty.version, 0);
  const plan = {
    width: 1000, height: 600,
    elements: [
      { kind: 'wall', points: [[0, 0], [1000, 0], [1000, 600], [0, 600]], closed: true },
      { id: 'db1', kind: 'booth', x: 100, y: 50, w: 60, h: 60, code: 'DB1', boothTypeId: stall.id },
      { id: 'db2', kind: 'booth', x: 160, y: 50, w: 60, h: 60, code: 'DB2', boothTypeId: stall.id },
      { id: 'x9', kind: 'booth', x: 220, y: 50, w: 60, h: 60, code: 'X9', blocked: true },
      { kind: 'area', x: 20, y: 200, w: 90, h: 100, text: 'stage', sub: 'Scene' },
    ],
  };
  const saved = await call('PUT', O('/floor-plan'), { plan, version: 0 }, tokens.owner);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.version, 1);
  assert.equal(saved.body.data.booths.db1.status, 'available');
  assert.equal(saved.body.data.booths.x9.status, 'blocked');
  const stale = await call('PUT', O('/floor-plan'), { plan, version: 0 }, tokens.owner);
  assert.equal(stale.status, 409, 'a stale tab cannot overwrite');

  const a1 = (await call('POST', O('/applications'), { businessName: 'Map One', contactEmail: 'map1@eventsli-test.invalid' }, tokens.owner)).body.data.id;
  const a2 = (await call('POST', O('/applications'), { businessName: 'Map Two', contactEmail: 'map2@eventsli-test.invalid' }, tokens.owner)).body.data.id;
  const offered = await call('POST', O(`/applications/${a1}/offer`), { boothKey: 'db1', terms: 'T.' }, tokens.owner);
  assert.equal(offered.status, 200, JSON.stringify(offered.body));
  assert.equal(offered.body.data.boothLabel, 'DB1', 'the booth code becomes the booth number');
  assert.equal(offered.body.data.boothTypeId, stall.id, 'and its type the booth type');
  assert.equal(offered.body.data.boothKey, 'db1');

  const clash = await call('POST', O(`/applications/${a2}/offer`), { boothKey: 'db1', terms: 'T.' }, tokens.owner);
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'VENDOR_BOOTH_TAKEN');
  const blocked = await call('POST', O(`/applications/${a2}/offer`), { boothKey: 'x9', boothTypeId: stall.id, terms: 'T.' }, tokens.owner);
  assert.equal(blocked.body.error, 'VENDOR_BOOTH_TAKEN');

  const removing = await call('PUT', O('/floor-plan'), { plan: { ...plan, elements: plan.elements.filter((e) => e.id !== 'db1') }, version: 1 }, tokens.owner);
  assert.equal(removing.status, 409);
  assert.match(removing.body.message, /Map One/);

  const pub = (await call('GET', `/public/events/${slug}/vendors`)).body.data.floorPlan;
  assert.equal(pub.booths.db1.status, 'held');
  assert.equal(pub.booths.db1.vendor, undefined, 'no name in public before the booking is paid');

  // Declining frees the booth for someone else.
  await call('POST', O(`/applications/${a1}/close`), { outcome: 'rejected' }, tokens.owner);
  const again = await call('POST', O(`/applications/${a2}/offer`), { boothKey: 'db1', terms: 'T.' }, tokens.owner);
  assert.equal(again.status, 200, JSON.stringify(again.body));
});

test('applications close at the deadline', async () => {
  await call('PUT', O('/program'), { applicationsCloseAt: new Date(Date.now() - 60000).toISOString() }, tokens.owner);
  const page = (await call('GET', `/public/events/${slug}/vendors`)).body.data;
  assert.equal(page.acceptingApplications, false);
  const res = await call('POST', `/public/events/${slug}/vendors/applications`, form('new-vendor@eventsli-test.invalid'));
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'VENDOR_APPLICATIONS_CLOSED');
});

test('booths on the event map: one drawing for every ticketed event', async () => {
  // General admission has an event map too since 2026-11-23 (migration
  // 20261212090000): the room and its booths, no seats. Only a listing-only
  // event keeps a standalone floor plan.
  const current = (await call('GET', O('/floor-plan'), null, tokens.owner)).body.data;
  assert.equal(current.seatMap, true, 'a general-admission event has an event map');
  const booths = current.plan.elements.filter((e) => e.kind === 'booth');
  const linked = { width: 1000, height: 700, onSeatMap: true, elements: booths };

  // Reserved seating, with a seat map: a stage, a table, and a private table.
  await supabase.from('events').update({ admission_type: 'reserved' }).eq('id', ids.event);
  const { data: map, error: mapError } = await supabase.from('venue_maps').insert({
    event_id: ids.event,
    layout_json: { world: { width: 1000, height: 700 }, zones: [{ id: 'z_stage', kind: 'stage', x: 50, y: 10, w: 144, h: 60, rotation: 0 }] },
  }).select('id').single();
  assert.ifError(mapError);
  const { error: tableError } = await supabase.from('tables').insert([
    { venue_map_id: map.id, label: 'T1', seat_count: 8, shape: 'round', position_x: 30, position_y: 50, is_private: false, password_hash: null },
    { venue_map_id: map.id, label: 'VIP', seat_count: 6, shape: 'round', position_x: 70, position_y: 50, is_private: true, password_hash: 'x' },
  ]);
  assert.ifError(tableError);

  const before = (await call('GET', O('/floor-plan'), null, tokens.owner)).body.data;
  assert.equal(before.seatMap, true);
  assert.equal(before.venue, null, 'the separate plan is not on the map until it is saved there');

  const saved = await call('PUT', O('/floor-plan'), { plan: linked, version: before.version }, tokens.owner);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const plan = saved.body.data;
  assert.equal(plan.plan.onSeatMap, true);
  assert.equal(plan.plan.elements.length, booths.length, 'only booths: the walls and the old stage are gone');
  assert.equal(plan.booths.db1.status, 'held', 'the offer still points at its booth');
  assert.deepEqual(plan.venue.tables.map((t) => t.label).sort(), ['T1', 'VIP'], 'the organizer sees every table');
  assert.equal(plan.venue.zones[0].kind, 'stage');

  const pub = (await call('GET', `/public/events/${slug}/vendors`)).body.data.floorPlan;
  assert.deepEqual(pub.venue.tables.map((t) => t.label), ['T1'], 'a private table is not shown to the public');
  assert.equal(pub.venue.tables[0].seatCount, 8);
  assert.equal(pub.booths.db1.vendor, undefined);

  const seatMap = await call('GET', `/public/events/${slug}/seat-map`);
  assert.equal(seatMap.status, 200, JSON.stringify(seatMap.body));
  const vb = seatMap.body.data.vendorBooths;
  assert.equal(vb.plan.onSeatMap, true, 'buyers see the booths on their seat map');
  assert.equal(vb.booths.db1.status, 'held');
  // Booking from the map (2026-11-23): whether vendors are being taken, and which types are open.
  assert.equal(typeof vb.book.open, 'boolean');
  assert.ok(Array.isArray(vb.book.types));
  assert.equal(vb.venue, undefined, 'the seat map does not repeat itself');
  assert.equal(JSON.stringify(seatMap.body.data.map.layout).includes('db1'), false, 'no booth is written into the seat map');
});
