const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * A NAME ON EVERY TICKET, END TO END (2026-11-19).
 *
 * The checkout sends one holder per ticket; the API checks them against the
 * event's rule and saves them on the hold; the database names each ticket as
 * it is issued (trigger apply_ticket_holder). Free claims are used because
 * they issue tickets in the request itself — the card and offline paths go
 * through the same save and the same trigger.
 */
let server; let baseUrl;
const stamp = Date.now();
const ids = { events: [], profiles: [] };
let organizerId; let termsId;

async function makeEvent(key, holderDetails) {
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: organizerId, slug: `holders-${key}-${stamp}`, title: `Holders ${key}`, country: 'CA',
    timezone: 'America/Toronto', currency: 'CAD', status: 'published', terms_accepted_id: termsId,
    admission_type: 'general', purchase_mode: 'seat_only', holder_details: holderDetails,
    starts_at: new Date(Date.now() + 10 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 10 * 86400e3 + 3600e3).toISOString(),
  }).select('id, slug').single();
  assert.ifError(error);
  ids.events.push(ev.id);
  const { data: tiers, error: tErr } = await supabase.from('ticket_tiers').insert([
    { event_id: ev.id, name: 'Floor', price_cents: 0, quantity: 50 },
    { event_id: ev.id, name: 'Balcony', price_cents: 0, quantity: 50 },
  ]).select('id, name');
  assert.ifError(tErr);
  return { ...ev, floor: tiers.find((t) => t.name === 'Floor').id, balcony: tiers.find((t) => t.name === 'Balcony').id };
}

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function hold(ev, lines) {
  const r = await call('POST', `/public/events/${ev.slug}/hold`, { lines });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}

async function quote(h) {
  const r = await call('GET', `/public/reservations/${h.reservationId}/quote`, null, { 'x-access-token': h.reservationToken });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}

function claim(h, extra = {}) {
  return call('POST', `/public/reservations/${h.reservationId}/claim`, {
    email: `holders-buyer-${stamp}@eventsli-test.invalid`, name: 'Ana Buyer', acceptTerms: true,
    signature: { method: 'typed', name: 'Ana Buyer' }, ...extra,
  }, { 'x-access-token': h.reservationToken });
}

async function ticketsOf(orderId) {
  const { data } = await supabase.from('tickets')
    .select('tier_id, attendee_name, attendee_email, attendee_phone').eq('order_id', orderId).order('created_at');
  return data;
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const { data: profile, error } = await supabase.from('profiles').insert({
    email: `holders-org-${stamp}@eventsli-test.invalid`, full_name: 'Holders Org', role: 'organizer',
  }).select('id').single();
  assert.ifError(error);
  ids.profiles.push(profile.id);
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Holders Co', country: 'CA',
  }).select('id').single();
  organizerId = org.id;
  termsId = (await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single()).data.id;
});

after(async () => {
  for (const id of ids.events) {
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', id);
    const orderIds = (orders || []).map((o) => o.id);
    if (orderIds.length) {
      await supabase.from('tickets').delete().in('order_id', orderIds);
      await supabase.from('ledger_entries').delete().in('order_id', orderIds);
      await supabase.from('orders').delete().in('id', orderIds);
    }
    await supabase.from('events').delete().eq('id', id);
  }
  if (organizerId) await supabase.from('organizers').delete().eq('id', organizerId);
  for (const id of ids.profiles) await supabase.from('profiles').delete().eq('id', id);
  await new Promise((r) => server.close(r));
});

test('the quote carries one slot per ticket, labelled, and the event\'s rule', async () => {
  const ev = await makeEvent('quote', 'required');
  const h = await hold(ev, [{ tierId: ev.floor, quantity: 2 }, { tierId: ev.balcony, quantity: 1 }]);
  const q = await quote(h);
  assert.equal(q.holders.mode, 'required');
  assert.deepEqual(q.holders.slots.map((s) => s.title), ['Ticket 1', 'Ticket 2', 'Ticket 3']);
  assert.deepEqual(q.holders.slots.map((s) => s.tierName), ['Floor', 'Floor', 'Balcony']);
});

test('required: a missing first name is refused, naming that ticket', async () => {
  const ev = await makeEvent('required', 'required');
  const h = await hold(ev, [{ tierId: ev.floor, quantity: 2 }]);
  const { holders } = await quote(h);
  const r = await claim(h, { holders: [{ key: holders.slots[0].key, firstName: 'Ana' }, { key: holders.slots[1].key, lastName: 'Only' }] });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'VALIDATION_ERROR');
  assert.equal(r.body.meta.key, holders.slots[1].key);
  assert.match(r.body.message, /Ticket 2/);
});

test('each ticket is issued in its holder\'s name, by ticket type', async () => {
  const ev = await makeEvent('named', 'required');
  const h = await hold(ev, [{ tierId: ev.floor, quantity: 2 }, { tierId: ev.balcony, quantity: 1 }]);
  const { holders } = await quote(h);
  const [f1, f2, b1] = holders.slots;
  const r = await claim(h, {
    holders: [
      { key: f1.key, firstName: 'Ana', lastName: 'Buyer' },
      { key: f2.key, firstName: 'Omar', lastName: 'Saleh', email: 'omar@example.com', phone: '+20 100 000 0000' },
      { key: b1.key, firstName: 'Lina' },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const tix = await ticketsOf(r.body.data.orderId);
  const floor = tix.filter((t) => t.tier_id === ev.floor).map((t) => t.attendee_name).sort();
  assert.deepEqual(floor, ['Ana Buyer', 'Omar Saleh']);
  assert.equal(tix.find((t) => t.tier_id === ev.balcony).attendee_name, 'Lina');
  const omar = tix.find((t) => t.attendee_name === 'Omar Saleh');
  assert.equal(omar.attendee_email, 'omar@example.com');
  assert.equal(omar.attendee_phone, '+20 100 000 0000');
});

test('one ticket: no form, named after the buyer', async () => {
  const ev = await makeEvent('single', 'required');
  const h = await hold(ev, [{ tierId: ev.floor, quantity: 1 }]);
  assert.deepEqual((await quote(h)).holders.slots, []);
  const r = await claim(h);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const [t] = await ticketsOf(r.body.data.orderId);
  assert.equal(t.attendee_name, 'Ana Buyer');
});

test('free: a first name alone books, no email (owner, 2026-11-22: "Name only")', async () => {
  const ev = await makeEvent('nameonly', 'optional');
  const h = await hold(ev, [{ tierId: ev.floor, quantity: 2 }]);
  const { holders } = await quote(h);
  const r = await claim(h, {
    email: '', name: 'Fadi', signature: { method: 'typed', name: 'Fadi' },
    holders: [{ key: holders.slots[0].key, firstName: 'Fadi' }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.email, null);
  assert.equal(r.body.data.tickets.length, 2);
  const { data: order } = await supabase.from('orders')
    .select('guest_name, guest_email, channel').eq('id', r.body.data.orderId).single();
  assert.deepEqual(order, { guest_name: 'Fadi', guest_email: null, channel: 'free' });
});

test('free: no name and no email is refused', async () => {
  const ev = await makeEvent('noname', 'optional');
  const h = await hold(ev, [{ tierId: ev.floor, quantity: 1 }]);
  const r = await claim(h, { email: '', name: '' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'VALIDATION_ERROR');
});

test('optional asks without requiring; off asks nothing', async () => {
  const opt = await makeEvent('optional', 'optional');
  const h1 = await hold(opt, [{ tierId: opt.floor, quantity: 2 }]);
  const q1 = await quote(h1);
  assert.equal(q1.holders.mode, 'optional');
  const r1 = await claim(h1, { holders: [{ key: q1.holders.slots[1].key, firstName: 'Sara' }] });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.deepEqual((await ticketsOf(r1.body.data.orderId)).map((t) => t.attendee_name).sort(), [null, 'Sara'].sort());

  const off = await makeEvent('off', 'off');
  const h2 = await hold(off, [{ tierId: off.floor, quantity: 2 }]);
  const q2 = await quote(h2);
  assert.equal(q2.holders.mode, 'off');
  assert.deepEqual(q2.holders.slots, []);
  const r2 = await claim(h2, { holders: [{ key: 'ga:x:1', firstName: 'Ignored' }] });
  assert.equal(r2.status, 201);
  assert.ok((await ticketsOf(r2.body.data.orderId)).every((t) => t.attendee_name === null));
});

// ── First AND last name, the organizer's choice (2026-11-24) ────────────────
test('full: the quote says so, and a ticket without a last name is refused, naming it', async () => {
  const ev = await makeEvent('full', 'full');
  const h = await hold(ev, [{ tierId: ev.floor, quantity: 2 }]);
  const { holders } = await quote(h);
  assert.equal(holders.mode, 'full');
  const r = await claim(h, { holders: [{ key: holders.slots[0].key, firstName: 'Ana', lastName: 'Buyer' }, { key: holders.slots[1].key, firstName: 'Omar' }] });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'VALIDATION_ERROR');
  assert.equal(r.body.meta.key, holders.slots[1].key);
  assert.match(r.body.message, /last name/i);
  assert.match(r.body.message, /Ticket 2/);
});

test('full: with both names on every ticket, the tickets carry them', async () => {
  const ev = await makeEvent('fullok', 'full');
  const h = await hold(ev, [{ tierId: ev.floor, quantity: 2 }]);
  const { holders } = await quote(h);
  const r = await claim(h, { holders: [{ key: holders.slots[0].key, firstName: 'Ana', lastName: 'Buyer' }, { key: holders.slots[1].key, firstName: 'Omar', lastName: 'Saleh' }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual((await ticketsOf(r.body.data.orderId)).map((t) => t.attendee_name).sort(), ['Ana Buyer', 'Omar Saleh']);
});

test('full: a one-ticket order needs the buyer\'s last name too', async () => {
  const ev = await makeEvent('fullsingle', 'full');
  const h = await hold(ev, [{ tierId: ev.floor, quantity: 1 }]);
  const one = await claim(h, { name: 'Ana', signature: { method: 'typed', name: 'Ana' } });
  assert.equal(one.status, 400, JSON.stringify(one.body));
  assert.match(one.body.message, /first and last name/i);
  const both = await claim(h);
  assert.equal(both.status, 201, JSON.stringify(both.body));
  assert.equal((await ticketsOf(both.body.data.orderId))[0].attendee_name, 'Ana Buyer');
});

test('the organizer can choose it, and nothing outside the four choices', async () => {
  const ok = await supabase.from('events').update({ holder_details: 'full' }).eq('id', ids.events[0]);
  assert.ifError(ok.error);
  const bad = await supabase.from('events').update({ holder_details: 'everything' }).eq('id', ids.events[0]);
  assert.ok(bad.error, 'the database refuses an unknown choice');
});
