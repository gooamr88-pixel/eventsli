const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

/**
 * Boot-time and request-time guards in app.js, plus the revalidation target.
 * No database: the app is loaded against an unreachable Supabase URL, and the
 * requests here are refused by the body parser before any route runs.
 */
const ENV = {
  JWT_SECRET: 'test-jwt', QR_JWT_SECRET: 'test-qr',
  SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'k',
  IP_HASH_SALT: 's', NODE_ENV: 'test', LOG_LEVEL: 'silent',
  DISABLE_RATE_LIMIT: 'true',
};
Object.assign(process.env, ENV);

let server;
let base;
before(async () => {
  const app = require('../app');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
after(() => server && server.close());

test('REGRESSION T-031: malformed JSON is a 400, not a 500', async () => {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email": ',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error, 'VALIDATION_ERROR');
});

test('REGRESSION T-031: a body over the 2 MB limit is a 413, not a 500', async () => {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blob: 'x'.repeat(2.2 * 1024 * 1024) }),
  });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, 'VALIDATION_ERROR');
});

test('REGRESSION T-032: a non-numeric RESERVATION_TTL_MINUTES refuses to boot', () => {
  const r = spawnSync(process.execPath, ['-e', "require('./app')"], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...ENV, RESERVATION_TTL_MINUTES: 'thirty-five' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1, 'exits non-zero');
});

test('REGRESSION T-030: revalidation targets the FIRST allowlisted origin', () => {
  const saved = { FRONTEND_URL: process.env.FRONTEND_URL, REVALIDATE_URL: process.env.REVALIDATE_URL };
  try {
    delete process.env.REVALIDATE_URL;
    process.env.FRONTEND_URL = 'https://eventsli.com/, https://www.eventsli.com';
    const { target } = require('../services/revalidateService');
    const url = new URL(target());
    assert.equal(url.host, 'eventsli.com', `was ${target()}`);
    assert.equal(url.pathname, '/api/internal/revalidate');

    process.env.REVALIDATE_URL = 'http://127.0.0.1:3100/api/internal/revalidate';
    assert.equal(target(), process.env.REVALIDATE_URL, 'an explicit target wins');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
