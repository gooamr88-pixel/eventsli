const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const sessions = require('../../services/sessionService');
const notices = require('../../services/saleNoticeService');

/**
 * THE ORGANIZER'S SALE EMAILS, END TO END (2026-11-23), against the real
 * database. Email itself is not configured in tests, so what is checked is
 * the decision and the once-only claim (`organizer_notified_at`,
 * `sale_digest_last_at`), not delivery.
 */
let server; let base; let token; let ev; let orgId;
const stamp = Date.now();
const ids = { profiles: [] };

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const org = (method, path, body) => call(method, path, body, { authorization: `Bearer ${token}` });

async function buy(quantity = 2) {
  const h = await call('POST', `/public/events/${ev.slug}/hold`, { lines: [{ tierId: ev.tier, quantity }] });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  const r = await call('POST', `/public/reservations/${h.body.data.reservationId}/claim`, {
    email: `sale-buyer-${stamp}@eventsli-test.invalid`, name: 'Layla Buyer', acceptTerms: true,
    signature: { method: 'typed', name: 'Layla Buyer' },
  }, { 'x-access-token': h.body.data.reservationToken });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data.orderId;
}
async function notifiedAt(orderId, waitMs = 2000) {
  for (let t = 0; t < waitMs; t += 50) {
    const { data } = await supabase.from('orders').select('organizer_notified_at').eq('id', orderId).single();
    if (data.organizer_notified_at) return data.organizer_notified_at;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const email = `sale-org-${stamp}@eventsli-test.invalid`;
  const { data: owner } = await supabase.from('profiles').insert({
    email, full_name: 'Sale Organizer', role: 'organizer', email_verified_at: new Date().toISOString(),
  }).select('id').single();
  ids.profiles.push(owner.id);
  ({ token } = await sessions.issue(null, { userId: owner.id, email, role: 'organizer', cookie: false }));
  const { data: o } = await supabase.from('organizers').insert({ owner_user_id: owner.id, display_name: 'Sale Co', country: 'CA' }).select('id').single();
  orgId = o.id;
  const termsId = (await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single()).data.id;
  const { data: e, error } = await supabase.from('events').insert({
    organizer_id: o.id, slug: `sale-mail-${stamp}`, title: 'Sale Mail Night', country: 'CA',
    timezone: 'America/Toronto', currency: 'CAD', status: 'published', terms_accepted_id: termsId,
    admission_type: 'general', purchase_mode: 'seat_only', holder_details: 'off',
    starts_at: new Date(Date.now() + 15 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 15 * 86400e3 + 3 * 3600e3).toISOString(),
  }).select('id, slug').single();
  assert.ifError(error);
  const { data: tier } = await supabase.from('ticket_tiers').insert({ event_id: e.id, name: 'Free entry', price_cents: 0, quantity: 100 }).select('id').single();
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
  if (orgId) await supabase.from('organizers').delete().eq('id', orgId);
  await supabase.from('sessions').delete().in('user_id', ids.profiles);
  await supabase.from('profiles').delete().in('id', ids.profiles);
  await new Promise((r) => server.close(r));
});

test('by default the owner is emailed for every sale, once per order', async () => {
  const s = await org('GET', '/organizer/sale-emails');
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.data.mode, 'each');
  assert.equal(s.body.data.toOwner, true);
  assert.match(s.body.data.ownerEmail, /sale-org-/);

  const orderId = await buy(2);
  const first = await notifiedAt(orderId);
  assert.ok(first, 'the sale email was claimed for this order');
  const again = await notices.notifyOrganizer(orderId);
  assert.equal(again.sent, false, 'never twice');
  const { data } = await supabase.from('orders').select('organizer_notified_at').eq('id', orderId).single();
  assert.equal(data.organizer_notified_at, first);
});

test('the organizer adds a box office, chooses the daily summary, and per-sale emails stop', async () => {
  const bad = await org('PUT', '/organizer/sale-emails', { recipients: ['nope'] });
  assert.equal(bad.status, 400);
  const tooMany = await org('PUT', '/organizer/sale-emails', { recipients: ['1@x.t', '2@x.t', '3@x.t', '4@x.t', '5@x.t', '6@x.t'] });
  assert.equal(tooMany.status, 400);

  const saved = await org('PUT', '/organizer/sale-emails', { mode: 'daily', recipients: ['Box@Office.test'] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.mode, 'daily');
  assert.deepEqual(saved.body.data.recipients, ['box@office.test']);

  const orderId = await buy(1);
  assert.equal(await notifiedAt(orderId, 400), null, 'no per-sale email on the daily summary');
});

test('the daily summary goes once, at 8 am their time, covering what sold since the last', async () => {
  // Pretend the last summary was yesterday morning, so today's is due.
  const yesterday = new Date(Date.now() - 26 * 3600e3).toISOString();
  await supabase.from('organizers').update({ sale_digest_last_at: yesterday }).eq('id', orgId);
  // A moment that is past 8 am in Toronto today.
  const now = new Date();
  const torontoHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', hour: 'numeric', hour12: false }).format(now)) % 24;
  const at = torontoHour >= 8 ? now : new Date(now.getTime() + (8 - torontoHour) * 3600e3);

  const run = await notices.sendDigests(at);
  assert.ok(run.sent >= 1, 'our organizer got a summary');
  const { data: o } = await supabase.from('organizers').select('sale_digest_last_at').eq('id', orgId).single();
  assert.equal(new Date(o.sale_digest_last_at).toISOString(), at.toISOString());

  const second = await notices.sendDigests(at);
  const { data: o2 } = await supabase.from('organizers').select('sale_digest_last_at').eq('id', orgId).single();
  assert.equal(o2.sale_digest_last_at, o.sale_digest_last_at, 'not twice in one day');
  assert.ok(second.sent >= 0);
});

test('off means nothing; saving with nobody to send to comes back with a warning', async () => {
  const nobody = await org('PUT', '/organizer/sale-emails', { mode: 'each', toOwner: false, recipients: [] });
  assert.equal(nobody.status, 200);
  assert.match(nobody.body.data.warning, /Nobody receives/);

  await org('PUT', '/organizer/sale-emails', { mode: 'off', toOwner: true });
  const orderId = await buy(1);
  assert.equal(await notifiedAt(orderId, 400), null);
});
