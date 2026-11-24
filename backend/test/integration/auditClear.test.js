const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * Clearing the audit log (owner, 2026-11-24): a super admin's, with a reason
 * and CLEAR typed; earlier clearings are never removed, and the clearing is
 * itself recorded.
 */
let server; let baseUrl;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const users = [];
const marker = `audit-clear-test-${stamp}`;

async function account(role) {
  const email = `auditclear-${role}-${stamp}@eventsli-test.invalid`;
  const reg = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, fullName: `Audit ${role}` }),
  });
  const id = (await reg.json()).data.id;
  users.push(id);
  await supabase.from('profiles').update({ role, email_verified_at: new Date().toISOString() }).eq('id', id);
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (login.headers.get('set-cookie') || '').split(';')[0];
}

const call = async (path, body, cookie) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

let superCookie; let adminCookie;
before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  superCookie = await account('super_admin');
  adminCookie = await account('admin');
  const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
  await supabase.from('admin_audit').insert([
    { action: 'settings.changed', target_type: 'test', payload: { marker }, created_at: ago(400) },
    { action: 'audit.cleared', target_type: 'admin_audit', payload: { marker }, created_at: ago(500) },
    { action: 'settings.changed', target_type: 'test', payload: { marker }, created_at: ago(1) },
  ]);
});

after(async () => {
  await supabase.from('admin_audit').delete().contains('payload', { marker });
  await supabase.from('admin_audit').delete().in('actor_id', users);
  for (const id of users) {
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

const mine = async () => (await supabase.from('admin_audit').select('action, created_at').contains('payload', { marker })).data;

test('an admin who is not a super admin cannot clear it', async () => {
  const res = await call('/admin/audit/clear', { scope: 'all', confirm: 'CLEAR', reason: 'Not allowed to do this' }, adminCookie);
  assert.equal(res.status, 403);
});

test('without CLEAR typed, or without a reason, nothing is removed', async () => {
  const noWord = await call('/admin/audit/clear', { scope: 'all', confirm: 'clear', reason: 'End of year clean-up' }, superCookie);
  assert.equal(noWord.status, 400);
  const noReason = await call('/admin/audit/clear', { scope: 'all', confirm: 'CLEAR', reason: 'short' }, superCookie);
  assert.equal(noReason.status, 400);
  assert.equal((await mine()).length, 3);
});

test('older than a year removes only those, keeps earlier clearings, and records itself', async () => {
  const res = await call('/admin/audit/clear', { scope: 'older', days: 365, confirm: 'CLEAR', reason: 'Yearly clean-up after export' }, superCookie);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.data.deleted >= 1);
  const left = (await mine()).map((r) => r.action).sort();
  assert.deepEqual(left, ['audit.cleared', 'settings.changed'], 'the old entry went; the old clearing and the recent entry stayed');

  const { data: record } = await supabase.from('admin_audit').select('action, payload')
    .eq('action', 'audit.cleared').eq('payload->>reason', 'Yearly clean-up after export');
  assert.equal(record.length, 1, 'the clearing is on the record');
  assert.equal(record[0].payload.olderThanDays, 365);
});
