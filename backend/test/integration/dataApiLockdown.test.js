const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../helpers/testEnv');

/**
 * THE DATA API, AS SOMEBODY HOLDING THE PUBLIC KEY SEES IT.
 *
 * The browser never talks to Supabase: every request goes through this API,
 * which uses the service role. So `anon` and `authenticated` have no legitimate
 * caller, and 20260914090000_lock_down_api_roles revoked everything from them —
 * after measuring that `anon` could EXECUTE fulfill_checkout and settle_invoice.
 * That migration proves the lock-down inside its own transaction, against
 * privileges. This proves it through PostgREST, the way an attacker would try
 * it: the anon key is designed to be public, so it is assumed to be known.
 *
 * Needs SUPABASE_ANON_KEY (CI: `supabase status -o env`). Skipped without it,
 * and says so.
 */
const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;

const rest = (path, init = {}) => fetch(`${URL_}/rest/v1${path}`, {
  ...init,
  headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json', ...init.headers },
});

const SENSITIVE = ['profiles', 'sessions', 'orders', 'tickets', 'organizers', 'ledger_entries',
  'invoices', 'password_resets', 'email_verifications', 'scan_devices', 'admin_audit', 'webhook_events'];

test('the anon key reads no table', { skip: !ANON && 'SUPABASE_ANON_KEY is not set' }, async () => {
  for (const table of SENSITIVE) {
    const res = await rest(`/${table}?select=*&limit=1`);
    const body = await res.json().catch(() => null);
    // A 401/403 from PostgREST, or a Postgres permission error — never rows.
    assert.ok(res.status === 401 || res.status === 403 || res.status === 404,
      `${table}: ${res.status} ${JSON.stringify(body).slice(0, 160)}`);
    assert.ok(!Array.isArray(body), `${table} returned rows to the anon key`);
  }
});

test('the anon key writes no table', { skip: !ANON && 'SUPABASE_ANON_KEY is not set' }, async () => {
  const res = await rest('/profiles', {
    method: 'POST', body: JSON.stringify({ email: 'anon-write@eventsli-test.invalid' }),
  });
  assert.ok([401, 403, 404].includes(res.status), `profiles insert: ${res.status}`);
});

test('the anon key calls no money or door function', { skip: !ANON && 'SUPABASE_ANON_KEY is not set' }, async () => {
  for (const fn of ['fulfill_checkout', 'settle_invoice', 'ledger_write', 'check_in_ticket',
    'save_venue_map', 'hold_seats', 'record_manual_sale', 'consume_password_reset']) {
    const res = await rest(`/rpc/${fn}`, { method: 'POST', body: '{}' });
    assert.ok([401, 403, 404].includes(res.status), `${fn}: ${res.status}`);
  }
});
