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
 * A COMMISSION INVOICE, END TO END — through the API, with the emails it sends.
 *
 *   door sale → "ready to invoice" → admin raises → organizer emailed
 *   → falls due → gate shuts, organizer emailed ONCE
 *   → organizer sends a receipt → admins emailed, receipt stays in the queue
 *   → admin settles → gate opens, organizer emailed
 *
 * Every arrow here was missing or broken before 2026-11-11: no screen raised an
 * invoice, two of the organizer emails had no caller, no admin heard about a
 * receipt, the hourly job knocked receipts back to "overdue" and re-sent the
 * "scanning disabled" email, and settling reported the gate from the balance
 * rather than from the gate.
 *
 * Brevo is stubbed at `fetch`, so what would have been sent can be read.
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
  const email = `invd-${key}-${stamp}@eventsli-test.invalid`;
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

/** Mail sent to `to` since `from` (an index into `mail`). */
const mailTo = (to, from = 0) => mail.slice(from).filter((m) => m.to?.[0]?.email === to);

/** The overdue job takes a lease; another suite may briefly hold it. */
async function runOverdueJob() {
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const n = await scheduler.markOverdueInvoices();
    if (n !== null) return n;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the overdue job lease was never free');
}

/** Lets a fire-and-forget notice finish. */
const settleBackground = () => new Promise((r) => setTimeout(r, 400));

async function doorSale(seatId) {
  return manual.recordSale({
    eventId: ids.event, seatIds: [seatId], buyer: { name: 'Walk-in' }, method: 'cash', recordedBy: ids.seller,
  });
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

  await makeUser('admin', 'admin');
  await makeUser('seller', 'organizer');

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: ids.seller, display_name: 'Invoice Delivery Co', country: 'CA',
    legal_name: 'Invoice Delivery Company Ltd.',
    description: 'An organizer this suite invoices from door sale to settlement.',
    policies_accepted_at: new Date().toISOString(),
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: ids.seller, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `invd-${stamp}`, title: 'Invoice Delivery Night',
    country: 'CA', timezone: 'Australia/Sydney',
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
    Array.from({ length: 4 }, (_, i) => ({
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
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', ids.event);
    for (const o of orders || []) {
      await supabase.from('tickets').delete().eq('order_id', o.id);
      await supabase.from('order_items').delete().eq('order_id', o.id);
    }
    await supabase.from('orders').delete().eq('event_id', ids.event);
    await supabase.from('invoices').delete().eq('event_id', ids.event);
    await supabase.from('scanner_access').delete().eq('event_id', ids.event);
    await supabase.from('seats').delete().eq('venue_map_id', ids.map);
    await supabase.from('venue_maps').delete().eq('event_id', ids.event);
    await supabase.from('ticket_tiers').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  for (const key of ['admin', 'seller']) {
    if (!ids[key]) continue;
    await supabase.from('admin_audit').delete().eq('actor_id', ids[key]);
    await supabase.from('sessions').delete().eq('user_id', ids[key]);
    await supabase.from('terms_acceptances').delete().eq('user_id', ids[key]);
    await supabase.from('profiles').delete().eq('id', ids[key]);
  }
  await new Promise((r) => server.close(r));
});

test('a door sale puts the event in the admin "ready to invoice" queue', async () => {
  await doorSale(ids.seats[0]);

  const res = await call('GET', '/admin/invoices/ready', null, cookies.admin);
  assert.equal(res.status, 200);
  const row = res.body.data.find((r) => r.event.id === ids.event);
  assert.ok(row, 'the event must be listed');
  assert.equal(row.uninvoicedCents, 500, '10% of a $50 door sale');
  assert.equal(row.canRaise, true);
  assert.equal(row.doorSales, 1);

  // An organizer cannot see the platform's receivables queue.
  assert.equal((await call('GET', '/admin/invoices/ready', null, cookies.seller)).status, 403);
});

test('raising the invoice emails the organizer, with the Commission page link and the due date on the venue clock', async () => {
  const from = mail.length;
  const res = await call('POST', `/admin/events/${ids.event}/invoices`, {}, cookies.admin);
  assert.equal(res.status, 201);
  assert.equal(res.body.data.organizerNotified, true);
  ids.invoice = res.body.data.invoice_id;
  ids.number = res.body.data.number;

  const [sent] = mailTo(ids.sellerEmail, from);
  assert.ok(sent, 'the organizer must be emailed the invoice');
  assert.match(sent.subject, new RegExp(ids.number));
  assert.match(sent.htmlContent, new RegExp(`/organizer/events/${ids.event}/commission`));
  assert.doesNotMatch(sent.htmlContent, /organizer\/payouts/);
  assert.match(sent.htmlContent, /Australia\/Sydney/);
  assert.match(sent.htmlContent, /payment reference/);

  const ready = await call('GET', '/admin/invoices/ready', null, cookies.admin);
  assert.equal(ready.body.data.some((r) => r.event.id === ids.event), false, 'fully invoiced, so off the queue');
});

test('falling due shuts the gate and emails the organizer exactly once', async () => {
  await supabase.from('invoices').update({ due_at: new Date(Date.now() - 3600e3).toISOString() }).eq('id', ids.invoice);

  const from = mail.length;
  await runOverdueJob();
  const first = mailTo(ids.sellerEmail, from);
  assert.equal(first.length, 1);
  assert.match(first[0].subject, /^Scanning disabled/);
  assert.match(first[0].htmlContent, /Upload my receipt/);

  const { data: row } = await supabase.from('invoices').select('status, overdue_notified_at').eq('id', ids.invoice).single();
  assert.equal(row.status, 'overdue');
  assert.ok(row.overdue_notified_at);

  await runOverdueJob();
  assert.equal(mailTo(ids.sellerEmail, from).length, 1, 'a second run must not email again');
});

test('a receipt on an overdue invoice reaches the admins and stays in the review queue', async () => {
  const from = mail.length;
  const res = await call('POST', `/events/${ids.event}/invoices/${ids.invoice}/proof`,
    { proofUrl: 'https://bank.example/receipt/1' }, cookies.seller);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.amountCents, 500, 'the real invoice comes back, not a made-up one');
  assert.equal(res.body.data.gateReopened, false);

  await settleBackground();
  const toAdmin = mailTo(ids.adminEmail, from);
  assert.equal(toAdmin.length, 1, 'an admin must be told there is a receipt to check');
  assert.match(toAdmin[0].subject, /Gate shut — Receipt to check/);

  // The hourly job used to move it straight back to 'overdue' and email
  // "Scanning disabled" again.
  await runOverdueJob();
  const { data: row } = await supabase.from('invoices').select('status').eq('id', ids.invoice).single();
  assert.equal(row.status, 'submitted');
  assert.equal(mailTo(ids.sellerEmail, from).length, 0, 'no second "scanning disabled" email');

  const submitted = await call('GET', '/admin/invoices?status=submitted', null, cookies.admin);
  assert.ok(submitted.body.data.some((i) => i.id === ids.invoice), 'in the receipt queue');
  const overdue = await call('GET', '/admin/invoices?status=overdue', null, cookies.admin);
  assert.ok(overdue.body.data.some((i) => i.id === ids.invoice), 'and still counted as overdue');
});

test('the organizer sees how to pay and what is not invoiced yet', async () => {
  await doorSale(ids.seats[1]);   // after the invoice: goes on the next one
  const res = await call('GET', `/events/${ids.event}/commission`, null, cookies.seller);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.uninvoicedCents, 500);
  assert.ok('paymentInstructions' in res.body.data);
  assert.equal(res.body.data.gate.locked, true);
});

test('settling opens the gate, says so truthfully, and emails the organizer', async () => {
  const from = mail.length;
  const res = await call('POST', `/admin/invoices/${ids.invoice}/settle`, { note: 'Transfer seen' }, cookies.admin);
  assert.equal(res.status, 200);
  // A newer door sale is still owed (no invoice yet), so the BALANCE is not
  // zero — but no invoice is overdue, so the gate is open. This used to say
  // "scanning stays off".
  assert.ok(res.body.data.remaining_owed_cents > 0);
  assert.equal(res.body.data.gateReopened, true);
  assert.equal(res.body.data.organizerNotified, true);

  const [sent] = mailTo(ids.sellerEmail, from);
  assert.ok(sent, 'the organizer must be told it is settled');
  assert.match(sent.subject, /^Payment confirmed/);
  assert.match(sent.htmlContent, /on again/);

  // Settling twice is not news.
  const again = mail.length;
  const twice = await call('POST', `/admin/invoices/${ids.invoice}/settle`, {}, cookies.admin);
  assert.equal(twice.body.data.already_settled, true);
  assert.equal(mailTo(ids.sellerEmail, again).length, 0);

  // The newer sale is back in the queue, raisable again.
  const ready = await call('GET', '/admin/invoices/ready', null, cookies.admin);
  const row = ready.body.data.find((r) => r.event.id === ids.event);
  assert.equal(row?.canRaise, true);
});

test('an unknown status filter is a 400, not a database error', async () => {
  assert.equal((await call('GET', '/admin/invoices?status=bogus', null, cookies.admin)).status, 400);
});
