const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');
const manual = require('../../services/manualPaymentService');
const scanSvc = require('../../services/scanService');
const pricing = require('../../services/pricingService');

/**
 * Manual sales and the commission they create (BRD §03, §18, §20).
 *
 * The property that matters: the manual ledger is a RECEIVABLES ledger. Its
 * balance is what the organizer owes us, and the gate is derived from that
 * balance — so settling an invoice reopens the door with no separate unlock,
 * and there is no way to settle and forget to unlock.
 *
 * The card ledger answers a different question and must stay at zero. BRD is
 * explicit that the two channels are not netted against each other.
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
let seatIds = []; let tableId;

async function seed() {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `man-${stamp}@eventsli-test.invalid`, full_name: 'Man Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Manual Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `man-test-${stamp}`, title: 'Manual Test',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    purchase_mode: 'seat_and_table',
    commission_pct: 1.5, commission_tax_pct: 13, event_tax_pct: 13,
  }).select('id, slug').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id;

  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  ids.map = map.id;
  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ev.id, name: 'GA', price_cents: 10000 }).select('id').single();
  ids.tier = tier.id;

  const { data: t } = await supabase.from('tables').insert({
    venue_map_id: map.id, label: 'VIP', seat_count: 4, price_cents: 30000,
  }).select('id').single();
  tableId = t.id;
  await supabase.from('seats').insert(
    Array.from({ length: 4 }, (_, i) => ({
      venue_map_id: map.id, table_id: t.id, tier_id: tier.id,
      section_key: 'VIP', row_label: 'A', seat_number: String(i + 1),
    })),
  );

  const { data: s } = await supabase.from('seats').insert(
    Array.from({ length: 8 }, (_, i) => ({
      venue_map_id: map.id, tier_id: tier.id,
      section_key: 'Floor', row_label: 'B', seat_number: String(i + 1),
    })),
  ).select('id');
  seatIds = s.map((r) => r.id);
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  await seed();
});

after(async () => {
  if (ids.event) {
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', ids.event);
    for (const o of orders || []) {
      await supabase.from('tickets').delete().eq('order_id', o.id);
      await supabase.from('order_items').delete().eq('order_id', o.id);
    }
    await supabase.from('orders').delete().eq('event_id', ids.event);
    await supabase.from('invoices').delete().eq('event_id', ids.event);
    await supabase.from('scanner_access').delete().eq('event_id', ids.event);
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', ids.event);
    for (const r of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    await supabase.from('reservations').delete().eq('event_id', ids.event);
    await supabase.from('seats').delete().eq('venue_map_id', ids.map);
    await supabase.from('tables').delete().eq('venue_map_id', ids.map);
    await supabase.from('venue_maps').delete().eq('event_id', ids.event);
    await supabase.from('ticket_tiers').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) {
    await supabase.from('terms_acceptances').delete().eq('user_id', ids.profile);
    await supabase.from('profiles').delete().eq('id', ids.profile);
  }
  await new Promise((r) => server.close(r));
});

const owed = async () => {
  const { data } = await supabase.rpc('manual_commission_owed',
    { p_event_id: ids.event, p_currency: 'CAD' });
  return Number(data || 0);
};

// ── Pricing ─────────────────────────────────────────────────────────────────

test('a manual sale carries no payment fee', async () => {
  const { breakdown } = await manual.priceManualSale({
    eventId: ids.event, seatIds: [seatIds[0]],
  });

  assert.equal(breakdown.subtotalCents, 10000);
  assert.equal(breakdown.eventTaxCents, 1300);
  assert.equal(breakdown.commissionCents, 150);
  assert.equal(breakdown.commissionTaxCents, 20);
  // No card was used, so there is no processing cost to recover. Charging one
  // would be inventing a fee out of a cost we did not incur.
  assert.equal(breakdown.paymentFeeCents, 0);
});

test('a whole table prices at the table price, not the seat sum', async () => {
  const { breakdown, seatCount } = await manual.priceManualSale({
    eventId: ids.event, tableId,
  });
  assert.equal(breakdown.subtotalCents, 30000, 'not 4 × $100');
  assert.equal(seatCount, 4);
});

// ── Recording ───────────────────────────────────────────────────────────────

test('recording a sale issues tickets and creates a debt', async () => {
  assert.equal(await owed(), 0, 'nothing owed before the first sale');

  const result = await manual.recordSale({
    eventId: ids.event, seatIds: [seatIds[0], seatIds[1]],
    buyer: { name: 'Walk-in Buyer', email: 'walkin@eventsli-test.invalid' },
    method: 'cash', note: 'at the door', recordedBy: ids.profile,
  });

  assert.equal(result.ticket_count, 2);
  // ONE order of $200, not two of $100: commission is 1.5% of the order
  // (300) and the tax 13% of that (39). Rounding once on the order rather
  // than per seat is what keeps a 20-seat sale from drifting by cents.
  assert.equal(await owed(), 339);

  const { data: order } = await supabase.from('orders')
    .select('channel, status, manual_method, organizer_net_cents, buyer_total_cents, payment_fee_cents')
    .eq('id', result.order_id).single();

  assert.equal(order.channel, 'manual');
  assert.equal(order.manual_method, 'cash');
  assert.equal(order.payment_fee_cents, 0);
  // The organizer keeps everything they collected. What they owe is a DEBT,
  // not a deduction from this order.
  assert.equal(order.organizer_net_cents, order.buyer_total_cents);
});

test('the seats are actually sold, and cannot be sold again online', async () => {
  const { data: seats } = await supabase.from('seats')
    .select('status').in('id', [seatIds[0], seatIds[1]]);
  assert.ok(seats.every((s) => s.status === 'sold'));

  // The door does not get to skip the stock check that the website obeys.
  const online = await supabase.rpc('hold_seats', {
    p_event_id: ids.event, p_user_id: null, p_seat_ids: [seatIds[0]], p_ttl_minutes: 35,
  });
  assert.equal(online.data.ok, false);
  assert.equal(online.data.error, 'SEAT_UNAVAILABLE');
});

test('a seat already held online cannot be sold at the door', async () => {
  const held = await supabase.rpc('hold_seats', {
    p_event_id: ids.event, p_user_id: null, p_seat_ids: [seatIds[2]], p_ttl_minutes: 35,
  });
  assert.equal(held.data.ok, true);

  await assert.rejects(
    () => manual.recordSale({
      eventId: ids.event, seatIds: [seatIds[2]],
      buyer: { name: 'Too Late' }, method: 'cash', recordedBy: ids.profile,
    }),
    (e) => e.code === 'SEAT_UNAVAILABLE',
  );

  await supabase.rpc('release_reservation', { p_reservation_id: held.data.reservation_id });
});

// ── The invoice ─────────────────────────────────────────────────────────────

test('an invoice is raised for exactly what is outstanding', async () => {
  const before_ = await owed();
  const inv = await manual.raiseInvoice(ids.event);

  assert.equal(inv.amount_cents, before_);
  assert.match(inv.number, /^INV-\d{8}-/);
  ids.invoice = inv.invoice_id;

  const { data: row } = await supabase.from('invoices')
    .select('status, due_at, issued_at, order_count').eq('id', inv.invoice_id).single();

  assert.equal(row.status, 'open');
  assert.ok(row.order_count >= 1);
  // 7 days, but never later than 24h before doors — and never sooner than 2h
  // from issue, so an invoice is never born overdue.
  assert.ok(new Date(row.due_at) > new Date(), 'must leave a payable window');
});

test('a second invoice is refused while one is unpaid', async () => {
  await assert.rejects(
    () => manual.raiseInvoice(ids.event),
    (e) => e.code === 'CONFLICT',
  );
  // Two open invoices would give the organizer two due dates for overlapping
  // periods and no way to know which one closes the gate.
});

test('raising an invoice with nothing outstanding is refused', async () => {
  const { data: other } = await supabase.from('events').insert({
    organizer_id: ids.organizer, slug: `man-empty-${stamp}`, title: 'Empty',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 40 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 40 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'draft',
  }).select('id').single();

  await assert.rejects(
    () => manual.raiseInvoice(other.id),
    (e) => e.code === 'CONFLICT',
  );
  await supabase.from('events').delete().eq('id', other.id);
});

// ── BRD §18 — the gate ──────────────────────────────────────────────────────

test('an unpaid invoice does not close the gate until it is due', async () => {
  const gate = await scanSvc.gateStatus(ids.event);
  assert.equal(gate.gate.locked, false, 'an invoice inside its window must not close the door');
});

test('once overdue, the gate closes', async () => {
  await supabase.from('invoices')
    .update({ due_at: new Date(Date.now() - 3600e3).toISOString() })
    .eq('id', ids.invoice);

  const gate = await scanSvc.gateStatus(ids.event);
  assert.equal(gate.gate.locked, true);
  assert.equal(gate.gate.reason, 'commission_overdue');
});

test('the organizer sees the debt and the consequence together', async () => {
  const debt = await manual.debtFor(ids.event);

  assert.ok(debt.owedCents > 0);
  assert.equal(debt.gate.locked, true, 'the debt and the closed door belong on one screen');

  const invoice = debt.invoices.find((i) => i.id === ids.invoice);
  // Computed, not read from `status`: the label is set by a scheduled job, and
  // between runs a due invoice still says "open" while the gate is already shut.
  assert.equal(invoice.isOverdue, true);
  assert.equal(invoice.status, 'open');
});

test('submitting proof does NOT reopen the gate', async () => {
  await manual.submitProof({
    invoiceId: ids.invoice, organizerId: ids.organizer,
    proofUrl: 'https://example.invalid/receipt.pdf',
  });

  const { data: row } = await supabase.from('invoices')
    .select('status, proof_url, proof_submitted_at').eq('id', ids.invoice).single();
  assert.equal(row.status, 'submitted');
  assert.ok(row.proof_submitted_at);

  // Reopening on the claim alone would make the proof decorative.
  const gate = await scanSvc.gateStatus(ids.event);
  assert.equal(gate.gate.locked, true, 'the door stays shut until an admin confirms');
});

test('one organizer cannot submit proof against another organizer\'s invoice', async () => {
  await assert.rejects(
    () => manual.submitProof({
      invoiceId: ids.invoice,
      organizerId: '00000000-0000-0000-0000-000000000000',
      proofUrl: 'https://example.invalid/fake.pdf',
    }),
    (e) => e.code === 'CONFLICT',
  );
});

test('settling clears the balance and reopens the gate', async () => {
  const result = await manual.settle({
    invoiceId: ids.invoice, adminId: ids.profile, note: 'e-transfer confirmed',
  });

  assert.equal(result.remaining_owed_cents, 0);
  assert.equal(await owed(), 0);

  // No separate unlock step: the lock is derived from the balance, so there is
  // no way to settle an invoice and forget to reopen the door.
  const gate = await scanSvc.gateStatus(ids.event);
  assert.equal(gate.gate.locked, false);

  const { data: row } = await supabase.from('invoices')
    .select('status, confirmed_at, confirmed_by').eq('id', ids.invoice).single();
  assert.equal(row.status, 'paid');
  assert.ok(row.confirmed_at, 'paid_needs_confirmation is a database constraint');
});

test('settling twice is idempotent', async () => {
  const again = await manual.settle({ invoiceId: ids.invoice, adminId: ids.profile });
  assert.equal(again.already_settled, true);
  assert.equal(await owed(), 0, 'a double settlement must not create a credit');
});

// ── The two channels stay separate ──────────────────────────────────────────

test('a card sale does not pay off a manual debt', async () => {
  // BRD is explicit: manual commission is NOT netted off Stripe sales.
  const held = await supabase.rpc('hold_seats', {
    p_event_id: ids.event, p_user_id: null, p_seat_ids: [seatIds[3]], p_ttl_minutes: 35,
  });
  const q = await pricing.quoteReservation(held.data.reservation_id);
  await supabase.rpc('fulfill_checkout', {
    p_reservation_id: held.data.reservation_id, p_channel: 'stripe',
    p_breakdown: q.breakdown,
    p_buyer: { user_id: null, name: 'Card Buyer', email: 'card@eventsli-test.invalid' },
    p_stripe: { session_id: `cs_man_${stamp}` },
  });

  // Record a new manual sale, creating fresh debt.
  await manual.recordSale({
    eventId: ids.event, seatIds: [seatIds[4]],
    buyer: { name: 'Second Walk-in' }, method: 'e-transfer', recordedBy: ids.profile,
  });

  const manualOwed = await owed();
  assert.equal(manualOwed, 170, 'the card sale must not have reduced the manual debt');

  const { data: stripeBalance } = await supabase.rpc('ledger_balance_cents', {
    p_event_id: ids.event, p_currency: 'CAD', p_channel: 'stripe',
  });
  assert.equal(Number(stripeBalance), 0, 'the card channel closes at zero, as always');
});

test('the ledger records manual commission as earned-but-uncollected', async () => {
  const { data: entries } = await supabase
    .from('ledger_entries')
    .select('entry_type, direction, amount_cents')
    .eq('event_id', ids.event).eq('channel', 'manual');

  // Credits are what we are owed; the settlement debit is what cancelled the
  // first invoice.
  const credits = entries.filter((e) => e.direction === 'credit');
  const debits = entries.filter((e) => e.direction === 'debit');

  assert.ok(credits.every((e) => ['commission', 'commission_tax'].includes(e.entry_type)));
  assert.ok(debits.every((e) => e.entry_type === 'settlement'));

  // No sale, no payment_fee, no transfer: there was no charge, no processing
  // cost, and nothing for us to move.
  const types = new Set(entries.map((e) => e.entry_type));
  assert.equal(types.has('sale'), false);
  assert.equal(types.has('payment_fee'), false);
  assert.equal(types.has('transfer'), false);
});

test('a fresh debt closes the gate again once due', async () => {
  const inv = await manual.raiseInvoice(ids.event);
  await supabase.from('invoices')
    .update({ due_at: new Date(Date.now() - 3600e3).toISOString() }).eq('id', inv.invoice_id);

  assert.equal((await scanSvc.gateStatus(ids.event)).gate.locked, true);

  await manual.settle({ invoiceId: inv.invoice_id, adminId: ids.profile });
  assert.equal((await scanSvc.gateStatus(ids.event)).gate.locked, false);
  assert.equal(await owed(), 0);
});
