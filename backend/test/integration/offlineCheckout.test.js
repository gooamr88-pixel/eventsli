const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

require('../helpers/testEnv');
const { ensureInvoiceIssuer } = require('../helpers/billing');
const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * PHASE 2 â€” offline checkout, end to end against the real database.
 *
 * An Egyptian organizer (no card payments) with a bank-transfer method and a
 * general-admission event. A buyer reserves and is given instructions; the
 * organizer marks it paid; tickets exist only then. Plus: the switch is off by
 * default, double confirmation, wrong amounts, expiry releasing stock, cancel,
 * void and refund reversing commission, and an audit row for every step.
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */
let server; let baseUrl;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const cleanup = { profiles: [], organizers: [], events: [] };
const ids = {};
let settingBefore;

function client() {
  let cookie = null;
  return async function call(method, path, body, headers = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

async function setOffline(value) {
  await supabase.from('platform_settings').upsert({ key: 'offline_checkout', value }, { onConflict: 'key' });
}

const SIG = { method: 'typed', name: 'Mona Buyer' };

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const { data: s } = await supabase.from('platform_settings').select('value').eq('key', 'offline_checkout').maybeSingle();
  settingBefore = s?.value || null;
  await setOffline({ enabled: false, payment_hours: 48, min_hours_before_event: 2 });

  // The organizer, in Egypt.
  ids.org = client();
  const email = `offline-org-${stamp}@eventsli-test.invalid`;
  const reg = await ids.org('POST', '/auth/register', { email, password: PASSWORD, fullName: 'Offline Org' });
  cleanup.profiles.push(reg.body.data.id);
  ids.orgUser = reg.body.data.id;
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', reg.body.data.id);
  await ids.org('POST', '/auth/login', { email, password: PASSWORD });
  const org = await ids.org('POST', '/organizer', {
    displayName: 'Nile Nights', legalName: 'Nile Nights LLC', acceptPolicies: true, country: 'EG',
    description: 'Runs the events the offline checkout integration suite creates and deletes.',
  });
  assert.equal(org.status, 201, JSON.stringify(org.body));
  ids.organizerId = org.body.data.id;
  cleanup.organizers.push(ids.organizerId);

  const method = await ids.org('POST', '/organizer/payment-methods', {
    kind: 'mobile_money', label: 'Vodafone Cash', instructions: 'Send to 010 0000 0000 and put the reference in the note.',
  });
  assert.equal(method.status, 201, JSON.stringify(method.body));
  ids.methodId = method.body.data.id;

  const ev = await ids.org('POST', '/events', {
    title: `Offline Jazz ${stamp}`, country: 'EG', timezone: 'Africa/Cairo', admissionType: 'general',
    startsAt: new Date(Date.now() + 20 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 20 * 86400e3 + 3 * 3600e3).toISOString(),
  });
  assert.equal(ev.status, 201, JSON.stringify(ev.body));
  ids.eventId = ev.body.data.id;
  ids.slug = ev.body.data.slug;
  cleanup.events.push(ids.eventId);
  const tier = await ids.org('POST', `/events/${ids.eventId}/tiers`, { name: 'Standard', priceCents: 50000, quantity: 10 });
  assert.equal(tier.status, 201, JSON.stringify(tier.body));
  ids.tierId = tier.body.data.id;
  const { data: terms } = await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { error } = await supabase.from('events')
    .update({ status: 'published', accepts_stripe: false, accepts_manual: true, terms_accepted_id: terms.id, commission_pct: 10 })
    .eq('id', ids.eventId);
  assert.ifError(error);
});

after(async () => {
  if (settingBefore) await setOffline(settingBefore);
  for (const id of cleanup.events) {
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', id);
    const orderIds = (orders || []).map((o) => o.id);
    await supabase.from('offline_payments').delete().eq('event_id', id);
    if (orderIds.length) {
      await supabase.from('tickets').delete().in('order_id', orderIds);
      await supabase.from('ledger_entries').delete().in('order_id', orderIds);
      await supabase.from('order_items').delete().in('order_id', orderIds);
      await supabase.from('orders').delete().in('id', orderIds);
    }
    await supabase.from('reservations').delete().eq('event_id', id);
    await supabase.from('events').delete().eq('id', id);
  }
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

/** A buyer holds `quantity` tickets and reserves them to pay offline. */
async function reserve(quantity = 2, { name = 'Mona Buyer' } = {}) {
  const buyer = client();
  const hold = await buyer('POST', `/public/events/${ids.slug}/hold`, { lines: [{ tierId: ids.tierId, quantity }] });
  assert.equal(hold.status, 201, JSON.stringify(hold.body));
  const token = hold.body.data.reservationToken;
  const reservationId = hold.body.data.reservationId;
  const res = await buyer('POST', `/public/reservations/${reservationId}/offline`, {
    methodId: ids.methodId, name, email: `buyer-${randomUUID().slice(0, 8)}@eventsli-test.invalid`,
    acceptTerms: true, signature: SIG,
  }, { 'x-access-token': token });
  return { buyer, token, reservationId, res };
}

const owedCommission = async () => (await supabase.rpc('manual_commission_owed', { p_event_id: ids.eventId, p_currency: 'EGP' })).data;
const soldCount = async () => (await supabase.from('ticket_tiers').select('sold_count').eq('id', ids.tierId).single()).data.sold_count;
const audit = async (offlineId) => (await supabase.from('payment_audit').select('action, actor_role, amount_cents')
  .eq('offline_payment_id', offlineId).order('created_at')).data;

test('switched off (the default), the event is not sold online and offline reserve is refused', async () => {
  const page = await client()('GET', `/public/events/${ids.slug}`);
  assert.equal(page.body.data.purchasable, false);
  const hold = await client()('POST', `/public/events/${ids.slug}/hold`, { lines: [{ tierId: ids.tierId, quantity: 1 }] });
  assert.equal(hold.status, 403);
  assert.equal(hold.body.error, 'TICKETS_NOT_SOLD_ONLINE');
});

test('switched on: the event is purchasable, offline is offered with the organizerâ€™s methods', async () => {
  await setOffline({ enabled: true, payment_hours: 48, min_hours_before_event: 2 });
  const page = await client()('GET', `/public/events/${ids.slug}`);
  assert.equal(page.body.data.purchasable, true);
  assert.deepEqual(page.body.data.payments, { card: false, manual: true });

  const buyer = client();
  const hold = await buyer('POST', `/public/events/${ids.slug}/hold`, { lines: [{ tierId: ids.tierId, quantity: 1 }] });
  const opts = await buyer('GET', `/public/reservations/${hold.body.data.reservationId}/offline-options`, null,
    { 'x-access-token': hold.body.data.reservationToken });
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  assert.equal(opts.body.data.available, true);
  assert.equal(opts.body.data.currency, 'EGP');
  assert.equal(opts.body.data.totalCents, 50000, 'no card fee on an offline payment');
  assert.ok(Array.isArray(opts.body.data.lines), 'line items, as the card checkout shows them');
  assert.ok(opts.body.data.lines.every((l) => typeof l.label === 'string' && Number.isInteger(l.amountCents)));
  assert.equal(opts.body.data.card, false);
  assert.deepEqual(opts.body.data.methods.map((m) => m.label), ['Vodafone Cash']);
  assert.equal(opts.body.data.methods[0].instructions, undefined, 'instructions only after reserving');
  await supabase.rpc('release_reservation', { p_reservation_id: hold.body.data.reservationId });
});

test('reserve: instructions, reference and deadline; no order, no tickets; a repeat returns the same one', async () => {
  const { buyer, token, reservationId, res } = await reserve(2);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const p = res.body.data;
  assert.equal(p.status, 'awaiting');
  assert.match(p.reference, /^[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(p.amountCents, 100000);
  assert.match(p.method.instructions, /Vodafone|010/);
  assert.ok(new Date(p.dueAt) > new Date(Date.now() + 47 * 3600e3));
  ids.awaiting = p.id;
  ids.awaitingToken = p.accessToken;

  const again = await buyer('POST', `/public/reservations/${reservationId}/offline`, {
    methodId: ids.methodId, email: 'x@eventsli-test.invalid', acceptTerms: true, signature: SIG,
  }, { 'x-access-token': token });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.id, p.id);
  assert.equal(again.body.data.duplicate, true);

  const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('reservation_id', reservationId);
  assert.equal(count, 0, 'no order until paid');
  const { data: resv } = await supabase.from('reservations').select('expires_at, state').eq('id', reservationId).single();
  assert.equal(resv.state, 'active');
  assert.equal(new Date(resv.expires_at).toISOString(), new Date(p.dueAt).toISOString(), 'hold lasts until the deadline');

  // The card checkout is refused on a hold awaiting an offline payment.
  const card = await buyer('POST', `/public/reservations/${reservationId}/checkout`, {
    email: 'x@eventsli-test.invalid', acceptTerms: true, signature: SIG,
  }, { 'x-access-token': token });
  assert.ok([409, 503].includes(card.status), JSON.stringify(card.body));

  const view = await client()('GET', `/public/offline-payments/${p.id}?token=${encodeURIComponent(p.accessToken)}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.data.reference, p.reference);
  const stranger = await client()('GET', `/public/offline-payments/${p.id}?token=nope`);
  assert.equal(stranger.status, 404);
});

test('mark as paid: wrong amounts refused; exact amount issues tickets once; a second click changes nothing', async () => {
  const less = await ids.org('POST', `/events/${ids.eventId}/offline-payments/${ids.awaiting}/confirm`, { amountCents: 99999 });
  assert.equal(less.status, 400);
  assert.match(less.body.message, /less than/);
  const more = await ids.org('POST', `/events/${ids.eventId}/offline-payments/${ids.awaiting}/confirm`, { amountCents: 100001 });
  assert.equal(more.status, 400);
  assert.match(more.body.message, /more than/);

  const owedBefore = await owedCommission();
  const soldBefore = await soldCount();
  const key = randomUUID();
  const [a, b] = await Promise.all([
    ids.org('POST', `/events/${ids.eventId}/offline-payments/${ids.awaiting}/confirm`, { amountCents: 100000, reference: 'VC-889', confirmKey: key }),
    ids.org('POST', `/events/${ids.eventId}/offline-payments/${ids.awaiting}/confirm`, { amountCents: 100000, reference: 'VC-889', confirmKey: randomUUID() }),
  ]);
  assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.body, b.body]));
  assert.equal(a.body.data.order_id, b.body.data.order_id, 'one order');
  assert.equal([a, b].filter((r) => r.body.data.duplicate).length, 1);
  ids.paidOrder = a.body.data.order_id;

  const { data: order } = await supabase.from('orders').select('status, channel, manual_source, buyer_total_cents, recorded_by').eq('id', ids.paidOrder).single();
  assert.deepEqual(order, { status: 'paid', channel: 'manual', manual_source: 'online', buyer_total_cents: 100000, recorded_by: ids.orgUser });
  const { count: tickets } = await supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('order_id', ids.paidOrder);
  assert.equal(tickets, 2);
  assert.equal(await soldCount(), soldBefore + 2);
  assert.equal(await owedCommission(), owedBefore + 10000, '10% commission now owed by the organizer');

  const view = await client()('GET', `/public/offline-payments/${ids.awaiting}?token=${encodeURIComponent(ids.awaitingToken)}`);
  assert.equal(view.body.data.status, 'paid');
  assert.ok(view.body.data.orderToken, 'the buyer can open their tickets');

  const trail = await audit(ids.awaiting);
  assert.deepEqual(trail.map((t) => t.action), ['offline.reserved', 'offline.confirmed']);
  assert.equal(trail[1].actor_role, 'organizer');
});

test('another organizer cannot confirm, and a payment is only reachable through its own event', async () => {
  const { res } = await reserve(1);
  const other = await ids.org('POST', `/events/${randomUUID()}/offline-payments/${res.body.data.id}/confirm`, { amountCents: 50000 });
  assert.ok([403, 404].includes(other.status));
  const { data } = await supabase.rpc('offline_confirm', {
    p_offline_id: res.body.data.id, p_organizer_id: randomUUID(), p_actor: ids.orgUser,
    p_amount_cents: 50000, p_reference: null, p_confirm_key: null,
  });
  assert.equal(data.ok, false);
  assert.equal(data.error, 'NOT_FOUND');
  ids.toCancel = res.body.data.id;
});

test('cancel by the organizer releases the stock and cannot then be paid', async () => {
  const soldBefore = await soldCount();
  const res = await ids.org('POST', `/events/${ids.eventId}/offline-payments/${ids.toCancel}/cancel`, { reason: 'Buyer changed their mind' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { data: row } = await supabase.from('offline_payments').select('status, reservation_id').eq('id', ids.toCancel).single();
  assert.equal(row.status, 'cancelled');
  const { data: resv } = await supabase.from('reservations').select('state').eq('id', row.reservation_id).single();
  assert.equal(resv.state, 'released');
  assert.equal(await soldCount(), soldBefore);
  const late = await ids.org('POST', `/events/${ids.eventId}/offline-payments/${ids.toCancel}/confirm`, { amountCents: 50000 });
  assert.equal(late.status, 409);
});

test('an unpaid reservation past its deadline expires on the sweep and frees the tickets', async () => {
  const { res, reservationId } = await reserve(3);
  const id = res.body.data.id;
  const heldBefore = (await supabase.rpc('general_held_count', { p_tier_id: ids.tierId })).data;
  await supabase.from('reservations').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', reservationId);
  await supabase.rpc('expire_stale_reservations');
  const { data: row } = await supabase.from('offline_payments').select('status').eq('id', id).single();
  assert.equal(row.status, 'expired');
  assert.equal((await supabase.rpc('general_held_count', { p_tier_id: ids.tierId })).data, heldBefore - 3);
  const late = await ids.org('POST', `/events/${ids.eventId}/offline-payments/${id}/confirm`, { amountCents: 150000 });
  assert.equal(late.status, 409);
  assert.match(late.body.message, /expired/);
  const trail = await audit(id);
  assert.deepEqual(trail.map((t) => [t.action, t.actor_role]), [['offline.reserved', 'buyer'], ['offline.expired', 'system']]);
});

test('the buyer can cancel their own unpaid reservation with the emailed link', async () => {
  const { res } = await reserve(1);
  const p = res.body.data;
  const cancel = await client()('POST', `/public/offline-payments/${p.id}/cancel?token=${encodeURIComponent(p.accessToken)}`);
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal(cancel.body.data.status, 'cancelled');
});

test('refund: tickets void, stock back, commission reversed, audited; a second refund is a no-op', async () => {
  const owedBefore = await owedCommission();
  const soldBefore = await soldCount();
  const short = await ids.org('POST', `/events/${ids.eventId}/orders/${ids.paidOrder}/void`, { kind: 'refund', reason: 'no' });
  assert.equal(short.status, 400);

  const res = await ids.org('POST', `/events/${ids.eventId}/orders/${ids.paidOrder}/void`, { kind: 'refund', reason: 'Buyer cannot attend; money returned' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.tickets_voided, 2);
  assert.equal(await soldCount(), soldBefore - 2);
  assert.equal(await owedCommission(), owedBefore - 10000);

  const { data: order } = await supabase.from('orders').select('status, void_kind, refunded_cents').eq('id', ids.paidOrder).single();
  assert.deepEqual(order, { status: 'cancelled', void_kind: 'refund', refunded_cents: 100000 });
  const { data: off } = await supabase.from('offline_payments').select('status').eq('id', ids.awaiting).single();
  assert.equal(off.status, 'refunded');

  const again = await ids.org('POST', `/events/${ids.eventId}/orders/${ids.paidOrder}/void`, { kind: 'refund', reason: 'Clicked twice by mistake' });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.duplicate, true);
  assert.equal(await owedCommission(), owedBefore - 10000, 'commission reversed once');

  const { data: rows } = await supabase.from('payment_audit').select('action').eq('order_id', ids.paidOrder);
  assert.ok(rows.some((r) => r.action === 'order.refunded'));
});

test('a voided order cannot be admitted at the door', async () => {
  const { data: t } = await supabase.from('tickets').select('status').eq('order_id', ids.paidOrder);
  assert.ok(t.every((x) => x.status === 'void'));
});

test('payment_audit is append-only', async () => {
  const { data: row } = await supabase.from('payment_audit').select('id').eq('event_id', ids.eventId).limit(1).single();
  const upd = await supabase.from('payment_audit').update({ reason: 'tampered' }).eq('id', row.id);
  assert.ok(upd.error, 'update refused');
  const del = await supabase.from('payment_audit').delete().eq('id', row.id);
  assert.ok(del.error, 'delete refused');
});

test('the organizer sees their offline payments and the audit trail', async () => {
  const list = await ids.org('GET', `/events/${ids.eventId}/offline-payments`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.enabled, true);
  const statuses = list.body.data.payments.map((p) => p.status).sort();
  assert.deepEqual(statuses, ['cancelled', 'cancelled', 'expired', 'refunded']);
  const trail = await ids.org('GET', `/events/${ids.eventId}/payment-audit`);
  assert.equal(trail.status, 200);
  assert.ok(trail.body.data.length >= 8);
});

test('a commission invoice is itemised and frozen: sales, commission, tax, issuer and organizer', async () => {
  // Eventsli's half of the billing details (never blanked: the suite runs files in parallel).
  const issuer = await ensureInvoiceIssuer(supabase);

  const { res } = await reserve(1);
  const ok = await ids.org('POST', `/events/${ids.eventId}/offline-payments/${res.body.data.id}/confirm`, { amountCents: 50000 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  // The organizer has not given a billing address or tax status: nothing is issued.
  const refused = (await supabase.rpc('raise_commission_invoice', { p_event_id: ids.eventId, p_admin_id: null })).data;
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'BILLING_DETAILS_INCOMPLETE');
  assert.deepEqual(refused.organizer_missing, ['billing_address', 'tax_status']);
  const before = await ids.org('GET', '/organizer/me');
  assert.equal(before.body.data.billingComplete, false);

  // The profile validates them together.
  const noNumber = await ids.org('PATCH', '/organizer', { billingAddress: '12 Nile Corniche\nCairo 11511\nEgypt', taxStatus: 'registered' });
  assert.equal(noNumber.status, 400, 'registered for tax without a number');
  const strayNumber = await ids.org('PATCH', '/organizer', { taxStatus: 'not_registered', taxId: '123-456-789' });
  assert.equal(strayNumber.status, 400, 'a number while not registered');
  const shortAddress = await ids.org('PATCH', '/organizer', { billingAddress: 'Cairo' });
  assert.equal(shortAddress.status, 400, 'an address too short to post anything to');
  const saved = await ids.org('PATCH', '/organizer', {
    billingAddress: '12 Nile Corniche\nCairo 11511\nEgypt', taxStatus: 'registered', taxId: '123-456-789',
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.billingComplete, true);
  assert.equal(saved.body.data.taxId, '123-456-789');

  const { data: raised, error } = await supabase.rpc('raise_commission_invoice', { p_event_id: ids.eventId, p_admin_id: null });
  assert.ifError(error);
  assert.equal(raised.ok, true, JSON.stringify(raised));
  const { data: inv } = await supabase.from('invoices')
    .select('amount_cents, sales_count, sales_gross_cents, commission_cents, commission_tax_cents, adjustment_cents, issuer, recipient, currency')
    .eq('id', raised.invoice_id).single();
  // The refunded order is not a sale; only the one just confirmed is.
  assert.equal(inv.sales_count, 1);
  assert.equal(Number(inv.sales_gross_cents), 50000);
  assert.equal(Number(inv.commission_cents), 5000);
  assert.equal(Number(inv.commission_tax_cents), 0);
  assert.equal(Number(inv.adjustment_cents), 0);
  assert.equal(Number(inv.amount_cents), Number(inv.commission_cents) + Number(inv.commission_tax_cents) + Number(inv.adjustment_cents));
  assert.equal(inv.currency, 'EGP');
  assert.equal(inv.issuer.legal_name, issuer.legal_name);
  assert.equal(inv.issuer.tax_id, issuer.tax_id);
  assert.equal(inv.recipient.legal_name, 'Nile Nights LLC');
  assert.equal(inv.recipient.country, 'EG');
  assert.equal(inv.recipient.billing_address, '12 Nile Corniche\nCairo 11511\nEgypt');
  assert.equal(inv.recipient.tax_id, '123-456-789');

  // Frozen: changing the organizer's details later does not rewrite the invoice.
  await ids.org('PATCH', '/organizer', { billingAddress: '1 Somewhere Else, Alexandria, Egypt', taxStatus: 'not_registered' });
  const { data: again } = await supabase.from('invoices').select('recipient').eq('id', raised.invoice_id).single();
  assert.equal(again.recipient.billing_address, '12 Nile Corniche\nCairo 11511\nEgypt');
  assert.equal(again.recipient.tax_id, '123-456-789');

  // The organizer's view carries the lines for the printable invoice.
  const view = await ids.org('GET', `/events/${ids.eventId}/commission`);
  const shaped = view.body.data.invoices.find((i) => i.id === raised.invoice_id);
  assert.deepEqual(shaped.lines, { salesCount: 1, salesGrossCents: 50000, commissionCents: 5000, commissionTaxCents: 0, adjustmentCents: 0 });
  assert.equal(shaped.issuer.legal_name, issuer.legal_name);
  assert.equal(shaped.creditedCents, 0);
  assert.equal(view.body.data.billing.ready, true);
  assert.deepEqual(view.body.data.creditNotes, []);

  // The database refuses a breakdown that does not add up.
  const bad = await supabase.from('invoices').update({ adjustment_cents: 1 }).eq('id', raised.invoice_id);
  assert.ok(bad.error, 'a breakdown that does not add up was accepted');
  await supabase.from('invoices').delete().eq('id', raised.invoice_id);
});
