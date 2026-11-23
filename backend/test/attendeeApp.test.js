const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

/**
 * The attendee app's server side (2026-11-24): the reservation token beside a
 * Bearer session, saved events, the notification inbox, push devices, and the
 * notifications themselves.
 *
 * The database is a recording stand-in installed before anything loads
 * (node --test runs each file in its own process). Every query is a list of
 * builder calls, answered by a per-table handler, so a test can say both what
 * came back AND what was asked — "scoped by the session's user" is a claim
 * about the query, not about the rows.
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const calls = [];
let handlers = {};
function from(table) {
  const op = { table, ops: [] };
  calls.push(op);
  const q = new Proxy({}, {
    get(_, key) {
      if (key === 'then') {
        return (resolve, reject) => Promise.resolve()
          .then(() => (handlers[table] || (() => ({ data: null, error: null })))(op))
          .then(resolve, reject);
      }
      return (...args) => { op.ops.push([key, args]); return q; };
    },
  });
  return q;
}
const did = (op, name) => op.ops.filter(([k]) => k === name).map(([, a]) => a);
const eqs = (op) => Object.fromEntries(did(op, 'eq').map(([c, v]) => [c, v]));

stub('config/supabase.js', { supabase: { from } });
stub('controllers/discoveryController.js', {
  SELECT: '*',
  shape: (e) => ({ id: e.id, slug: e.slug, title: e.title }),
  lockedListing: (e) => ({ id: e.id, slug: e.slug, title: e.title, isPrivate: true }),
  lowestTierPrices: async (rows) => new Map(rows.map((e) => [e.id, 2500])),
  listingAvailability: async () => new Map(),
});
const USER = '00000000-0000-4000-8000-00000000000a';
stub('middleware/auth.js', {
  requireAuth: (req, res, next) => { req.user = { id: USER, email: 'mona@example.com' }; next(); },
  optionalAuth: (req, res, next) => next(),
});

const accessTokens = require('../services/accessTokens');
const notify = require('../services/attendeeNotifications');
const meRoutes = require('../routes/meRoutes');

const app = express();
app.use(express.json());
app.use('/me', meRoutes);
app.use((err, req, res, _next) => res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message }));
const server = app.listen(0);
const base = () => `http://127.0.0.1:${server.address().port}/me`;
after(() => server.close());

async function call(method, url, body) {
  const res = await fetch(`${base()}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

const EVENT = '00000000-0000-4000-8000-0000000000e1';
const realFetch = global.fetch;
beforeEach(() => {
  calls.length = 0;
  handlers = {};
  global.fetch = realFetch;
});

// ─── The reservation token beside a Bearer session ─────────────────────────

test('a signed-in app sends its session as Bearer: the hold is read from x-access-token', () => {
  const req = { headers: { authorization: 'Bearer session-token', 'x-access-token': 'reservation-token' } };
  assert.equal(accessTokens.reservationTokenFrom(req), 'reservation-token');
  // The generic reader still prefers Bearer — which is exactly the bug.
  assert.equal(accessTokens.fromRequest(req), 'session-token');
});

test('a caller that sent the reservation as Bearer still works', () => {
  assert.equal(accessTokens.reservationTokenFrom({ headers: { authorization: 'Bearer reservation-token' } }), 'reservation-token');
  assert.equal(accessTokens.reservationTokenFrom({ headers: {}, query: {}, body: {} }), null);
});

// ─── Saved events ──────────────────────────────────────────────────────────

test('saving an event that is not published answers exactly as a missing one', async () => {
  handlers.events = () => ({ data: null, error: null });
  const { status, json } = await call('PUT', `/saved-events/${EVENT}`);
  assert.equal(status, 404);
  assert.equal(json.error, 'EVENT_NOT_FOUND');
  assert.deepEqual(eqs(calls[0]), { id: EVENT, status: 'published' });
  assert.equal(calls.some((c) => c.table === 'saved_events'), false, 'nothing written');
});

test('saving is scoped to the session and idempotent', async () => {
  handlers.events = () => ({ data: { id: EVENT }, error: null });
  handlers.saved_events = () => ({ data: null, error: null });
  const { status, json } = await call('PUT', `/saved-events/${EVENT}`);
  assert.equal(status, 200);
  assert.deepEqual(json.data, { eventId: EVENT, saved: true });
  const [[row, opts]] = did(calls.find((c) => c.table === 'saved_events'), 'upsert');
  assert.deepEqual(row, { user_id: USER, event_id: EVENT });
  assert.equal(opts.ignoreDuplicates, true);
});

test('unsaving deletes only the session user\'s row', async () => {
  handlers.saved_events = () => ({ data: null, error: null });
  const { json } = await call('DELETE', `/saved-events/${EVENT}`);
  assert.equal(json.data.saved, false);
  assert.deepEqual(eqs(calls[0]), { user_id: USER, event_id: EVENT });
});

test('a malformed event id is a 400 before any query', async () => {
  const { status } = await call('PUT', '/saved-events/not-a-uuid');
  assert.equal(status, 400);
  assert.equal(calls.length, 0);
});

test('the saved list keeps save order, and a private event stays locked', async () => {
  const A = `${EVENT.slice(0, -2)}a1`;
  const B = `${EVENT.slice(0, -2)}b2`;
  handlers.saved_events = () => ({
    data: [{ event_id: B, created_at: '2026-11-24T10:00:00Z' }, { event_id: A, created_at: '2026-11-20T10:00:00Z' }],
    count: 2, error: null,
  });
  handlers.events = () => ({
    data: [{ id: A, slug: 'a', title: 'A' }, { id: B, slug: 'b', title: 'B', is_private: true }], error: null,
  });
  const { json } = await call('GET', '/saved-events');
  assert.deepEqual(json.data.map((e) => e.id), [B, A]);
  assert.equal(json.data[0].isPrivate, true);
  assert.equal(json.data[0].fromPriceCents, undefined, 'no price behind the password');
  assert.equal(json.data[1].fromPriceCents, 2500);
  assert.equal(json.pagination.total, 2);
  assert.deepEqual(eqs(calls[0]), { user_id: USER, 'events.status': 'published' });
});

// ─── Notifications ─────────────────────────────────────────────────────────

test('mark-read takes ids OR all, never both, never neither', async () => {
  handlers.user_notifications = () => ({ data: null, error: null, count: 0 });
  assert.equal((await call('POST', '/notifications/read', {})).status, 400);
  assert.equal((await call('POST', '/notifications/read', { all: 'true' })).status, 400, 'a string is not true');
  assert.equal((await call('POST', '/notifications/read', { all: true, ids: [EVENT] })).status, 400);
  assert.equal((await call('POST', '/notifications/read', { ids: ['nope'] })).status, 400);
  assert.equal((await call('POST', '/notifications/read', { all: true })).status, 200);
  const update = calls.find((c) => did(c, 'update').length);
  assert.equal(eqs(update).user_id, USER);
});

test('a notice links to its event only while the event is public', () => {
  const { shapeNotification } = require('../controllers/meController');
  const base = { id: 'n', kind: 'event_cancelled', title: 't', body: 'b', event_id: EVENT, order_id: null, read_at: null, created_at: 'x' };
  assert.equal(shapeNotification({ ...base, events: { slug: 's', status: 'published' } }).eventSlug, 's');
  assert.equal(shapeNotification({ ...base, events: { slug: 's', status: 'cancelled' } }).eventSlug, null);
  assert.equal(shapeNotification({ ...base, events: null }).eventSlug, null);
});

test('push tokens are checked for shape before they reach the database', async () => {
  handlers.push_devices = () => ({ data: null, error: null });
  assert.equal((await call('POST', '/push-devices', { token: 'hello', platform: 'ios' })).status, 400);
  assert.equal((await call('POST', '/push-devices', { token: 'ExponentPushToken[abcdefghijklmnop]', platform: 'web' })).status, 400);
  const ok = await call('POST', '/push-devices', { token: 'ExponentPushToken[abcdefghijklmnop]', platform: 'ios' });
  assert.equal(ok.status, 200);
  const [[row, opts]] = did(calls.at(-1), 'upsert');
  assert.equal(row.user_id, USER);
  assert.equal(row.disabled_at, null, 're-registering revives a token Expo had reported dead');
  assert.equal(opts.onConflict, 'token');
});

test('every notice fits a lock screen and carries no link', () => {
  const event = { title: 'A'.repeat(300), starts_at: '2026-11-20T20:00:00Z', timezone: 'Africa/Cairo', venue_name: 'Cairo International Stadium' };
  for (const kind of ['tickets_issued', 'ticket_received', 'event_reminder', 'event_cancelled', 'event_moved', 'welcome']) {
    const m = notify.messageFor(kind, { event, count: 2, from: 'a@b.c' });
    assert.ok(m.title.length <= 120 && m.body.length <= 400, kind);
    assert.doesNotMatch(`${m.title} ${m.body}`, /https?:|token/i, kind);
  }
  assert.match(notify.messageFor('tickets_issued', { event, count: 2 }).body, /2 tickets/);
  // In the EVENT's zone: 20:00Z is 10 PM in Cairo, not 8 PM.
  assert.match(notify.messageFor('event_moved', { event }).body, /10:00 PM/);
  assert.throws(() => notify.messageFor('nope'));
});

test('one push per device, and dead devices are found in send order', () => {
  const rows = [{ id: 'n1', user_id: 'u1', kind: 'welcome', title: 't', body: 'b' }, { id: 'n2', user_id: 'u2', kind: 'welcome', title: 't', body: 'b' }];
  const devices = [{ user_id: 'u1', token: 'T1' }, { user_id: 'u1', token: 'T2' }, { user_id: 'u3', token: 'T3' }];
  const messages = notify.buildMessages(rows, devices);
  assert.deepEqual(messages.map((m) => m.to), ['T1', 'T2'], 'u2 has no phone; u3 has no notice');
  assert.deepEqual(messages[0].data, { notificationId: 'n1', kind: 'welcome', eventId: null, orderId: null });
  const dead = notify.deadTokens(messages, [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }]);
  assert.deepEqual(dead, ['T2']);
});

test('only a NEW row is pushed — a retried hook writes nothing and sends nothing', async () => {
  const sent = [];
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) };
  };
  let inserted = [{ id: 'n1', user_id: USER, kind: 'welcome', title: 't', body: 'b', event_id: null, order_id: null }];
  handlers.user_notifications = () => ({ data: inserted, error: null });
  handlers.push_devices = (op) => (did(op, 'update').length
    ? { data: null, error: null }
    : { data: [{ user_id: USER, token: 'ExponentPushToken[abcdefghijklmnop]' }], error: null });

  assert.equal(await notify.record([{ userId: USER, kind: 'welcome', dedupeKey: 'welcome', title: 't', body: 'b' }]), 1);
  assert.equal(sent.length, 1);
  const disable = calls.find((c) => c.table === 'push_devices' && did(c, 'update').length);
  assert.ok(disable, 'the uninstalled phone is switched off');

  inserted = []; // the unique key swallowed the second write
  sent.length = 0;
  assert.equal(await notify.record([{ userId: USER, kind: 'welcome', dedupeKey: 'welcome', title: 't', body: 'b' }]), 0);
  assert.equal(sent.length, 0);
});

test('a database failure is logged, never thrown into the sale', async () => {
  handlers.user_notifications = () => ({ data: null, error: { message: 'down' } });
  assert.equal(await notify.record([{ userId: USER, kind: 'welcome', dedupeKey: 'welcome', title: 't', body: 'b' }]), 0);
  handlers.orders = () => { throw new Error('boom'); };
  assert.equal(await notify.ticketsIssued('o1'), 0);
});
