const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * REGRESSION — the homepage was writable by every admin.
 *
 * The policy, stated in admin/content/Content.jsx and recorded when the CMS
 * shipped, is that only a SUPER ADMIN changes what the public homepage says,
 * "matching /admin/settings". The console enforced it by hiding the inputs. The
 * API did not: storefrontRoutes sat behind the admin guard alone, so any admin
 * could rewrite the hero, delete a category or swap a sponsor's logo with one
 * request. Navigation is not a security boundary.
 *
 * Every write here sends a body the validator refuses, so nothing is ever
 * written: a 403 means the role stopped it, anything else means it got past.
 */
let server; let baseUrl;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const ids = {};
const cookies = {};

async function makeUser(key, role) {
  const email = `sf-${key}-${stamp}@eventsli-test.invalid`;
  const reg = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, fullName: `Storefront ${key}` }),
  });
  ids[key] = (await reg.json()).data.id;
  await supabase.from('profiles')
    .update({ role, email_verified_at: new Date().toISOString() }).eq('id', ids[key]);
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  cookies[key] = (login.headers.get('set-cookie') || '').split(';')[0];
}

const call = async (key, method, path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookies[key] },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  await makeUser('admin', 'admin');
  await makeUser('super', 'super_admin');
});

after(async () => {
  for (const id of Object.values(ids)) {
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

// Each write with a body its validator refuses — `[]` is never a valid block,
// list item or order.
const WRITES = [
  ['PUT', '/admin/storefront/content/hero', []],
  ['POST', '/admin/storefront/sponsors', []],
  ['PATCH', `/admin/storefront/sponsors/${randomUUID()}`, []],
  ['DELETE', `/admin/storefront/sponsors/${randomUUID()}`, undefined],
  ['POST', '/admin/storefront/testimonials', []],
  ['PATCH', `/admin/storefront/testimonials/${randomUUID()}`, []],
  ['DELETE', `/admin/storefront/testimonials/${randomUUID()}`, undefined],
  ['POST', '/admin/storefront/categories', []],
  ['PATCH', '/admin/storefront/categories/no-such-category', []],
  ['DELETE', '/admin/storefront/categories/no-such-category', undefined],
  ['POST', '/admin/storefront/sponsors/order', []],
  ['POST', '/admin/storefront/uploads/sign', []],
  ['POST', '/admin/storefront/uploads/confirm', []],
];

test('REGRESSION: a plain admin cannot write any part of the homepage', async () => {
  for (const [method, path, body] of WRITES) {
    const res = await call('admin', method, path, body);
    assert.equal(res.status, 403, `${method} ${path} must be refused by role, got ${res.status}`);
    assert.equal(res.body?.error, 'FORBIDDEN');
  }
});

test('a super admin gets past the role check on every one of them', async () => {
  for (const [method, path, body] of WRITES) {
    const res = await call('super', method, path, body);
    assert.notEqual(res.status, 403, `${method} ${path} refused a super admin`);
    assert.notEqual(res.status, 401);
  }
});

test('a plain admin can still READ everything the console shows', async () => {
  for (const path of ['/admin/storefront/content', '/admin/storefront/sponsors',
    '/admin/storefront/testimonials', '/admin/storefront/categories']) {
    const res = await call('admin', 'GET', path);
    assert.equal(res.status, 200, `${path}: ${JSON.stringify(res.body).slice(0, 200)}`);
  }
});
