const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const email = require('../services/emailService');
const { validateSetting } = require('../utils/settingsSchema');

/**
 * The commission invoice emails (BRD §18). Delivered through a stubbed Brevo,
 * so the HTML that would have been sent can be read.
 *
 * What these pin is what the audit found broken: every button pointed at
 * `/organizer/payouts` (now a redirect to Payment methods, with no invoice on
 * it), the due date was printed in UTC with no zone, nothing said where to
 * pay, and an organizer who had already sent a receipt was asked for it again.
 */

let sent;
const env = {};

beforeEach(() => {
  sent = [];
  for (const k of ['BREVO_API_KEY', 'FRONTEND_URL']) env[k] = process.env[k];
  process.env.BREVO_API_KEY = 'test';
  process.env.FRONTEND_URL = 'https://eventsli.test';
  mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 201, text: async () => '' };
  });
});

afterEach(() => {
  mock.restoreAll();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const event = {
  id: 'e1', slug: 'harbour-night', title: 'Harbour Night', startsAt: '2027-01-20T09:00:00Z',
  timezone: 'Australia/Sydney', venue: 'Opera House', city: 'Sydney',
};
const invoice = {
  number: 'INV-20270101-abcd1234-1', currency: 'CAD', amount_cents: 4250,
  due_at: '2027-01-19T09:00:00Z', order_count: 3, status: 'open',
};
const url = 'https://eventsli.test/organizer/events/e1/commission';

test('the issued invoice links to the event Commission page, not the old payouts page', async () => {
  const r = await email.sendInvoiceIssued({ to: 'o@x.test', organizerName: 'Org', invoice, event, url, instructions: null });
  assert.equal(r.sent, true);
  const html = sent[0].htmlContent;
  assert.match(html, /organizer\/events\/e1\/commission/);
  assert.doesNotMatch(html, /organizer\/payouts/);
  assert.match(sent[0].subject, /INV-20270101-abcd1234-1/);
});

test('the due date is on the event clock, with the zone named', async () => {
  await email.sendInvoiceIssued({ to: 'o@x.test', invoice, event, url });
  // 09:00 UTC on the 19th is 8:00 pm on the 19th in Sydney (AEDT).
  assert.match(sent[0].htmlContent, /8:00\s?p\.?m\.?/i);
  assert.match(sent[0].htmlContent, /Australia\/Sydney/);
});

test('payment instructions are included, escaped, with the invoice number as the reference', async () => {
  await email.sendInvoiceIssued({
    to: 'o@x.test', invoice, event, url,
    instructions: 'Eventsli Inc. <Main>\nAccount 12345',
  });
  const html = sent[0].htmlContent;
  assert.match(html, /Eventsli Inc\. &lt;Main&gt;<br>Account 12345/);
  assert.match(html, /<strong>INV-20270101-abcd1234-1<\/strong> as the payment reference/);
});

test('the overdue email does not ask for a receipt the organizer already sent', async () => {
  await email.sendInvoiceOverdue({ to: 'o@x.test', invoice: { ...invoice, status: 'submitted' }, event, url, receiptSent: true });
  const html = sent[0].htmlContent;
  assert.match(html, /We have your receipt/);
  assert.doesNotMatch(html, /Upload my receipt/);

  await email.sendInvoiceOverdue({ to: 'o@x.test', invoice, event, url });
  assert.match(sent[1].htmlContent, /Upload my receipt/);
  assert.match(sent[1].htmlContent, /organizer\/events\/e1\/commission/);
});

test('the settled email tells the truth about the door', async () => {
  await email.sendInvoiceSettled({ to: 'o@x.test', invoice, event, url, gateOpen: true, wasOverdue: true });
  assert.match(sent[0].htmlContent, /Scanning for this event is on again/);

  await email.sendInvoiceSettled({ to: 'o@x.test', invoice, event, url, gateOpen: false, wasOverdue: true });
  assert.match(sent[1].htmlContent, /still off/);

  // Never overdue: scanning was never off, so it is not "on again".
  await email.sendInvoiceSettled({ to: 'o@x.test', invoice, event, url, gateOpen: true, wasOverdue: false });
  assert.doesNotMatch(sent[2].htmlContent, /on again|still off/);
});

test('admins are told a receipt is waiting, and when a gate is shut behind it', async () => {
  await email.sendInvoiceReceiptToAdmins({
    to: 'a@x.test', organizerName: 'Org', invoice, event,
    adminUrl: 'https://eventsli.test/admin/invoices?status=submitted',
    proofUrl: 'https://bank.test/r/1', overdue: true,
  });
  assert.match(sent[0].subject, /^Gate shut — Receipt to check/);
  assert.match(sent[0].htmlContent, /bank\.test\/r\/1/);
  assert.match(sent[0].htmlContent, /admin\/invoices\?status=submitted/);
});

test('payment instructions are a validated platform setting', () => {
  const ok = validateSetting('manual_invoice', {
    due_days: 7, min_hours_before_event: 24, min_hours_from_issue: 2,
    payment_instructions: '  Bank: Eventsli\r\nRef: your invoice  ',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.payment_instructions, 'Bank: Eventsli\nRef: your invoice');
  assert.equal(ok.value.min_hours_from_issue, 2, 'the trigger reads it, so saving must keep it');

  const blank = validateSetting('manual_invoice', { due_days: 7, min_hours_before_event: 24, payment_instructions: '   ' });
  assert.equal(blank.ok, true);
  assert.equal('payment_instructions' in blank.value, false);

  assert.equal(validateSetting('manual_invoice', { due_days: 7, min_hours_before_event: 24, payment_instructions: 'x'.repeat(1001) }).ok, false);
  assert.equal(validateSetting('manual_invoice', { due_days: 7, min_hours_before_event: 24, payment_instructions: 42 }).ok, false);
});
