const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Dry run: the whole pipeline runs, nothing is texted. Fake credentials only
// let the console's "provider has credentials" check pass; no request leaves.
process.env.SMS_DRY_RUN = 'true';
process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || 'ACintegration';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'integration-token';
// A fixed TEST key (32 bytes) so credential storage can be exercised. Never a real one.
process.env.SMS_CREDENTIALS_KEY = process.env.SMS_CREDENTIALS_KEY || Buffer.alloc(32, 7).toString('base64');
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');
const dispatcher = require('../../services/sms/dispatcher');
const queue = require('../../services/sms/queue');
const config = require('../../services/sms/config');
const auth = require('../../services/sms/webhookAuth');

/**
 * Global SMS against the real database: the guards the schema holds, the
 * console's configuration flow, dispatch, receipts, STOP, four eyes, and the
 * crash-recovery rule that never resends an uncertain message.
 *
 * Uses a private test country (ZQ, +999) so it touches no real country's rows.
 */

let server; let baseUrl;
const stamp = Date.now();
const ids = {};
const cookies = {};
const PASSWORD = 'a-perfectly-long-passphrase';
const ISO = 'ZQ';
const PHONE = `+9991${String(stamp).slice(-7)}`;
let savedSettings; let savedTwilio;

const call = async (method, path, body, cookie) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text || 'null'); } catch { /* xml or empty */ }
  return { status: res.status, body: parsed, text };
};

async function makeUser(key, role) {
  const email = `sms-${key}-${stamp}@eventsli-test.invalid`;
  const reg = await call('POST', '/auth/register', { email, password: PASSWORD, fullName: `SMS ${key}` });
  ids[key] = reg.body?.data?.id;
  if (!ids[key]) throw new Error(`register ${key}: ${reg.text}`);
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString(), role }).eq('id', ids[key]);
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  cookies[key] = (res.headers.get('set-cookie') || '').split(';')[0];
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  ({ data: savedSettings } = await supabase.from('sms_settings').select('*').eq('id', 1).single());
  ({ data: savedTwilio } = await supabase.from('sms_providers').select('enabled').eq('id', 'twilio').single());
  await makeUser('super', 'super_admin');
  await makeUser('admin', 'admin');
  await makeUser('admin2', 'admin');
});

after(async () => {
  await supabase.from('sms_messages').delete().eq('country', ISO);
  await supabase.from('sms_suppressions').delete().like('phone_e164', '+9991%');
  await supabase.from('sms_consents').delete().like('phone_e164', '+9991%');
  await supabase.from('sms_consent_log').delete().like('phone_e164', '+9991%');
  await supabase.from('sms_inbound').delete().like('from_e164', '+9991%');
  if (ids.campaign) await supabase.from('sms_campaigns').delete().eq('id', ids.campaign);
  if (ids.segment) await supabase.from('sms_segments').delete().eq('id', ids.segment);
  await supabase.from('sms_routes').delete().eq('country', ISO);
  await supabase.from('sms_countries').delete().eq('iso2', ISO);
  if (ids.sender) await supabase.from('sms_senders').delete().eq('id', ids.sender);
  if (savedSettings) await supabase.from('sms_settings').update({ sending_enabled: savedSettings.sending_enabled }).eq('id', 1);
  if (savedTwilio) await supabase.from('sms_providers').update({ enabled: savedTwilio.enabled, circuit_open_until: null, consecutive_failures: 0 }).eq('id', 'twilio');
  for (const key of ['super', 'admin', 'admin2', 'org']) {
    if (!ids[key]) continue;
    await supabase.from('admin_audit').delete().eq('actor_id', ids[key]);
    await supabase.from('sessions').delete().eq('user_id', ids[key]);
    await supabase.from('profiles').delete().eq('id', ids[key]);
    await supabase.auth.admin.deleteUser(ids[key]).catch(() => {});
  }
  config.invalidate();
  await new Promise((r) => server.close(r));
});

test('the anon key reads no SMS table and calls no SMS function', { skip: !process.env.SUPABASE_ANON_KEY && 'SUPABASE_ANON_KEY is not set' }, async () => {
  const rest = (p, init = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1${p}`, {
    ...init, headers: { apikey: process.env.SUPABASE_ANON_KEY, authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
  });
  for (const t of ['sms_messages', 'sms_consents', 'sms_suppressions', 'sms_settings', 'sms_routes']) {
    const res = await rest(`/${t}?select=*&limit=1`);
    assert.ok([401, 403, 404].includes(res.status), `${t}: ${res.status}`);
  }
  const rpc = await rest('/rpc/sms_claim_batch', { method: 'POST', body: '{"p_holder":"x"}' });
  assert.ok([401, 403, 404].includes(rpc.status), `sms_claim_batch: ${rpc.status}`);
});

test('a plain admin cannot change configuration; a super admin can', async () => {
  const denied = await call('PATCH', '/admin/sms/settings', { sendingEnabled: true }, cookies.admin);
  assert.equal(denied.status, 403);
  const read = await call('GET', '/admin/sms/overview', null, cookies.admin);
  assert.equal(read.status, 200, read.text);
  assert.ok(read.body.data.countries.total >= 240, 'the catalogue is seeded');
});

test('NO COUNTRY IS ENABLED UNTIL VERIFIED — the API and the database both refuse', async () => {
  const created = await call('POST', '/admin/sms/countries', {
    iso2: ISO, name: 'Testland', dialCode: '999', timezone: 'UTC', region: 'Other',
  }, cookies.super);
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.data.status, 'unverified');
  assert.deepEqual(created.body.data.missing.sort(), ['sender_rules', 'verification', 'verified_route']);

  const refused = await call('POST', `/admin/sms/countries/${ISO}/status`, { status: 'enabled' }, cookies.super);
  assert.equal(refused.status, 409, refused.text);

  // Straight at the database, bypassing the API: still refused.
  const { error } = await supabase.from('sms_countries').update({ status: 'enabled' }).eq('iso2', ISO);
  assert.ok(error, 'the CHECK / trigger must refuse an unverified country');
});

test('configure → verify → enable → send → receipt, end to end (dry run)', async () => {
  let r = await call('PATCH', '/admin/sms/providers/twilio', { enabled: true }, cookies.super);
  assert.equal(r.status, 200, r.text);
  r = await call('POST', '/admin/sms/senders', {
    providerId: 'twilio', kind: 'long_code', value: '+15005550006', label: 'Integration', countries: [],
  }, cookies.super);
  assert.equal(r.status, 201, r.text);
  ids.sender = r.body.data.id;

  // Verifying with no route is refused: the order of the work is enforced.
  r = await call('POST', `/admin/sms/countries/${ISO}/verify`, { source: 'Twilio guideline page' }, cookies.super);
  assert.equal(r.status, 409);

  r = await call('PATCH', `/admin/sms/countries/${ISO}`, { senderIdSupport: 'not_supported', marketingAllowed: true }, cookies.super);
  assert.equal(r.status, 200, r.text);
  r = await call('PUT', `/admin/sms/countries/${ISO}/routes/twilio`, { verified: true, active: true, costMicros: 7500, currency: 'USD' }, cookies.super);
  assert.equal(r.status, 200, r.text);
  r = await call('POST', `/admin/sms/countries/${ISO}/verify`, { source: 'https://www.twilio.com/en-us/guidelines/zq/sms (test)' }, cookies.super);
  assert.equal(r.status, 200, r.text);
  r = await call('POST', `/admin/sms/countries/${ISO}/status`, { status: 'enabled' }, cookies.super);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.status, 'enabled');
  r = await call('PATCH', '/admin/sms/settings', { sendingEnabled: true }, cookies.super);
  assert.equal(r.status, 200, r.text);

  const sent = await call('POST', '/admin/sms/test', { to: PHONE, body: 'Integration hello', category: 'participant' }, cookies.admin);
  assert.equal(sent.status, 201, sent.text);
  const id = sent.body.data.id;

  await dispatcher.runOnce({ budgetMs: 10_000 });
  let { data: msg } = await supabase.from('sms_messages').select('*').eq('id', id).single();
  assert.equal(msg.status, 'sent', `${msg.status} ${msg.block_reason || ''} ${msg.last_error || ''}`);
  assert.equal(msg.provider_id, 'twilio');
  assert.match(msg.provider_message_id, /^dry-/);
  assert.equal(msg.est_cost_micros, 7500);
  const { data: attempts } = await supabase.from('sms_attempts').select('outcome').eq('message_id', id);
  assert.deepEqual(attempts.map((a) => a.outcome), ['accepted']);

  // A forged receipt changes nothing.
  const forged = await call('POST', `/sms/webhooks/twilio/status?mid=${id}&t=forged`, { MessageSid: msg.provider_message_id, MessageStatus: 'failed' });
  assert.equal(forged.status, 403);

  // A real one (our per-message token) moves it forward — and only forward.
  const url = `/sms/webhooks/twilio/status?mid=${id}&t=${auth.sign(`status:${id}`)}`;
  assert.equal((await call('POST', url, { MessageSid: msg.provider_message_id, MessageStatus: 'delivered' })).status, 204);
  assert.equal((await call('POST', url, { MessageSid: msg.provider_message_id, MessageStatus: 'sent' })).status, 204);
  ({ data: msg } = await supabase.from('sms_messages').select('status, delivered_at').eq('id', id).single());
  assert.equal(msg.status, 'delivered', 'a late "sent" never undoes "delivered"');
  assert.ok(msg.delivered_at);
});

test('the same idempotency key queues once', async () => {
  const input = { category: 'participant', to: PHONE, body: 'Once only', idempotencyKey: `it:${stamp}:once` };
  const a = await queue.enqueue(input);
  const b = await queue.enqueue(input);
  assert.equal(a.queued, true);
  assert.equal(b.duplicate, true);
  const { count } = await supabase.from('sms_messages').select('id', { count: 'exact', head: true }).eq('idempotency_key', input.idempotencyKey);
  assert.equal(count, 1);
  await supabase.from('sms_messages').delete().eq('idempotency_key', input.idempotencyKey);
});

test('two workers claiming at once never get the same message', async () => {
  const keys = Array.from({ length: 10 }, (_, i) => `it:${stamp}:claim:${i}`);
  for (const k of keys) await queue.enqueue({ category: 'participant', to: PHONE, body: 'Claim', idempotencyKey: k });
  const [a, b] = await Promise.all([
    supabase.rpc('sms_claim_batch', { p_holder: 'worker-a', p_limit: 10, p_lease_seconds: 60 }),
    supabase.rpc('sms_claim_batch', { p_holder: 'worker-b', p_limit: 10, p_lease_seconds: 60 }),
  ]);
  const got = [...(a.data || []), ...(b.data || [])].filter((m) => keys.includes(m.idempotency_key)).map((m) => m.id);
  assert.equal(new Set(got).size, got.length, 'no message claimed twice');
  assert.equal(got.length, 10);
  await supabase.from('sms_messages').delete().in('idempotency_key', keys);
});

test('a worker that died mid-call leaves the message UNKNOWN, never requeued', async () => {
  const { data: rows } = await supabase.from('sms_messages').insert([
    { idempotency_key: `it:${stamp}:stale1`, category: 'participant', traffic_class: 'transactional', to_e164: PHONE, country: ISO,
      body: 'x', status: 'sending', attempts: 1, lease_until: new Date(Date.now() - 60_000).toISOString(), lease_holder: 'dead' },
    { idempotency_key: `it:${stamp}:stale2`, category: 'participant', traffic_class: 'transactional', to_e164: PHONE, country: ISO,
      body: 'y', status: 'sending', attempts: 0, lease_until: new Date(Date.now() - 60_000).toISOString(), lease_holder: 'dead' },
  ]).select('id, idempotency_key');
  const called = rows.find((r) => r.idempotency_key.endsWith('stale1'));
  await supabase.from('sms_attempts').insert({ message_id: called.id, attempt_no: 1, provider_id: 'twilio', outcome: 'pending' });

  const { data: result, error } = await supabase.rpc('sms_release_stale');
  assert.ifError(error);
  assert.ok(result[0].uncertain >= 1 && result[0].requeued >= 1);
  const { data: after } = await supabase.from('sms_messages').select('idempotency_key, status').in('id', rows.map((r) => r.id));
  const by = Object.fromEntries(after.map((m) => [m.idempotency_key.split(':').pop(), m.status]));
  assert.equal(by.stale1, 'unknown', 'the provider may have it: do not resend');
  assert.equal(by.stale2, 'queued', 'no provider call happened: safe to send');

  // Retrying an unknown message needs the duplicate risk accepted, by a super admin.
  assert.equal((await call('POST', `/admin/sms/messages/${called.id}/retry`, {}, cookies.admin)).status, 403);
  assert.equal((await call('POST', `/admin/sms/messages/${called.id}/retry`, {}, cookies.super)).status, 409);
  assert.equal((await call('POST', `/admin/sms/messages/${called.id}/retry`, { acceptDuplicateRisk: true }, cookies.super)).status, 200);
});

test('STOP by reply suppresses the number; the next message is held back; an admin cannot undo it', async () => {
  const forged = await call('POST', '/sms/webhooks/vonage/inbound?t=nope', { msisdn: PHONE.slice(1), text: 'STOP', messageId: `in-${stamp}` });
  assert.equal(forged.status, 403);
  const ok = await call('POST', `/sms/webhooks/vonage/inbound?t=${auth.sign('inbound:vonage')}`, { msisdn: PHONE.slice(1), text: 'stop', messageId: `in-${stamp}` });
  assert.equal(ok.status, 200, ok.text);
  const { data: sup } = await supabase.from('sms_suppressions').select('reason, scope').eq('phone_e164', PHONE).single();
  assert.deepEqual(sup, { reason: 'stop_keyword', scope: 'all' });

  const q = await queue.enqueue({ category: 'participant', to: PHONE, body: 'After stop', idempotencyKey: `it:${stamp}:afterstop` });
  await dispatcher.runOnce({ budgetMs: 10_000 });
  const { data: msg } = await supabase.from('sms_messages').select('status, block_reason').eq('id', q.id).single();
  assert.deepEqual(msg, { status: 'blocked', block_reason: 'suppressed' });

  const key = Buffer.from(PHONE).toString('base64url');
  assert.equal((await call('DELETE', `/admin/sms/suppressions/${key}`, null, cookies.super)).status, 409);

  // START from the person themselves lifts it.
  await call('POST', `/sms/webhooks/vonage/inbound?t=${auth.sign('inbound:vonage')}`, { msisdn: PHONE.slice(1), text: 'START', messageId: `in2-${stamp}` });
  const { data: gone } = await supabase.from('sms_suppressions').select('phone_e164').eq('phone_e164', PHONE).maybeSingle();
  assert.equal(gone, null);
});

test('an import never re-subscribes someone who opted out', async () => {
  const other = `+9992${String(stamp).slice(-7)}`.replace('+9992', '+9991');
  await supabase.from('sms_consents').upsert({ phone_e164: other, scope: 'platform', status: 'opted_out', source: 'keyword' });
  const r = await call('POST', '/admin/sms/consents/import', {
    phones: [other, PHONE, 'not a number'], evidence: 'Integration test sign-up sheet, opt-in checkbox, Nov 2026',
  }, cookies.super);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.keptOptOut, 1);
  assert.equal(r.body.data.invalid, 1);
  const { data } = await supabase.from('sms_consents').select('status').eq('phone_e164', other).eq('scope', 'platform').single();
  assert.equal(data.status, 'opted_out');
});

test('a campaign needs a SECOND admin', async () => {
  let r = await call('PATCH', '/admin/sms/categories/marketing', { enabled: true }, cookies.super);
  assert.equal(r.status, 200, r.text);
  r = await call('POST', '/admin/sms/segments', { name: `IT ${stamp}`, definition: { recipientCountries: [ISO] } }, cookies.admin);
  assert.equal(r.status, 201, r.text);
  ids.segment = r.body.data.id;
  r = await call('POST', '/admin/sms/campaigns', { name: `IT campaign ${stamp}`, category: 'marketing', body: 'Offer', segmentId: ids.segment }, cookies.admin);
  assert.equal(r.status, 201, r.text);
  ids.campaign = r.body.data.id;
  assert.equal(r.body.data.preview.body, 'Eventsli: Offer\nReply STOP to opt out');

  r = await call('POST', `/admin/sms/campaigns/${ids.campaign}/submit`, {}, cookies.admin);
  assert.equal(r.body.data.status, 'pending_approval');
  r = await call('POST', `/admin/sms/campaigns/${ids.campaign}/approve`, {}, cookies.admin);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'SELF_ACTION');

  // Even straight at the database: the CHECK refuses self-approval.
  const { error } = await supabase.from('sms_campaigns').update({ approved_by: ids.admin }).eq('id', ids.campaign);
  assert.ok(error, 'sms_campaign_four_eyes');

  r = await call('POST', `/admin/sms/campaigns/${ids.campaign}/approve`, {}, cookies.admin2);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.data.status, 'approved');
  r = await call('POST', `/admin/sms/campaigns/${ids.campaign}/cancel`, {}, cookies.admin2);
  assert.equal(r.body.data.status, 'cancelled');
  await call('PATCH', '/admin/sms/categories/marketing', { enabled: false }, cookies.super);
});

test('analytics aggregate in the database', async () => {
  const r = await call('GET', '/admin/sms/analytics?days=7', null, cookies.admin);
  assert.equal(r.status, 200, r.text);
  const zq = r.body.data.current.byCountry.find((c) => c.country === ISO);
  assert.ok(zq && zq.delivered >= 1, 'the delivered test message is counted');
});

// ─── End to end: the four categories, consent, organizers, credentials ─────
// Run here, after the tests above and in this same process: both change
// platform-wide SMS state, so they must not run in parallel. See the part file.
require('./smsFlows.part')({
  call, cookies, ids, stamp, PASSWORD, makeUser, baseUrl: () => baseUrl,
});
