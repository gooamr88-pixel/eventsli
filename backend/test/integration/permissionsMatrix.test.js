const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters, and refuses a
// remote database unless EVENTSLI_TEST_REMOTE_DB names it. Must come first.
require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO CAN REACH WHAT — every route, from the router itself.
 *
 * The API reads the database with the service-role key, which bypasses RLS
 * (the Data API is closed to `anon`/`authenticated` entirely — see
 * dataApiLockdown.test.js). So "each user sees only their own data" is
 * enforced HERE, in middleware and controllers, and nowhere else.
 *
 * The other suites check particular doors by hand. This one walks the LIVE
 * Express router and knocks on all of them, so a route added next month is
 * covered the day it is mounted:
 *
 *   · organizer B, a buyer and a signed-out visitor against every
 *     /events/:eventId route of organizer A's event — never a 2xx, never a 500;
 *   · a buyer and an organizer against every /admin route — never a 2xx;
 *   · a child id of A's (a ticket type) under B's OWN event — refused, because
 *     verifyEventOwner proves the event and nothing about the child;
 *   · afterwards A's event and ticket type are exactly as they were;
 *   · and a positive control, so the sweep cannot pass by everything failing.
 *
 * Run against a TEST database only: `npm run test:integration`, with
 * SUPABASE_URL pointing at a local stack or EVENTSLI_TEST_REMOTE_DB set to a
 * staging project's ref. It creates and deletes its own accounts and events.
 * ─────────────────────────────────────────────────────────────────────────────
 */

let server; let baseUrl;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const cleanup = { profiles: [], organizers: [], events: [] };

function client() {
  let cookie = null;
  return async function call(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body && method !== 'GET' && method !== 'HEAD' ? { body: JSON.stringify(body) } : {}),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : null };
  };
}

const orgA = client();
const orgB = client();
const buyer = client();
const admin = client();
const anonymous = client();
let eventA; let eventB; let tierA; let tierAName;

async function register(call, label) {
  const email = `${label}-${stamp}@eventsli-test.invalid`;
  const res = await call('POST', '/auth/register', { email, password: PASSWORD, fullName: `${label} person` });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  cleanup.profiles.push(res.body.data.id);
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', res.body.data.id);
  const login = await call('POST', '/auth/login', { email, password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { id: res.body.data.id, email };
}

async function organizerWithEvent(call, label) {
  await register(call, label);
  const org = await call('POST', '/organizer', {
    displayName: `Matrix ${label} Co`,
    legalName: `Matrix ${label} Company Ltd.`,
    description: 'Created and deleted by the permissions matrix suite.',
    acceptPolicies: true,
    country: 'CA',
  });
  assert.equal(org.status, 201, JSON.stringify(org.body));
  cleanup.organizers.push(org.body.data.id);
  const ev = await call('POST', '/events', {
    title: `Matrix ${label} Night`,
    country: 'CA',
    venueName: 'Matrix Hall', venueAddress: '1 Test Street', city: 'Toronto',
    timezone: 'America/Toronto',
    startsAt: new Date(Date.now() + 30 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 30 * 86400e3 + 4 * 3600e3).toISOString(),
  });
  assert.equal(ev.status, 201, JSON.stringify(ev.body));
  cleanup.events.push(ev.body.data.id);
  return ev.body.data.id;
}

// ─── The router, as Express holds it ─────────────────────────────────────────
// Express 4 keeps a mount path only as a regexp; these are the shapes it uses.
function mountPath(layer) {
  if (!layer.regexp || layer.regexp.fast_slash) return '';
  const keys = [...(layer.keys || [])];
  return layer.regexp.source
    .replace('^\\/', '/')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${(keys.shift() || {}).name || 'param'}`)
    .replace(/\\\//g, '/')
    .replace(/\$$/, '')
    .replace(/\?$/, '');
}

function allRoutes() {
  const out = [];
  (function walk(stack, prefix) {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          out.push({ method: method.toUpperCase(), path: prefix + layer.route.path });
        }
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer));
      }
    }
  }(app._router.stack, ''));
  return out.map((r) => ({ ...r, path: r.path.replace(/^\/api\/v1/, '') }));
}

/** A concrete URL: A's event for :eventId, A's real tier for :tierId (so a
 *  broken scope would show), a fresh UUID for any other id. */
function fill(path, ids) {
  return path.replace(/:([A-Za-z]+)/g, (_, name) => ids[name] || randomUUID());
}

const ok = (s) => s >= 200 && s < 300;

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  eventA = await organizerWithEvent(orgA, 'orga');
  eventB = await organizerWithEvent(orgB, 'orgb');
  tierAName = 'Matrix VIP';
  const tier = await orgA('POST', `/events/${eventA}/tiers`, { name: tierAName, priceCents: 5000, quantity: 20 });
  assert.equal(tier.status, 201, JSON.stringify(tier.body));
  tierA = tier.body.data.id;

  await register(buyer, 'buyer');
  const adm = await register(admin, 'admin');
  await supabase.from('profiles').update({ role: 'admin' }).eq('id', adm.id);
  await admin('POST', '/auth/login', { email: adm.email, password: PASSWORD });
});

after(async () => {
  for (const id of cleanup.events) {
    for (const t of ['ticket_tiers', 'event_staff', 'scan_devices', 'promo_codes', 'table_categories',
      'event_media', 'event_sponsors', 'event_policies', 'event_schedule']) {
      await supabase.from(t).delete().eq('event_id', id);
    }
    await supabase.from('admin_audit').delete().eq('target_id', id);
    await supabase.from('events').delete().eq('id', id);
  }
  for (const id of cleanup.organizers) {
    await supabase.from('organizer_payment_methods').delete().eq('organizer_id', id);
    await supabase.from('organizers').delete().eq('id', id);
  }
  for (const id of cleanup.profiles) {
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

test('positive control: the owner reaches their own event', async () => {
  const res = await orgA('GET', `/events/${eventA}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.id, eventA);
});

test('the router has the routes this suite expects to sweep', () => {
  const routes = allRoutes();
  assert.ok(routes.filter((r) => r.path.includes(':eventId')).length > 50, 'event routes found');
  assert.ok(routes.filter((r) => r.path.startsWith('/admin')).length > 20, 'admin routes found');
});

for (const [who, call] of [['another organizer', () => orgB], ['a buyer', () => buyer], ['a signed-out visitor', () => anonymous]]) {
  test(`${who} gets nothing from any route of someone else's event`, async () => {
    const routes = allRoutes().filter((r) => r.path.startsWith('/events/:eventId'));
    const leaks = [];
    for (const r of routes) {
      const res = await call()(r.method, fill(r.path, { eventId: eventA, tierId: tierA }), {});
      if (ok(res.status) || res.status >= 500) leaks.push(`${r.method} ${r.path} → ${res.status}`);
    }
    assert.deepEqual(leaks, [], `reachable or crashing:\n${leaks.join('\n')}`);
  });
}

for (const [who, call] of [['a buyer', () => buyer], ['an organizer', () => orgB], ['a signed-out visitor', () => anonymous]]) {
  test(`${who} reaches no admin route`, async () => {
    const routes = allRoutes().filter((r) => r.path.startsWith('/admin'));
    const leaks = [];
    for (const r of routes) {
      const res = await call()(r.method, fill(r.path, { eventId: eventA }), {});
      if (ok(res.status) || res.status >= 500) leaks.push(`${r.method} ${r.path} → ${res.status}`);
    }
    assert.deepEqual(leaks, [], `reachable or crashing:\n${leaks.join('\n')}`);
  });
}

test("a child id of A's cannot be reached through B's own event", async () => {
  const patch = await orgB('PATCH', `/events/${eventB}/tiers/${tierA}`, { name: 'Taken over' });
  assert.equal(patch.status, 404, JSON.stringify(patch.body));
  const del = await orgB('DELETE', `/events/${eventB}/tiers/${tierA}`);
  assert.equal(del.status, 404, JSON.stringify(del.body));
});

test("after every sweep, A's event and ticket type are exactly as they were", async () => {
  const { data: ev } = await supabase.from('events').select('id, title, status').eq('id', eventA).single();
  assert.equal(ev.title, 'Matrix orga Night');
  assert.equal(ev.status, 'draft');
  const { data: tier } = await supabase.from('ticket_tiers').select('id, name').eq('id', tierA).single();
  assert.equal(tier.name, tierAName);
});

// ─── The admin endpoints added in the 2026-11 redesign ───────────────────────
test('the new admin filters are admin-only and check their input', async () => {
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  for (const path of [`/admin/audit?action=event.approved&since=${encodeURIComponent(since)}&limit=1`,
    '/admin/invoices?q=INV', `/admin/invoices?issuedSince=${encodeURIComponent(since)}`]) {
    assert.equal((await buyer('GET', path)).status, 403, path);
    assert.equal((await orgB('GET', path)).status, 403, path);
    assert.equal((await admin('GET', path)).status, 200, path);
  }
  assert.equal((await admin('GET', '/admin/audit?since=last-month')).status, 400);
  assert.equal((await admin('GET', '/admin/invoices?organizerId=not-a-uuid')).status, 400);
  assert.equal((await admin('GET', '/admin/invoices?issuedSince=yesterday')).status, 400);
});

test('invoice totals come back for every invoice, per currency', async () => {
  const res = await admin('GET', '/admin/invoices?limit=1');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const totals = res.body.meta?.totals;
  assert.ok(totals && Number.isInteger(totals.count), 'meta.totals.count');
  for (const t of Object.values(totals.byCurrency)) {
    assert.ok(Number.isInteger(t.totalCents) && Number.isInteger(t.unpaidCents) && Number.isInteger(t.settledCents));
  }
});
