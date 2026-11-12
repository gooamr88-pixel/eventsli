const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');
const manual = require('../../services/manualPaymentService');
const scheduler = require('../../services/scheduler');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * INVOICE MANAGEMENT AND GATE CONTROL, through the API (migration 20261115090000).
 *
 * The properties that matter, each pinned below:
 *
 *   · every money action moves the ledger by a NEW row and the balance agrees
 *     with it — partial payments, reversals, waivers, reopening;
 *   · every action is in the invoice's history and the audit log, with the
 *     admin's reason, and the organizer hears about what concerns them;
 *   · an admin's gate decision outranks the invoices and the platform policy,
 *     ends only when its own end time passes, and no job undoes it;
 *   · the jobs follow an admin's changes (a new due date gets a new reminder
 *     and a new overdue notice) instead of the dates they first saw.
 *
 * Brevo is stubbed at `fetch`, so the emails that would have gone can be read.
 * ─────────────────────────────────────────────────────────────────────────────
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
const cookies = {};
const PASSWORD = 'a-perfectly-long-passphrase';
const mail = [];
const realFetch = globalThis.fetch;
const env = {};

const call = async (method, path, body, cookie) => {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text || 'null') };
};

async function makeUser(key, role) {
  const email = `invc-${key}-${stamp}@eventsli-test.invalid`;
  const reg = await call('POST', '/auth/register', { email, password: PASSWORD, fullName: `Test ${key}` });
  if (!reg.body?.data?.id) throw new Error(`register ${key}: ${JSON.stringify(reg.body)}`);
  ids[key] = reg.body.data.id;
  ids[`${key}Email`] = email;
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString(), role }).eq('id', ids[key]);
  const res = await realFetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  cookies[key] = (res.headers.get('set-cookie') || '').split(';')[0];
}

const mailTo = (to, from = 0) => mail.slice(from).filter((m) => m.to?.[0]?.email === to);
const owed = async () => Number((await supabase.rpc('manual_commission_owed', { p_event_id: ids.event, p_currency: 'CAD' })).data);
const gate = async () => (await supabase.rpc('scanner_is_locked', { p_event_id: ids.event })).data;
const row = async (id) => (await supabase.from('invoices').select('*').eq('id', id).single()).data;
const history = async (id) => (await supabase.from('invoice_events').select('kind, note, actor_role').eq('invoice_id', id).order('created_at')).data;

async function lease(job) {
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const n = await job();
    if (n !== null) return n;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('job lease never free');
}

let seatCursor = 0;
async function doorSale() {
  const seat = ids.seats[seatCursor];
  seatCursor += 1;
  return manual.recordSale({ eventId: ids.event, seatIds: [seat], buyer: { name: 'Walk-in' }, method: 'cash', recordedBy: ids.seller });
}

async function withSetting(patch, fn) {
  const { data: before } = await supabase.from('platform_settings').select('value').eq('key', 'manual_invoice').maybeSingle();
  await supabase.from('platform_settings').upsert({ key: 'manual_invoice', value: { ...(before?.value || {}), ...patch } }, { onConflict: 'key' });
  try { return await fn(); } finally {
    if (before) await supabase.from('platform_settings').update({ value: before.value }).eq('key', 'manual_invoice');
  }
}

before(async () => {
  for (const k of ['BREVO_API_KEY', 'FRONTEND_URL']) env[k] = process.env[k];
  process.env.BREVO_API_KEY = 'test-brevo';
  process.env.FRONTEND_URL = 'https://eventsli.test';
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.brevo.com/')) {
      mail.push(JSON.parse(init.body));
      return { ok: true, status: 201, text: async () => '' };
    }
    return realFetch(url, init);
  };

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  await makeUser('super', 'super_admin');
  await makeUser('admin', 'admin');
  await makeUser('seller', 'organizer');

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: ids.seller, display_name: 'Invoice Control Co', country: 'CA',
    legal_name: 'Invoice Control Company Ltd.',
    description: 'An organizer this suite invoices, pays, reverses, waives and voids.',
    policies_accepted_at: new Date().toISOString(),
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: ids.seller, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `invc-${stamp}`, title: 'Invoice Control Night',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id, purchase_mode: 'seat_only',
    commission_pct: 10, commission_tax_pct: 0, event_tax_pct: 0,
  }).select('id').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id;

  const { data: map } = await supabase.from('venue_maps').insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  ids.map = map.id;
  const { data: tier } = await supabase.from('ticket_tiers').insert({ event_id: ev.id, name: 'GA', price_cents: 5000 }).select('id').single();
  const { data: seats } = await supabase.from('seats').insert(
    Array.from({ length: 8 }, (_, i) => ({
      venue_map_id: map.id, tier_id: tier.id, section_key: 'Floor', row_label: 'A', seat_number: String(i + 1),
    })),
  ).select('id');
  ids.seats = seats.map((s) => s.id);
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  if (ids.event) {
    // Ledger rows are permanent, so the event and its invoices stay; the
    // people and sessions go.
    await supabase.from('scanner_access').delete().eq('event_id', ids.event);
    await supabase.from('events').update({ status: 'archived' }).eq('id', ids.event);
  }
  for (const key of ['super', 'admin', 'seller']) {
    if (!ids[key]) continue;
    await supabase.from('sessions').delete().eq('user_id', ids[key]);
  }
  await new Promise((r) => server.close(r));
});

// ── Payments ─────────────────────────────────────────────────────────────────

test('a part payment reduces the balance and the ledger, and the organizer is told', async () => {
  await doorSale();
  await doorSale();
  const raised = await call('POST', `/admin/events/${ids.event}/invoices`, {}, cookies.admin);
  assert.equal(raised.status, 201, JSON.stringify(raised.body));
  ids.a = raised.body.data.invoice_id;
  assert.equal(raised.body.data.amount_cents, 1000);

  const from = mail.length;
  const res = await call('POST', `/admin/invoices/${ids.a}/payments`, {
    amountCents: 400, method: 'e-transfer', reference: 'ET-1234', note: 'first half',
  }, cookies.admin);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'open');
  assert.equal(res.body.data.paid_cents, 400);
  assert.equal(res.body.data.balance_cents, 600);
  assert.equal(res.body.data.settled, false);
  assert.equal(await owed(), 600, 'the ledger agrees with the balance');

  const [notice] = mailTo(ids.sellerEmail, from);
  assert.match(notice.subject, /^Payment received/);
  assert.match(notice.htmlContent, /Still to pay/);

  const { data: audit } = await supabase.from('admin_audit').select('action, payload')
    .eq('target_id', ids.a).eq('action', 'invoice.payment_recorded');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].payload.reference, 'ET-1234');
});

test('more than is owed is refused', async () => {
  const res = await call('POST', `/admin/invoices/${ids.a}/payments`, { amountCents: 700 }, cookies.admin);
  assert.equal(res.status, 400);
  assert.match(res.body.message, /more than is owed/);
});

test('the organizer sees payments and history, never internal notes', async () => {
  await call('POST', `/admin/invoices/${ids.a}/notes`, { note: 'Organizer called, promised the rest Friday' }, cookies.admin);
  const res = await call('GET', `/events/${ids.event}/commission`, null, cookies.seller);
  assert.equal(res.status, 200);
  const inv = res.body.data.invoices.find((i) => i.id === ids.a);
  assert.equal(inv.balanceCents, 600);
  assert.equal(inv.payments.length, 1);
  assert.ok(inv.history.some((h) => h.kind === 'payment_recorded'));
  assert.equal(inv.history.some((h) => h.kind === 'note'), false, 'internal notes stay internal');
  assert.equal(inv.history.find((h) => h.kind === 'payment_recorded').note, null, 'and so does a payment note');
});

test('a recorded payment cannot be edited or deleted — only reversed, with a reason', async () => {
  const { data: pay } = await supabase.from('invoice_payments').select('id').eq('invoice_id', ids.a).single();
  ids.payment = pay.id;
  const edit = await supabase.from('invoice_payments').update({ amount_cents: 1 }).eq('id', pay.id);
  assert.ok(edit.error, 'an edit must be refused');
  const del = await supabase.from('invoice_payments').delete().eq('id', pay.id);
  assert.ok(del.error, 'a delete must be refused');

  const tooShort = await call('POST', `/admin/invoices/${ids.a}/payments/${pay.id}/reverse`, { reason: 'no' }, cookies.admin);
  assert.equal(tooShort.status, 400);

  const res = await call('POST', `/admin/invoices/${ids.a}/payments/${pay.id}/reverse`, { reason: 'The e-transfer bounced' }, cookies.admin);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.paid_cents, 0);
  assert.equal(await owed(), 1000);

  const { data: ledger } = await supabase.from('ledger_entries').select('entry_type, direction, amount_cents, invoice_id')
    .eq('invoice_id', ids.a).order('created_at');
  assert.deepEqual(ledger.map((l) => `${l.entry_type}:${l.direction}:${l.amount_cents}`),
    ['settlement:debit:400', 'settlement:credit:400'], 'a reversal is a new row, not an edit');

  const again = await call('POST', `/admin/invoices/${ids.a}/payments/${pay.id}/reverse`, { reason: 'Twice by mistake' }, cookies.admin);
  assert.equal(again.status, 409);
});

// ── Waive, reopen, void ─────────────────────────────────────────────────────

test('waiving writes the balance off; reopening writes it back', async () => {
  const w = await call('POST', `/admin/invoices/${ids.a}/waive`, { reason: 'Charity night, agreed with the owner' }, cookies.admin);
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.equal(w.body.data.status, 'waived');
  assert.equal(await owed(), 0);

  const r = await call('POST', `/admin/invoices/${ids.a}/reopen`, { reason: 'Waived against the wrong event' }, cookies.admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.status, 'open');
  assert.equal(r.body.data.balance_cents, 1000);
  assert.equal(await owed(), 1000);

  const kinds = (await history(ids.a)).map((h) => h.kind);
  for (const k of ['raised', 'payment_recorded', 'payment_reversed', 'waived', 'reopened', 'note']) {
    assert.ok(kinds.includes(k), `history has ${k}`);
  }
});

test('voiding returns the commission to "ready to invoice" — nothing is forgiven', async () => {
  const v = await call('POST', `/admin/invoices/${ids.a}/void`, { reason: 'Raised before the last two sales were entered' }, cookies.admin);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.data.status, 'void');
  assert.equal(await owed(), 1000, 'the debt is still owed');

  const ready = await call('GET', '/admin/invoices/ready', null, cookies.admin);
  const line = ready.body.data.find((r) => r.event.id === ids.event);
  assert.equal(line.uninvoicedCents, 1000);
  assert.equal(line.canRaise, true);

  const raised = await call('POST', `/admin/events/${ids.event}/invoices`, {}, cookies.admin);
  assert.equal(raised.status, 201);
  ids.b = raised.body.data.invoice_id;
  assert.equal(raised.body.data.order_count, 2, 'the voided invoice covered nothing');
});

test('an invoice with a payment on it cannot be voided', async () => {
  await call('POST', `/admin/invoices/${ids.b}/payments`, { amountCents: 100 }, cookies.admin);
  const v = await call('POST', `/admin/invoices/${ids.b}/void`, { reason: 'Trying to void a paid invoice' }, cookies.admin);
  assert.equal(v.status, 409);
});

// ── Due dates and receipts ──────────────────────────────────────────────────

test('a new due date reopens the gate and resets what the jobs have sent', async () => {
  await supabase.from('invoices').update({ due_at: new Date(Date.now() - 3600e3).toISOString() }).eq('id', ids.b);
  await lease(() => scheduler.markOverdueInvoices());
  assert.equal((await gate()).locked, true);
  assert.ok((await row(ids.b)).overdue_notified_at);

  const dueAt = new Date(Date.now() + 2 * 86400e3).toISOString();
  const res = await call('POST', `/admin/invoices/${ids.b}/due-date`, { dueAt, reason: 'Bank holiday, two more days' }, cookies.admin);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'open');
  assert.equal(res.body.data.gate.locked, false);

  const after = await row(ids.b);
  assert.equal(after.overdue_notified_at, null, 'it will be announced again if the NEW date passes');
  assert.equal(after.reminder_sent_at, null);
  assert.ok(after.due_at_original, 'the first due date is kept');
});

test('a receipt can be turned down; the organizer sees why and can send another', async () => {
  const sent = await call('POST', `/events/${ids.event}/invoices/${ids.b}/proof`, { proofUrl: 'https://bank.example/r/1' }, cookies.seller);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.data.status, 'submitted');

  const from = mail.length;
  const no = await call('POST', `/admin/invoices/${ids.b}/reject-receipt`, { reason: 'The amount on it is 1.00, not 9.00' }, cookies.admin);
  assert.equal(no.status, 200, JSON.stringify(no.body));
  assert.equal(no.body.data.status, 'open');
  assert.match(mailTo(ids.sellerEmail, from)[0].subject, /^Receipt not accepted/);

  const view = await call('GET', `/events/${ids.event}/commission`, null, cookies.seller);
  assert.equal(view.body.data.invoices.find((i) => i.id === ids.b).receiptRejectionReason, 'The amount on it is 1.00, not 9.00');

  const again = await call('POST', `/events/${ids.event}/invoices/${ids.b}/proof`, { proofUrl: 'https://bank.example/r/2' }, cookies.seller);
  assert.equal(again.status, 200);
  assert.equal((await row(ids.b)).receipt_rejection_reason, null);
});

test('settling the rest closes it, and the organizer is told', async () => {
  const from = mail.length;
  const res = await call('POST', `/admin/invoices/${ids.b}/settle`, { note: 'Transfer seen' }, cookies.admin);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'paid');
  assert.equal(res.body.data.paid_cents, 1000);
  assert.match(mailTo(ids.sellerEmail, from)[0].subject, /^Payment confirmed/);
  assert.equal(await owed(), 0);
});

// ── Reminders ───────────────────────────────────────────────────────────────

test('a reminder goes once before the due date, and again after the date moves', async () => {
  await doorSale();
  const raised = await call('POST', `/admin/events/${ids.event}/invoices`, {}, cookies.admin);
  ids.c = raised.body.data.invoice_id;
  await supabase.from('invoices').update({ due_at: new Date(Date.now() + 24 * 3600e3).toISOString() }).eq('id', ids.c);

  const from = mail.length;
  await lease(() => scheduler.sendInvoiceReminders());
  assert.equal(mailTo(ids.sellerEmail, from).filter((m) => /^Reminder/.test(m.subject)).length, 1);
  await lease(() => scheduler.sendInvoiceReminders());
  assert.equal(mailTo(ids.sellerEmail, from).filter((m) => /^Reminder/.test(m.subject)).length, 1, 'once');

  await call('POST', `/admin/invoices/${ids.c}/due-date`, {
    dueAt: new Date(Date.now() + 30 * 3600e3).toISOString(), reason: 'Moved to after the weekend',
  }, cookies.admin);
  await lease(() => scheduler.sendInvoiceReminders());
  assert.equal(mailTo(ids.sellerEmail, from).filter((m) => /^Reminder/.test(m.subject)).length, 2, 'before the new date');
});

// ── The gate ────────────────────────────────────────────────────────────────

test('only a super admin controls the gate', async () => {
  const body = { mode: 'closed', reason: 'Testing the permissions' };
  assert.equal((await call('POST', `/admin/events/${ids.event}/gate`, body, cookies.admin)).status, 403);
  assert.equal((await call('POST', `/admin/events/${ids.event}/gate`, body, cookies.seller)).status, 403);
  assert.equal((await call('GET', `/admin/invoices/${ids.c}`, null, cookies.seller)).status, 403);
});

test('closed by an admin outranks invoices that are all paid up', async () => {
  const from = mail.length;
  const res = await call('POST', `/admin/events/${ids.event}/gate`, { mode: 'closed', reason: 'Dispute with the venue' }, cookies.super);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.gate.locked, true);
  assert.equal(res.body.data.gate.reason, 'admin_closed');
  assert.equal(res.body.data.organizerNotified, true);
  assert.match(mailTo(ids.sellerEmail, from)[0].subject, /^Scanning switched off by Eventsli/);

  // Settling something does not reopen a gate an admin closed.
  await supabase.rpc('settle_invoice', { p_invoice_id: ids.c, p_admin_id: ids.admin, p_note: null });
  assert.equal((await gate()).reason, 'admin_closed');

  const { data: audit } = await supabase.from('admin_audit').select('payload').eq('target_id', ids.event).eq('action', 'scanner.mode');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].payload.after.reason, 'admin_closed');
});

test('kept open by an admin outranks an overdue invoice, and ends at its own time', async () => {
  await doorSale();
  const raised = await call('POST', `/admin/events/${ids.event}/invoices`, {}, cookies.admin);
  ids.d = raised.body.data.invoice_id;
  await supabase.from('invoices').update({ due_at: new Date(Date.now() - 3600e3).toISOString() }).eq('id', ids.d);

  const until = new Date(Date.now() + 3600e3).toISOString();
  const res = await call('POST', `/admin/events/${ids.event}/gate`, { mode: 'open', until, reason: 'Doors are open, paying tomorrow' }, cookies.super);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.gate.locked, false);
  assert.equal(res.body.data.gate.reason, 'admin_open');
  assert.equal(res.body.data.gate.overdue_invoices, 1);

  // The overdue job runs: the invoice is labelled, the admin's decision stands,
  // and the organizer is told it is overdue — not that scanning stopped.
  const from = mail.length;
  await lease(() => scheduler.markOverdueInvoices());
  assert.equal((await gate()).locked, false);
  const notice = mailTo(ids.sellerEmail, from).find((m) => /overdue|Scanning disabled/i.test(m.subject));
  assert.match(notice.subject, /^Invoice overdue/);

  // Its end time passes: back to following the invoices — which lock it.
  await supabase.from('scanner_access').update({ mode_until: new Date(Date.now() - 1000).toISOString() }).eq('event_id', ids.event);
  const g = await gate();
  assert.equal(g.locked, true);
  assert.equal(g.reason, 'commission_overdue');
  assert.equal(g.mode, 'auto');

  const past = await call('POST', `/admin/events/${ids.event}/gate`, {
    mode: 'open', until: new Date(Date.now() - 60e3).toISOString(), reason: 'Already over',
  }, cookies.super);
  assert.equal(past.status, 400);
});

test('the platform policy: grace hours, enforcement off, and a receipt pausing enforcement', async () => {
  await call('POST', `/admin/events/${ids.event}/gate`, { mode: 'auto', reason: 'Back to the invoices' }, cookies.super);
  assert.equal((await gate()).locked, true);

  await withSetting({ grace_hours: 2 }, async () => {
    const g = await gate();
    assert.equal(g.locked, false, 'one hour overdue is inside a two-hour grace');
    assert.ok(g.locks_at);
  });
  await withSetting({ enforce_gate: false }, async () => {
    const g = await gate();
    assert.equal(g.locked, false);
    assert.equal(g.reason, 'enforcement_off');
  });

  await call('POST', `/events/${ids.event}/invoices/${ids.d}/proof`, { proofUrl: 'https://bank.example/r/3' }, cookies.seller);
  assert.equal((await gate()).locked, true, 'by default a receipt does not reopen the gate');
  await withSetting({ pause_on_receipt: true }, async () => {
    assert.equal((await gate()).locked, false);
  });
});

test('the admin detail offers only what the rules allow', async () => {
  const res = await call('GET', `/admin/invoices/${ids.d}`, null, cookies.admin);
  assert.equal(res.status, 200);
  const { actions, history: h, invoice } = res.body.data;
  assert.equal(invoice.status, 'submitted');
  assert.equal(actions.rejectReceipt, true);
  assert.equal(actions.reopen, false);
  assert.equal(actions.void, true);
  assert.ok(h.length >= 2);

  const paid = await call('GET', `/admin/invoices/${ids.b}`, null, cookies.admin);
  assert.equal(paid.body.data.actions.settle, false);
  assert.equal(paid.body.data.actions.reversePayment, true);
});
