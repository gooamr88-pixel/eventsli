const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const sessions = require('../../services/sessionService');

/**
 * WHOSE GUEST, END TO END (2026-11-23, the owner: "the guest says 'I come from
 * the groom', and the groom receives an email, or the bride and the bride
 * receives an email"), against the real database:
 *
 *   · the organizer lists hosts and decides whether checkout asks;
 *   · the quote offers the hosts; a required answer is enforced;
 *   · the answer, saved on the hold, lands on the order (database trigger);
 *   · the host is notified once per order, and only a host with an email;
 *   · the host's private list shows names and counts, never contact details,
 *     and a reset link stops the old one;
 *   · a host with guests is never deleted, only taken off the list.
 */
let server; let base; let token; let ev;
const stamp = Date.now();
const ids = { profiles: [], organizer: null };

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const org = (method, path, body) => call(method, path, body, { authorization: `Bearer ${token}` });

async function hold(quantity = 2) {
  const r = await call('POST', `/public/events/${ev.slug}/hold`, { lines: [{ tierId: ev.tier, quantity }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}
const access = (h) => ({ 'x-access-token': h.reservationToken });
function claim(h, extra = {}) {
  return call('POST', `/public/reservations/${h.reservationId}/claim`, {
    email: `guestof-buyer-${stamp}@eventsli-test.invalid`, name: 'Sara Ali', acceptTerms: true,
    signature: { method: 'typed', name: 'Sara Ali' }, ...extra,
  }, access(h));
}
async function notifiedAt(orderId) {
  for (let i = 0; i < 40; i += 1) {
    const { data } = await supabase.from('orders').select('host_notified_at').eq('id', orderId).single();
    if (data.host_notified_at) return data.host_notified_at;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const email = `guestof-org-${stamp}@eventsli-test.invalid`;
  const { data: owner } = await supabase.from('profiles').insert({
    email, full_name: 'Wedding Planner', role: 'organizer', email_verified_at: new Date().toISOString(),
  }).select('id').single();
  ids.profiles.push(owner.id);
  ({ token } = await sessions.issue(null, { userId: owner.id, email, role: 'organizer', cookie: false }));
  const { data: o } = await supabase.from('organizers').insert({ owner_user_id: owner.id, display_name: 'Planner Co', country: 'CA' }).select('id').single();
  ids.organizer = o.id;
  const termsId = (await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single()).data.id;
  const { data: e, error } = await supabase.from('events').insert({
    organizer_id: o.id, slug: `wedding-${stamp}`, title: 'Ahmed & Mona’s Wedding', country: 'CA',
    timezone: 'America/Toronto', currency: 'CAD', status: 'published', terms_accepted_id: termsId,
    admission_type: 'general', purchase_mode: 'seat_only', holder_details: 'off',
    starts_at: new Date(Date.now() + 15 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 15 * 86400e3 + 5 * 3600e3).toISOString(),
  }).select('id, slug').single();
  assert.ifError(error);
  const { data: tier } = await supabase.from('ticket_tiers').insert({ event_id: e.id, name: 'Guest', price_cents: 0, quantity: 200 }).select('id').single();
  ev = { ...e, tier: tier.id };
});

after(async () => {
  if (ev) {
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', ev.id);
    const orderIds = (orders || []).map((x) => x.id);
    if (orderIds.length) {
      await supabase.from('tickets').delete().in('order_id', orderIds);
      await supabase.from('ledger_entries').delete().in('order_id', orderIds);
      await supabase.from('orders').delete().in('id', orderIds);
    }
    await supabase.from('reservations').delete().eq('event_id', ev.id);
    await supabase.from('events').delete().eq('id', ev.id);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  await supabase.from('sessions').delete().in('user_id', ids.profiles);
  await supabase.from('profiles').delete().in('id', ids.profiles);
  await new Promise((r) => server.close(r));
});

let groom; let bride; let firstOrder;

test('the organizer adds the groom and the bride; checkout asks only once switched on', async () => {
  const g = await org('POST', `/events/${ev.id}/hosts`, { name: 'The groom — Ahmed', email: `groom-${stamp}@eventsli-test.invalid` });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  groom = g.body.data;
  assert.equal(groom.code, 'the-groom-ahmed');
  assert.match(groom.link, new RegExp(`/e/${ev.slug}\\?guestof=the-groom-ahmed$`));
  bride = (await org('POST', `/events/${ev.id}/hosts`, { name: 'The bride — Mona' })).body.data;

  const h = await hold(1);
  let q = await call('GET', `/public/reservations/${h.reservationId}/quote`, null, access(h));
  assert.equal(q.body.data.guestOf, null, 'not asked while the question is off');

  const set = await org('PUT', `/events/${ev.id}/hosts/settings`, { mode: 'required', question: 'Bride’s side or groom’s side?' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  q = await call('GET', `/public/reservations/${h.reservationId}/quote`, null, access(h));
  assert.equal(q.body.data.guestOf.mode, 'required');
  assert.equal(q.body.data.guestOf.question, 'Bride’s side or groom’s side?');
  assert.deepEqual(q.body.data.guestOf.hosts.map((x) => x.name), ['The groom — Ahmed', 'The bride — Mona']);
  assert.ok(!JSON.stringify(q.body.data.guestOf).includes('@'), 'the buyer never sees a host’s email');

  const unanswered = await claim(h);
  assert.equal(unanswered.status, 400);
  assert.equal(unanswered.body.meta.field, 'guestOf');
  const wrong = await claim(h, { guestOfHostId: '00000000-0000-4000-8000-000000000000' });
  assert.equal(wrong.status, 400);
});

test('"I come from the groom": the order is the groom’s, and the groom is told once', async () => {
  const h = await hold(2);
  const r = await claim(h, { guestOfHostId: groom.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  firstOrder = r.body.data.orderId;
  const { data: order } = await supabase.from('orders').select('guest_of_host_id').eq('id', firstOrder).single();
  assert.equal(order.guest_of_host_id, groom.id, 'copied from the hold by the trigger');
  const first = await notifiedAt(firstOrder);
  assert.ok(first, 'the groom was notified');

  // A second notification for the same order is refused by the claim.
  const again = await require('../../services/guestOfService').notifyHost(firstOrder);
  assert.equal(again.sent, false);
  const { data: after1 } = await supabase.from('orders').select('host_notified_at').eq('id', firstOrder).single();
  assert.equal(after1.host_notified_at, first);
});

test('a host with no email is a choice, not a recipient', async () => {
  const h = await hold(1);
  const r = await claim(h, { guestOfHostId: bride.id, email: `bride-guest-${stamp}@eventsli-test.invalid`, name: 'Omar' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await new Promise((res) => setTimeout(res, 300));
  const { data } = await supabase.from('orders').select('guest_of_host_id, host_notified_at').eq('id', r.body.data.orderId).single();
  assert.equal(data.guest_of_host_id, bride.id);
  assert.equal(data.host_notified_at, null);
});

test('the organizer sees the numbers per host, the guests, and the order list says whose guest', async () => {
  const o = await org('GET', `/events/${ev.id}/hosts`);
  const g = o.body.data.hosts.find((x) => x.id === groom.id);
  assert.deepEqual(g.stats, { orders: 1, tickets: 2, revenueCents: 0 });
  assert.equal(o.body.data.hosts.find((x) => x.id === bride.id).stats.tickets, 1);

  const guests = await org('GET', `/events/${ev.id}/hosts/${groom.id}/guests`);
  assert.equal(guests.body.data.guests[0].name, 'Sara Ali');
  assert.match(guests.body.data.guests[0].email, /guestof-buyer/);

  const orders = await org('GET', `/events/${ev.id}/orders?status=all`);
  assert.equal(orders.status, 200, JSON.stringify(orders.body));
  const row = orders.body.data.find((x) => x.id === firstOrder);
  assert.equal(row.guestOf.name, 'The groom — Ahmed');
});

test('the groom’s private list: names and counts, no contact details; a new link stops the old', async () => {
  const token1 = decodeURIComponent(groom.listUrl.split('/guests/')[1]);
  const list = await call('GET', `/public/host-guests/${encodeURIComponent(token1)}`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.host.name, 'The groom — Ahmed');
  assert.deepEqual(list.body.data.totals, { bookings: 1, tickets: 2 });
  assert.equal(list.body.data.guests[0].name, 'Sara Ali');
  assert.ok(!JSON.stringify(list.body).includes('@'), 'no email reaches the host');

  const reset = await org('POST', `/events/${ev.id}/hosts/${groom.id}/reset-link`);
  assert.equal(reset.status, 200);
  assert.equal((await call('GET', `/public/host-guests/${encodeURIComponent(token1)}`)).status, 404);
  const token2 = decodeURIComponent(reset.body.data.listUrl.split('/guests/')[1]);
  assert.equal((await call('GET', `/public/host-guests/${encodeURIComponent(token2)}`)).status, 200);
  assert.equal((await call('GET', '/public/host-guests/not-a-real-token-at-all')).status, 404);
});

test('a host with guests is taken off the list, never deleted; an unused one is deleted', async () => {
  const off = await org('DELETE', `/events/${ev.id}/hosts/${groom.id}`);
  assert.deepEqual(off.body.data, { removed: false, deactivated: true });
  const { data: kept } = await supabase.from('orders').select('guest_of_host_id').eq('id', firstOrder).single();
  assert.equal(kept.guest_of_host_id, groom.id);

  const h = await hold(1);
  const q = await call('GET', `/public/reservations/${h.reservationId}/quote`, null, access(h));
  assert.deepEqual(q.body.data.guestOf.hosts.map((x) => x.name), ['The bride — Mona'], 'off the list at checkout');

  const spare = (await org('POST', `/events/${ev.id}/hosts`, { name: 'Spare' })).body.data;
  const gone = await org('DELETE', `/events/${ev.id}/hosts/${spare.id}`);
  assert.deepEqual(gone.body.data, { removed: true, deactivated: false });
});
