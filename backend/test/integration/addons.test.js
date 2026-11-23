const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const pricing = require('../../services/pricingService');
const addonService = require('../../services/addonService');
const ticketService = require('../../services/ticketService');

/**
 * Ticket add-ons (owner, 2026-11-17), against the real database:
 *
 *   · the checkout quote offers the event's add-ons with what is left;
 *   · a buyer takes at most one per ticket on the order, never past stock;
 *   · the choice is the whole choice (an add-on left out comes off), and only
 *     the hold's own token may change it;
 *   · the add-on is priced into the subtotal, so the same fees apply;
 *   · paying attaches it to the order's tickets in the same transaction, and
 *     the ticket says what it includes;
 *   · the organizer cannot change a price once sold, nor cut stock below it,
 *     and removing a sold one only takes it off sale.
 */

const stamp = Date.now();
const ACCOUNT = `acct_test_addons_${stamp}`;
const ids = { profile: null, organizer: null, event: null, tier: null };
let server; let base; let slug;
const addon = {};

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function hold(quantity) {
  const res = await call('POST', `/public/events/${slug}/hold`, { lines: [{ tierId: ids.tier, quantity }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.data.reservationId, token: res.body.data.reservationToken };
}

const choose = (h, lines, token = h.token) => call('PUT', `/public/reservations/${h.id}/addons`, { lines },
  token ? { 'x-access-token': token } : {});

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const { data: profile } = await supabase.from('profiles').insert({
    email: `addons-org-${stamp}@eventsli-test.invalid`, full_name: 'Addons Org', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Addons Org', country: 'CA', stripe_account_id: ACCOUNT,
  }).select('id').single();
  ids.organizer = org.id;
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `addons-${stamp}`, title: 'Addons Night',
    country: 'CA', timezone: 'America/Toronto', city: 'Toronto',
    starts_at: new Date(Date.now() + 20 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 20 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    admission_type: 'general', purchase_mode: 'seat_only', max_tickets_per_order: 10, accepts_stripe: true,
  }).select('id, slug').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id;
  slug = ev.slug;
  const { data: t } = await supabase.from('ticket_tiers').insert({
    event_id: ev.id, name: 'General', price_cents: 5000, quantity: 50,
  }).select('id').single();
  ids.tier = t.id;

  addon.photo = (await addonService.create(ev.id, { name: 'Photo with the headliner', priceCents: 2000, quantity: 3 })).id;
  addon.poster = (await addonService.create(ev.id, { name: 'Signed poster', priceCents: 1500, description: 'At the merch desk' })).id;
});

after(async () => {
  if (ids.event) {
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', ids.event);
    for (const o of orders || []) {
      await supabase.from('ticket_addons').delete().eq('order_id', o.id);
      await supabase.from('tickets').delete().eq('order_id', o.id);
      await supabase.from('order_items').delete().eq('order_id', o.id);
    }
    await supabase.from('orders').delete().eq('event_id', ids.event);
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', ids.event);
    for (const r of rs || []) {
      await supabase.from('reservation_addons').delete().eq('reservation_id', r.id);
      await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    }
    await supabase.from('reservations').delete().eq('event_id', ids.event);
    await supabase.from('event_addons').delete().eq('event_id', ids.event);
    await supabase.from('ticket_tiers').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) await supabase.from('profiles').delete().eq('id', ids.profile);
  await new Promise((r) => server.close(r));
});

const holds = {};

test('the checkout quote offers the add-ons, with what is left', async () => {
  holds.a = await hold(2);
  const q = await call('GET', `/public/reservations/${holds.a.id}/quote`);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const offered = q.body.data.addonsOffered;
  assert.deepEqual(offered.map((a) => a.name), ['Photo with the headliner', 'Signed poster']);
  assert.equal(offered[0].remaining, 3);
  assert.equal(offered[1].remaining, null, 'no limit');
  assert.deepEqual(q.body.data.addons, []);
});

test('at most one per ticket on the order', async () => {
  const tooMany = await choose(holds.a, [{ addonId: addon.photo, quantity: 3 }]);
  assert.equal(tooMany.status >= 400, true);
  assert.equal(tooMany.body.error, 'PURCHASE_LIMIT_EXCEEDED');
});

test('only the hold\'s own token may change the choice', async () => {
  const anon = await choose(holds.a, [{ addonId: addon.photo, quantity: 1 }], null);
  assert.equal(anon.status >= 400, true, JSON.stringify(anon.body));
});

test('an add-on is priced into the subtotal, so the fees apply to it too', async () => {
  const before = await pricing.quoteReservation(holds.a.id);
  const set = await choose(holds.a, [{ addonId: addon.photo, quantity: 2 }, { addonId: addon.poster, quantity: 1 }]);
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const after = await pricing.quoteReservation(holds.a.id);
  assert.equal(after.ticketSubtotalCents, 10000);
  assert.equal(after.breakdown.subtotalCents, 10000 + 4000 + 1500);
  assert.ok(after.breakdown.commissionCents > before.breakdown.commissionCents, 'commission follows the add-ons');
  const labels = set.body.data.lines.map((l) => l.label);
  assert.ok(labels.includes('Photo with the headliner × 2'));
  assert.ok(labels.includes('Signed poster × 1'));
  assert.equal(set.body.data.totalCents, after.breakdown.buyerTotalCents);
});

test('stock is never oversold, and the refusal says what is left', async () => {
  holds.b = await hold(2);
  const q = await call('GET', `/public/reservations/${holds.b.id}/quote`);
  assert.equal(q.body.data.addonsOffered[0].remaining, 1, 'two of three are held by the first order');
  const refused = await choose(holds.b, [{ addonId: addon.photo, quantity: 2 }]);
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.error, 'ADDON_SOLD_OUT');
  const ok = await choose(holds.b, [{ addonId: addon.photo, quantity: 1 }]);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('the choice is the whole choice: one left out comes off', async () => {
  const set = await choose(holds.b, []);
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.data.addons, []);
  const { count } = await supabase.from('reservation_addons').select('addon_id', { count: 'exact', head: true }).eq('reservation_id', holds.b.id);
  assert.equal(count, 0);
});

test('paying attaches the add-ons to the order\'s tickets, and the ticket says so', async () => {
  const q = await pricing.quoteReservation(holds.a.id);
  const { data, error } = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: holds.a.id,
    p_channel: 'stripe',
    p_breakdown: q.breakdown,
    p_buyer: { user_id: null, name: 'Addon Buyer', email: `addons-buyer-${stamp}@eventsli-test.invalid`, phone: null },
    p_stripe: { account_id: ACCOUNT, session_id: `cs_test_addons_${stamp}`, payment_intent_id: null },
  });
  assert.ifError(error);
  const orderId = data.order_id || data.orderId || data;
  const { data: attached } = await supabase.from('ticket_addons').select('ticket_id, addon_id, unit_price_cents').eq('order_id', orderId);
  assert.equal(attached.filter((r) => r.addon_id === addon.photo).length, 2, 'one photo on each of the two tickets');
  assert.equal(attached.filter((r) => r.addon_id === addon.poster).length, 1);
  assert.equal(new Set(attached.filter((r) => r.addon_id === addon.photo).map((r) => r.ticket_id)).size, 2, 'never two of one add-on on one ticket');

  const tickets = await ticketService.forOrder(orderId);
  const all = tickets.flatMap((t) => t.addons);
  assert.deepEqual(all.sort(), ['Photo with the headliner', 'Photo with the headliner', 'Signed poster'].sort());
  holds.paidOrderId = orderId;
});

test('the organizer\'s Orders list says what each order added: paid from its tickets, unfinished from its hold', async () => {
  // An unfinished order: nothing on tickets yet, only the hold's choice.
  holds.c = await hold(1);
  const set = await choose(holds.c, [{ addonId: addon.poster, quantity: 1 }]);
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const unfinished = { id: '00000000-0000-4000-8000-000000000001', reservation_id: holds.c.id };

  const map = await addonService.forOrders([
    { id: holds.paidOrderId, reservation_id: holds.a.id },
    unfinished,
    { id: '00000000-0000-4000-8000-000000000002', reservation_id: null },
  ]);
  assert.deepEqual(map.get(holds.paidOrderId).map(({ name, quantity, unitPriceCents, amountCents }) => ({ name, quantity, unitPriceCents, amountCents })), [
    { name: 'Photo with the headliner', quantity: 2, unitPriceCents: 2000, amountCents: 4000 },
    { name: 'Signed poster', quantity: 1, unitPriceCents: 1500, amountCents: 1500 },
  ]);
  assert.deepEqual(map.get(unfinished.id).map((l) => [l.name, l.quantity]), [['Signed poster', 1]]);
  assert.equal(map.has('00000000-0000-4000-8000-000000000002'), false, 'an order with no add-ons gets none');
  assert.equal((await addonService.forOrders([])).size, 0);
});

test('the organizer: price fixed once sold, stock not below sold, removal only takes it off sale', async () => {
  await assert.rejects(addonService.update(ids.event, addon.photo, { priceCents: 2500 }), (e) => e.code === 'CONFLICT');
  await assert.rejects(addonService.update(ids.event, addon.photo, { quantity: 1 }), (e) => e.code === 'CONFLICT');
  const renamed = await addonService.update(ids.event, addon.photo, { name: 'Photo with the star', quantity: 5 });
  assert.equal(renamed.name, 'Photo with the star');

  const removed = await addonService.remove(ids.event, addon.photo);
  assert.equal(removed.deleted, false);
  const offered = await addonService.listForBuyer(ids.event);
  assert.equal(offered.some((a) => a.id === addon.photo), false, 'off sale');
  const { data: still } = await supabase.from('event_addons').select('id').eq('id', addon.photo).maybeSingle();
  assert.ok(still, 'kept, so past orders keep its name');

  const fresh = await addonService.create(ids.event, { name: 'Never sold', priceCents: 100 });
  assert.equal((await addonService.remove(ids.event, fresh.id)).deleted, true);
});

test('a picture: only this event\'s own add-on image is accepted, and buyers get its URL', async () => {
  const foreign = `events/00000000-0000-0000-0000-000000000000/addon-0123456789abcdef.jpg`;
  await assert.rejects(addonService.update(ids.event, addon.poster, { imagePath: foreign }), (e) => e.code === 'VALIDATION_ERROR');
  await assert.rejects(addonService.update(ids.event, addon.poster, { imagePath: `events/${ids.event}/cover-0123456789abcdef.jpg` }),
    (e) => e.code === 'VALIDATION_ERROR', 'a cover is not an add-on picture');

  const own = `events/${ids.event}/addon-0123456789abcdef.jpg`;
  const saved = await addonService.update(ids.event, addon.poster, { imagePath: own });
  assert.match(saved.imageUrl, /addon-0123456789abcdef\.jpg$/);
  const offered = await addonService.listForBuyer(ids.event);
  assert.equal(offered.find((a) => a.id === addon.poster).imageUrl, saved.imageUrl);

  const cleared = await addonService.update(ids.event, addon.poster, { imagePath: null });
  assert.equal(cleared.imageUrl, null);

  const signed = await call('POST', `/events/${ids.event}/addons/image-upload`, { contentType: 'image/jpeg' });
  assert.equal(signed.status, 401, 'signing an upload needs the organizer');
});

test('Popular events: ?ticketedFirst puts events sold here before display-only listings', async () => {
  const { data: terms } = await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data: poster, error } = await supabase.from('events').insert({
    organizer_id: ids.organizer, slug: `addons-poster-${stamp}`, title: 'Poster only',
    country: 'CA', timezone: 'America/Toronto', city: 'Toronto',
    starts_at: new Date(Date.now() + 2 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 2 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id, listing_type: 'display_only',
  }).select('id').single();
  assert.ifError(error);
  try {
    const res = await call('GET', '/public/events?limit=200&ticketedFirst=true');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = res.body.data;
    const firstPoster = rows.findIndex((e) => e.displayOnly);
    const lastTicketed = rows.map((e) => !e.displayOnly).lastIndexOf(true);
    assert.ok(firstPoster === -1 || lastTicketed < firstPoster, 'every ticketed event comes before every listing');
    const both = `slugs=${slug},addons-poster-${stamp}`;
    const pair = (await call('GET', `/public/events?ticketedFirst=true&${both}`)).body.data;
    assert.deepEqual(pair.map((e) => e.id), [ids.event, poster.id],
      'the ticketed event leads even though the poster starts sooner');

    const plain = (await call('GET', `/public/events?${both}`)).body.data;
    assert.deepEqual(plain.map((e) => e.id), [poster.id, ids.event],
      'without the flag the listing is still soonest first');
  } finally {
    await supabase.from('events').delete().eq('id', poster.id);
  }
});
