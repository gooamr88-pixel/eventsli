const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Sets DISABLE_RATE_LIMIT before anything builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const manual = require('../../services/manualPaymentService');
const invoices = require('../../services/invoiceService');
const { ORGANIZER_BILLING, ensureInvoiceIssuer } = require('../helpers/billing');

/**
 * Credit notes and billing details (20261123110000).
 *
 * THE PROPERTY: an invoice never asks an organizer for commission they no
 * longer owe. A sale an invoice covered that is then voided or refunded issues
 * a credit note, and the money it represents goes — in this order — against
 * the invoice's unpaid balance, against anything waived on it, against the
 * event's other unpaid invoice, and only then becomes a credit balance that the
 * next invoice nets off or an admin pays back. Never both.
 *
 * Throughout: what the ledger says is owed equals what the unpaid invoices ask
 * for, less any credit balance — checked after every step (`consistent`).
 *
 * And no invoice is issued without both parties' legal and tax details.
 *
 * Numbers: every sale is one $100 seat, commission 10% ($10.00) plus 10% tax
 * on the commission ($1.00) — 1100 cents of commission per sale.
 */

const stamp = Date.now();
const PER_SALE = 1100;
const made = { events: [], maps: [] };
const ids = {};

async function freshEvent(seats = 4) {
  const n = made.events.length + 1;
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: ids.organizer, slug: `cn-test-${stamp}-${n}`, title: `Credit Note Test ${n}`,
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: ids.terms,
    purchase_mode: 'seat_and_table', commission_pct: 10, commission_tax_pct: 10, event_tax_pct: 0,
  }).select('id').single();
  if (error) throw new Error(`event: ${error.message}`);
  made.events.push(ev.id);
  const { data: map } = await supabase.from('venue_maps').insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  made.maps.push(map.id);
  const { data: tier } = await supabase.from('ticket_tiers').insert({ event_id: ev.id, name: 'GA', price_cents: 10000 }).select('id').single();
  const { data: s } = await supabase.from('seats').insert(Array.from({ length: seats }, (_, i) => ({
    venue_map_id: map.id, tier_id: tier.id, section_key: 'Floor', row_label: 'A', seat_number: String(i + 1),
  }))).select('id');
  return { id: ev.id, seats: s.map((r) => r.id), next: 0 };
}

async function sell(ev) {
  const seat = ev.seats[ev.next++];
  const r = await manual.recordSale({
    eventId: ev.id, seatIds: [seat], buyer: { name: 'Door Buyer' }, method: 'cash', recordedBy: ids.profile,
  });
  return r.order_id;
}

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  assert.ifError(error);
  return data;
}

const raise = (ev) => rpc('raise_commission_invoice', { p_event_id: ev.id, p_admin_id: null });
const voidSale = (orderId, kind = 'void') => rpc('order_void_offline', {
  p_order_id: orderId, p_organizer_id: ids.organizer, p_actor: ids.profile, p_role: 'organizer',
  p_kind: kind, p_reason: 'Recorded against the wrong buyer',
});
const pay = (invoiceId, cents, reference = null) => rpc('invoice_record_payment', {
  p_invoice_id: invoiceId, p_amount_cents: cents, p_method: 'bank transfer', p_reference: reference,
  p_received_at: null, p_note: null, p_admin_id: ids.profile,
});
const inv = async (id) => (await supabase.from('invoices').select('*').eq('id', id).single()).data;
const owed = async (ev) => Number(await rpc('manual_commission_owed', { p_event_id: ev.id, p_currency: 'CAD' }));
const notes = async (ev) => (await supabase.from('credit_notes').select('*').eq('event_id', ev.id).order('created_at')).data;
const balance = (i) => Number(i.amount_cents) - Number(i.paid_cents) - Number(i.written_off_cents) - Number(i.credited_cents);

/** Ledger = unpaid invoice balances + not-yet-invoiced − unspent credit. */
async function consistent(ev, { uninvoiced = 0 } = {}) {
  const { data: rows } = await supabase.from('invoices').select('*').eq('event_id', ev.id);
  const unpaid = rows.filter((i) => ['open', 'submitted', 'overdue'].includes(i.status)).reduce((s, i) => s + balance(i), 0);
  const credit = (await notes(ev)).reduce((s, n) => s + Number(n.remaining_cents), 0);
  assert.equal(await owed(ev), unpaid + uninvoiced - credit, 'the ledger and the invoices disagree');
}

before(async () => {
  await ensureInvoiceIssuer(supabase);
  const { data: profile } = await supabase.from('profiles').insert({
    email: `cn-${stamp}@eventsli-test.invalid`, full_name: 'Credit Note Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;
  const { data: org, error } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Credit Co', legal_name: 'Credit Company Ltd.', country: 'CA',
    ...ORGANIZER_BILLING,
  }).select('id').single();
  if (error) throw new Error(`organizer: ${error.message}`);
  ids.organizer = org.id;
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  ids.terms = terms.id;
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });
});

after(async () => {
  // The ledger is append-only, so events with commission stay behind as they
  // do for every suite that sells; what can go, goes.
  for (const id of made.events) {
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', id);
    for (const o of orders || []) await supabase.from('tickets').delete().eq('order_id', o.id);
    await supabase.from('invoices').delete().eq('event_id', id);
    await supabase.from('events').delete().eq('id', id);
  }
  for (const m of made.maps) await supabase.from('seats').delete().eq('venue_map_id', m);
  await supabase.from('organizers').delete().eq('id', ids.organizer);
  await supabase.from('terms_acceptances').delete().eq('user_id', ids.profile);
  await supabase.from('profiles').delete().eq('id', ids.profile);
});

// ── Unpaid invoice ──────────────────────────────────────────────────────────

test('a sale voided on an unpaid invoice comes off what it asks for; all of them, and nothing is due', async () => {
  const ev = await freshEvent();
  const [a, b, c] = [await sell(ev), await sell(ev), await sell(ev)];
  const raised = await raise(ev);
  assert.equal(raised.ok, true, JSON.stringify(raised));
  assert.equal(raised.amount_cents, 3 * PER_SALE);

  const v = await voidSale(a);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.credit_note.amount_cents, PER_SALE);
  assert.equal(v.credit_note.applied_cents, PER_SALE);
  assert.equal(v.credit_note.carried_cents, 0);
  assert.match(v.credit_note.number, /^CN-\d{8}-[0-9a-f]{8}-1$/);

  let i = await inv(raised.invoice_id);
  assert.equal(Number(i.amount_cents), 3 * PER_SALE, 'the invoice as issued is never rewritten');
  assert.equal(Number(i.credited_cents), PER_SALE);
  assert.equal(balance(i), 2 * PER_SALE);
  assert.equal(i.status, 'open');
  await consistent(ev);

  // Paying the old full amount is now refused — it is more than is owed.
  const over = await pay(raised.invoice_id, 3 * PER_SALE);
  assert.equal(over.ok, false);

  // The same void again issues nothing more.
  const again = await voidSale(a);
  assert.equal(again.duplicate, true);
  assert.equal((await notes(ev)).length, 1);

  await voidSale(b);
  await voidSale(c, 'refund');
  i = await inv(raised.invoice_id);
  assert.equal(balance(i), 0);
  assert.equal(i.status, 'credited', 'cleared by credit with nothing paid is not "paid"');
  const n = await notes(ev);
  assert.equal(n.length, 3);
  assert.equal(n[2].kind, 'refund');
  assert.ok(n.every((x) => Number(x.remaining_cents) === 0));
  assert.equal((await pay(raised.invoice_id, 100)).ok, false, 'nothing can be paid on a credited invoice');
  await consistent(ev);

  const { data: history } = await supabase.from('invoice_events').select('kind, amount_cents, detail')
    .eq('invoice_id', raised.invoice_id).eq('kind', 'credited');
  assert.equal(history.length, 3);
  assert.ok(history.every((h) => h.detail.credit_note_number));
});

test('a sale nobody has invoiced yet needs no credit note — the next invoice leaves it out', async () => {
  const ev = await freshEvent();
  const a = await sell(ev);
  await sell(ev);
  const v = await voidSale(a);
  assert.equal(v.credit_note, null);
  const raised = await raise(ev);
  assert.equal(raised.amount_cents, PER_SALE);
  const i = await inv(raised.invoice_id);
  assert.equal(i.sales_count, 1);
  assert.equal(Number(i.adjustment_cents), 0);
  await consistent(ev);
});

// ── Part-paid and paid invoices ─────────────────────────────────────────────

test('part-paid: the unpaid part is credited, the rest is carried and netted off the next invoice', async () => {
  const ev = await freshEvent();
  const a = await sell(ev);
  await sell(ev);
  const raised = await raise(ev);
  assert.equal((await pay(raised.invoice_id, 1500, 'TRX-1')).ok, true);

  const v = await voidSale(a);
  assert.equal(v.credit_note.applied_cents, 700);
  assert.equal(v.credit_note.carried_cents, 400);
  const i = await inv(raised.invoice_id);
  assert.equal(i.status, 'paid');
  assert.equal(Number(i.credited_cents), 700);
  assert.equal(await owed(ev), -400, 'the organizer is 400 in credit');
  await consistent(ev);

  // The organizer's Commission page says so.
  const debt = await manual.debtFor(ev.id);
  assert.equal(debt.creditBalanceCents, 400);
  assert.equal(debt.creditNotes.length, 1);
  assert.equal(debt.billing.ready, true);

  // The next sale's invoice nets the credit off.
  await sell(ev);
  const next = await raise(ev);
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.equal(next.amount_cents, PER_SALE - 400);
  const n2 = await inv(next.invoice_id);
  assert.equal(Number(n2.commission_cents) + Number(n2.commission_tax_cents), PER_SALE);
  assert.equal(Number(n2.adjustment_cents), -400);
  const [note] = await notes(ev);
  assert.equal(Number(note.remaining_cents), 0, 'netted, so it cannot also be refunded');
  const { data: alloc } = await supabase.from('credit_note_allocations').select('kind, invoice_id, amount_cents')
    .eq('credit_note_id', note.id).eq('kind', 'netted');
  assert.equal(alloc.length, 1);
  assert.equal(alloc[0].invoice_id, next.invoice_id);
  await consistent(ev);

  await assert.rejects(
    invoices.refundCredit({ creditNoteId: note.id, amountCents: 400, reference: 'OUT-1', adminId: ids.profile }),
    (e) => e.code === 'VALIDATION_ERROR',
  );
});

test('paid in full: the credit is carried, and an admin can pay it back exactly once', async () => {
  const ev = await freshEvent();
  const a = await sell(ev);
  const raised = await raise(ev);
  assert.equal((await rpc('settle_invoice', { p_invoice_id: raised.invoice_id, p_admin_id: ids.profile, p_note: null })).ok, true);

  const v = await voidSale(a, 'refund');
  assert.equal(v.credit_note.carried_cents, PER_SALE);
  assert.equal((await inv(raised.invoice_id)).status, 'paid', 'what was paid stays paid');
  await consistent(ev);
  const [note] = await notes(ev);

  await assert.rejects(
    invoices.refundCredit({ creditNoteId: note.id, amountCents: PER_SALE + 1, reference: 'OUT-1', adminId: ids.profile }),
    (e) => e.code === 'VALIDATION_ERROR',
  );
  await assert.rejects(
    invoices.refundCredit({ creditNoteId: note.id, amountCents: PER_SALE, reference: '', adminId: ids.profile }),
    (e) => e.code === 'VALIDATION_ERROR',
  );
  const out = await invoices.refundCredit({
    creditNoteId: note.id, amountCents: PER_SALE, method: 'bank transfer', reference: 'OUT-1', adminId: ids.profile,
  });
  assert.equal(out.remaining_cents, 0);
  assert.equal(await owed(ev), 0, 'paid back: the account is square');
  await consistent(ev);
  await assert.rejects(
    invoices.refundCredit({ creditNoteId: note.id, amountCents: 1, reference: 'OUT-2', adminId: ids.profile }),
    (e) => e.code === 'VALIDATION_ERROR',
  );
  const nothing = await raise(ev);
  assert.equal(nothing.ok, false, 'nothing is outstanding, so no invoice');
});

test('credit from a paid invoice goes against the event\'s open invoice before anything else', async () => {
  const ev = await freshEvent();
  const a = await sell(ev);
  const first = await raise(ev);
  await rpc('settle_invoice', { p_invoice_id: first.invoice_id, p_admin_id: ids.profile, p_note: null });
  await sell(ev);
  const second = await raise(ev);
  assert.equal(second.amount_cents, PER_SALE);

  const v = await voidSale(a);
  assert.equal(v.credit_note.invoice_id, first.invoice_id, 'the credit note corrects the invoice that covered the sale');
  assert.equal(v.credit_note.carried_cents, 0);
  const s = await inv(second.invoice_id);
  assert.equal(Number(s.credited_cents), PER_SALE);
  assert.equal(s.status, 'credited', 'the organizer is not asked to pay while holding the credit');
  assert.equal(await owed(ev), 0);
  await consistent(ev);
});

// ── Waived, voided, reversed ────────────────────────────────────────────────

test('on a waived invoice the waiver shrinks — forgiven commission never turns into a credit', async () => {
  const ev = await freshEvent();
  const a = await sell(ev);
  await sell(ev);
  const raised = await raise(ev);
  await rpc('invoice_waive', { p_invoice_id: raised.invoice_id, p_reason: 'Goodwill for a first event', p_admin_id: ids.profile });

  const v = await voidSale(a);
  assert.equal(v.credit_note.carried_cents, 0);
  const i = await inv(raised.invoice_id);
  assert.equal(Number(i.written_off_cents), PER_SALE);
  assert.equal(Number(i.credited_cents), PER_SALE);
  assert.equal(i.status, 'waived');
  assert.equal(await owed(ev), 0, 'no credit for commission that was never paid');
  await consistent(ev);
});

test('voiding an invoice releases its credit; the next invoice is for what is really owed', async () => {
  const ev = await freshEvent();
  const a = await sell(ev);
  await sell(ev);
  const raised = await raise(ev);
  await voidSale(a);
  const voided = await rpc('invoice_void', { p_invoice_id: raised.invoice_id, p_reason: 'Raised in error', p_admin_id: ids.profile });
  assert.equal(voided.ok, true, JSON.stringify(voided));
  assert.equal(Number((await inv(raised.invoice_id)).credited_cents), 0);
  assert.equal(Number((await notes(ev))[0].remaining_cents), PER_SALE, 'released, not lost');
  assert.equal(await owed(ev), PER_SALE, 'one sale is still owed');

  const next = await raise(ev);
  assert.equal(next.amount_cents, PER_SALE, 'one sale is still owed — not two, not zero');
  assert.equal(Number((await notes(ev))[0].remaining_cents), 0);
  await consistent(ev);
});

test('a reversed payment does not bring back commission a credit note already took off', async () => {
  const ev = await freshEvent();
  const a = await sell(ev);
  await sell(ev);
  const raised = await raise(ev);
  const paid = await pay(raised.invoice_id, 2 * PER_SALE, 'TRX-9');
  assert.equal(paid.settled, true);
  await voidSale(a);
  assert.equal(await owed(ev), -PER_SALE);

  const rev = await rpc('invoice_reverse_payment', { p_payment_id: paid.payment_id, p_reason: 'The transfer bounced', p_admin_id: ids.profile });
  assert.equal(rev.ok, true, JSON.stringify(rev));
  const i = await inv(raised.invoice_id);
  assert.equal(balance(i), PER_SALE, 'asks for the one sale still owed');
  assert.equal(Number(i.credited_cents), PER_SALE);
  assert.equal(Number((await notes(ev))[0].remaining_cents), 0);
  await consistent(ev);
});

// ── Credit notes are documents ──────────────────────────────────────────────

test('a credit note cannot be edited or deleted, and its history is append-only', async () => {
  const ev = await freshEvent();
  const a = await sell(ev);
  await raise(ev);
  await voidSale(a);
  const [note] = await notes(ev);
  assert.equal(note.issuer.legal_name.length > 1, true, 'frozen with the invoice\'s issuer');
  assert.equal(note.recipient.billing_address, ORGANIZER_BILLING.billing_address);

  assert.ok((await supabase.from('credit_notes').update({ amount_cents: 1 }).eq('id', note.id)).error);
  assert.ok((await supabase.from('credit_notes').delete().eq('id', note.id)).error);
  const { data: allocs } = await supabase.from('credit_note_allocations').select('id').eq('credit_note_id', note.id);
  assert.ok((await supabase.from('credit_note_allocations').update({ amount_cents: 1 }).eq('id', allocs[0].id)).error);
  assert.ok((await supabase.from('credit_note_allocations').delete().eq('id', allocs[0].id)).error);
});

// ── Billing details ─────────────────────────────────────────────────────────

test('Eventsli\'s invoicing details must be complete and valid', async () => {
  assert.deepEqual(await rpc('invoice_issuer_missing', { p_issuer: {} }), ['legal_name', 'address', 'tax_id', 'email']);
  assert.deepEqual(await rpc('invoice_issuer_missing', {
    p_issuer: { legal_name: 'Eventsli Inc.', address: 'Toronto', tax_id: 'BN', email: 'not-an-email' },
  }), ['address', 'tax_id', 'email']);
  assert.deepEqual(await rpc('invoice_issuer_missing', {
    p_issuer: { legal_name: 'Eventsli Inc.', address: '100 King St W, Toronto', tax_id: 'BN 123', email: 'billing@eventsli.example' },
  }), []);
});

test('no invoice for an organizer whose billing details are incomplete — and it says what is missing', async () => {
  const { data: p } = await supabase.from('profiles').insert({
    email: `cn-bare-${stamp}@eventsli-test.invalid`, full_name: 'Bare Org', role: 'organizer',
  }).select('id').single();
  const { data: bare } = await supabase.from('organizers').insert({
    owner_user_id: p.id, display_name: 'Bare Co', country: 'CA',
  }).select('id').single();
  const saved = ids.organizer;
  try {
    ids.organizer = bare.id;
    const ev = await freshEvent();
    await sell(ev);
    const refused = await raise(ev);
    assert.equal(refused.ok, false);
    assert.equal(refused.error, 'BILLING_DETAILS_INCOMPLETE');
    assert.deepEqual(refused.organizer_missing, ['legal_name', 'billing_address', 'tax_status']);
    assert.deepEqual(refused.issuer_missing, []);
    assert.equal((await supabase.from('invoices').select('id').eq('event_id', ev.id)).data.length, 0, 'nothing was issued');

    // Registered for tax without a number is not a state the table accepts.
    const bad = await supabase.from('organizers').update({ tax_status: 'registered' }).eq('id', bare.id);
    assert.ok(bad.error);

    await supabase.from('organizers').update({
      legal_name: 'Bare Company Inc.', billing_address: '9 Billing Way\nOttawa, ON K1A 0A1\nCanada',
      tax_status: 'registered', tax_id: 'GST 99887 7665',
    }).eq('id', bare.id);
    const raised = await raise(ev);
    assert.equal(raised.ok, true, JSON.stringify(raised));
    const i = await inv(raised.invoice_id);
    assert.equal(i.recipient.tax_id, 'GST 99887 7665');
    assert.equal(i.recipient.billing_address, '9 Billing Way\nOttawa, ON K1A 0A1\nCanada');
    assert.equal(i.recipient.email, `cn-bare-${stamp}@eventsli-test.invalid`);

    // Frozen: a later change to the organizer does not rewrite the invoice.
    await supabase.from('organizers').update({ billing_address: '1 Somewhere Else, Montreal QC' }).eq('id', bare.id);
    assert.equal((await inv(raised.invoice_id)).recipient.billing_address, '9 Billing Way\nOttawa, ON K1A 0A1\nCanada');
  } finally {
    ids.organizer = saved;
  }
});
