const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

/**
 * Private events, behind a password (owner, 2026-11-22) — services/eventAccess.js.
 *
 * Who may see a private event, what a locked visitor is shown, the route guard
 * mounted the way app.js mounts it, and a source check that every public
 * listing leaves private events out. No database: Supabase is stubbed.
 */
process.env.JWT_SECRET ||= 'unit-test-secret-unit-test-secret-unit-test';

const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

// The `events` row the stubbed query answers with, swapped per test.
let row = null;
// Every other table's rows, per test — a table listed here "matches" (the
// stub ignores filters; each test states which permission exists).
let tables = {};
const upserts = [];
function query(table) {
  const rows = () => tables[table] || [];
  const chain = {
    select: () => chain, eq: () => chain, is: () => chain, neq: () => chain,
    maybeSingle: () => Promise.resolve({ data: table === 'events' ? row : (rows()[0] ?? null), error: null }),
    limit: () => Promise.resolve({ data: rows(), error: null }),
    upsert: (value) => { upserts.push({ table, value }); return Promise.resolve({ error: null }); },
  };
  return chain;
}
stub('config/supabase.js', { supabase: { from: query } });

const access = require('../services/eventAccess');
const { hashPassword } = require('../utils/crypto');

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const SET_AT = '2026-11-22T10:00:00.000Z';

const privateEvent = (over = {}) => ({
  id: EVENT_ID, slug: 'gala', title: 'The Gala', status: 'published',
  is_private: true, access_password_set_at: SET_AT, organizer_id: ORG_ID,
  cover_url: 'https://cdn.example/cover.jpg', logo_url: null,
  starts_at: '2027-01-01T00:00:00Z', venue_name: 'Secret Hall',
  organizers: { display_name: 'Host Co' },
  ...over,
});

const reqWith = ({ cookie, header, user } = {}) => ({
  cookies: cookie ? { [access.cookieName(EVENT_ID)]: cookie } : {},
  get: (name) => (name.toLowerCase() === access.HEADER ? header : undefined),
  user,
});

// ── canView ──────────────────────────────────────────────────────────────────

test('a public event is always visible', () => {
  assert.equal(access.canView(reqWith(), privateEvent({ is_private: false })), true);
});

test('a private event is locked without a token', () => {
  assert.equal(access.canView(reqWith(), privateEvent()), false);
});

test('a token from unlocking opens it, by cookie or by header', () => {
  const token = access.issueToken(privateEvent());
  assert.equal(access.canView(reqWith({ cookie: token }), privateEvent()), true);
  assert.equal(access.canView(reqWith({ header: token }), privateEvent()), true);
});

test('a new password locks out everyone who unlocked with the old one', () => {
  const token = access.issueToken(privateEvent());
  const changed = privateEvent({ access_password_set_at: '2026-11-23T08:00:00.000Z' });
  assert.equal(access.canView(reqWith({ cookie: token }), changed), false);
});

test("another event's token, a table token, or a forged one does not open it", () => {
  const other = access.issueToken(privateEvent({ id: OTHER_ID }));
  assert.equal(access.canView(reqWith({ cookie: other }), privateEvent()), false);

  const tableToken = jwt.sign({ typ: 'table_access', eventId: EVENT_ID, tableId: 'x' }, process.env.JWT_SECRET);
  assert.equal(access.canView(reqWith({ cookie: tableToken }), privateEvent()), false);

  const forged = jwt.sign({ typ: access.TOKEN_TYPE, eventId: EVENT_ID, v: Date.parse(SET_AT) }, 'not-the-secret');
  assert.equal(access.canView(reqWith({ cookie: forged }), privateEvent()), false);

  const expired = jwt.sign(
    { typ: access.TOKEN_TYPE, eventId: EVENT_ID, v: Date.parse(SET_AT) },
    process.env.JWT_SECRET, { expiresIn: -10 },
  );
  assert.equal(access.canView(reqWith({ cookie: expired }), privateEvent()), false);
});

test('its own organizer and an admin see it without the password', () => {
  assert.equal(access.canView(reqWith({ user: { access: { organizerId: ORG_ID } } }), privateEvent()), true);
  assert.equal(access.canView(reqWith({ user: { access: { isAdmin: true } } }), privateEvent()), true);
  assert.equal(access.canView(reqWith({ user: { access: { organizerId: 'someone-else' } } }), privateEvent()), false);
});

// ── A session with permission (owner, 2026-11-22) ────────────────────────────

const signedIn = { id: '44444444-4444-4444-8444-444444444444', access: { organizerId: null } };

test('a session alone is not permission: a signed-in stranger is asked', async () => {
  tables = { profiles: [{ email: 'guest@example.test', email_verified_at: '2026-11-01T00:00:00Z' }] };
  assert.equal(await access.allowed(reqWith({ user: signedIn }), privateEvent()), false);
  assert.equal(await access.allowed(reqWith(), privateEvent()), false);
});

test('the door team, and a paid order on the account, let a signed-in visitor in', async () => {
  tables = { event_staff: [{ id: 's1' }] };
  assert.equal(await access.allowed(reqWith({ user: signedIn }), privateEvent()), true);
  tables = { orders: [{ id: 'o1' }] };
  assert.equal(await access.allowed(reqWith({ user: signedIn }), privateEvent()), true);
});

test('a ticket sent to the email counts only when the email is verified', async () => {
  tables = { tickets: [{ id: 't1' }], profiles: [{ email: 'guest@example.test', email_verified_at: null }] };
  assert.equal(await access.allowed(reqWith({ user: signedIn }), privateEvent()), false);
  tables = { tickets: [{ id: 't1' }], profiles: [{ email: 'guest@example.test', email_verified_at: '2026-11-01T00:00:00Z' }] };
  assert.equal(await access.allowed(reqWith({ user: signedIn }), privateEvent()), true);
});

test('an unlock on the account opens it on any device, until the password changes', async () => {
  tables = { event_access_grants: [{ password_set_at: SET_AT }] };
  assert.equal(await access.allowed(reqWith({ user: signedIn }), privateEvent()), true);
  assert.equal(await access.allowed(reqWith({ user: signedIn }), privateEvent({ access_password_set_at: '2026-12-01T00:00:00Z' })), false);
});

test('unlocking while signed in is remembered on the account; a guest is not written down', async () => {
  upserts.length = 0;
  await access.rememberUnlock(reqWith({ user: signedIn }), privateEvent());
  await access.rememberUnlock(reqWith(), privateEvent());
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0], {
    table: 'event_access_grants',
    value: { user_id: signedIn.id, event_id: EVENT_ID, password_set_at: SET_AT },
  });
  tables = {};
});

test('a failed permission read asks for the password rather than letting anyone in', async () => {
  const saved = tables;
  tables = new Proxy({}, { get: () => { throw new Error('db down'); } });
  assert.equal(await access.allowed(reqWith({ user: signedIn }), privateEvent()), false);
  tables = saved;
});

// ── What a locked visitor is told ────────────────────────────────────────────

test('the locked answer names the event and nothing behind the password', () => {
  const failure = access.lockedFailure(privateEvent());
  assert.equal(failure.status, 403);
  assert.equal(failure.error, 'EVENT_PRIVATE');
  assert.deepEqual(Object.keys(failure.meta.event).sort(), [
    'blurredCover', 'city', 'coverUrl', 'logoUrl', 'organizer', 'passwordRule', 'preview', 'reveal', 'slug', 'startsAt', 'timezone', 'title',
  ]);
  assert.equal(failure.meta.event.passwordRule, null, 'no rule shown when the organizer set none');
  const text = JSON.stringify(failure);
  assert.ok(!text.includes('Secret Hall'), 'no venue');
  assert.ok(!text.includes('2027-01-01'), 'no date');
  // The default (2026-11-22): a blurred page, the name and the host readable,
  // the cover only as a blurred copy — its address never sent.
  assert.equal(failure.meta.event.preview, 'blur');
  assert.equal(failure.meta.event.title, 'The Gala');
  assert.equal(failure.meta.event.organizer.name, 'Host Co');
  assert.equal(failure.meta.event.coverUrl, null);
  assert.equal(failure.meta.event.blurredCover, true);
  assert.ok(!text.includes('cdn.example'), 'the cover itself is not sent');
});

test('the organizer decides what stays readable; the rest is never sent', () => {
  const nothing = access.lockedFailure(privateEvent({ locked_reveal: [], locked_preview: 'card' })).meta.event;
  assert.equal(nothing.preview, 'card');
  assert.equal(nothing.title, null);
  assert.equal(nothing.organizer, null);
  assert.ok(!JSON.stringify(nothing).includes('The Gala'), 'no name');
  assert.ok(!JSON.stringify(nothing).includes('Host Co'), 'no host');

  const all = access.lockedFailure(privateEvent({
    locked_reveal: ['title', 'organizer', 'cover', 'date', 'city'], city: 'Toronto', timezone: 'America/Toronto',
  })).meta.event;
  assert.equal(all.coverUrl, 'https://cdn.example/cover.jpg');
  assert.equal(all.blurredCover, false, 'a shown cover needs no blurred copy');
  assert.equal(all.startsAt, '2027-01-01T00:00:00Z');
  assert.equal(all.timezone, 'America/Toronto');
  assert.equal(all.city, 'Toronto');
  assert.ok(!JSON.stringify(all).includes('Secret Hall'), 'the venue is never part of the preview');

  assert.deepEqual(access.cleanReveal(['city', 'bogus', 'title', 'city']), ['title', 'city']);
  assert.deepEqual(access.cleanReveal(undefined), ['title', 'organizer']);
});

// ── The password ─────────────────────────────────────────────────────────────

test('the right password unlocks; every other case is the same plain no', async () => {
  const hash = await hashPassword('open sesame');
  row = { ...privateEvent(), access_password_hash: hash };
  assert.equal((await access.verify('gala', 'open sesame')).ok, true);
  assert.equal((await access.verify('gala', 'wrong')).ok, false);

  row = { ...privateEvent({ is_private: false }), access_password_hash: hash };
  assert.equal((await access.verify('gala', 'open sesame')).ok, false, 'not private');
  row = { ...privateEvent({ status: 'draft' }), access_password_hash: hash };
  assert.equal((await access.verify('gala', 'open sesame')).ok, false, 'not published');
  row = null;
  assert.equal((await access.verify('nope', 'open sesame')).ok, false, 'not there');
});

test('spaces pasted around a password do not lock guests out', async () => {
  row = { ...privateEvent(), access_password_hash: await access.hashNew('  gala-2026 ') };
  assert.equal((await access.verify('gala', 'gala-2026')).ok, true);
  assert.equal((await access.verify('gala', ' gala-2026  ')).ok, true);
  assert.equal((await access.verify('gala', 'gala 2026')).ok, false);
});

// ── The organizer's length rule (2026-11-22) ────────────────────────────────

test("the organizer's length rule decides what a password may be", async () => {
  const rule = { min: 6, max: 8 };
  await assert.rejects(access.hashNew('abcde', rule), { code: 'VALIDATION_ERROR' });
  await assert.rejects(access.hashNew('abcdefghi', rule), { code: 'VALIDATION_ERROR' });
  assert.ok((await access.hashNew('abcdef', rule)).startsWith('pbkdf2$'));
  // A one-character rule is the organizer's to choose.
  assert.ok((await access.hashNew('x', { min: 1, max: 1 })).startsWith('pbkdf2$'));
});

test('a rule is 1 to 100, shortest no longer than longest', () => {
  assert.equal(access.validRule({ min: 1, max: 100 }), true);
  assert.equal(access.validRule({ min: 6, max: 6 }), true);
  assert.equal(access.validRule({ min: 0, max: 10 }), false);
  assert.equal(access.validRule({ min: 5, max: 101 }), false);
  assert.equal(access.validRule({ min: 9, max: 8 }), false);
  assert.equal(access.validRule({ min: 4.5, max: 8 }), false);
});

test('without a rule of their own the default is 4 to 100', () => {
  assert.deepEqual(access.ruleOf(privateEvent()), { min: 4, max: 100 });
  assert.deepEqual(access.ruleOf(privateEvent({ access_password_min: 6, access_password_max: 10 })), { min: 6, max: 10 });
});

test('the locked screen states the rule the organizer set', () => {
  const failure = access.lockedFailure(privateEvent({ access_password_min: 6, access_password_max: 10 }));
  assert.deepEqual(failure.meta.event.passwordRule, { min: 6, max: 10 });
});

test('a guess outside the rule is a plain no', async () => {
  row = { ...privateEvent({ access_password_min: 6, access_password_max: 10 }), access_password_hash: await access.hashNew('abcdef', { min: 6, max: 10 }) };
  assert.equal((await access.verify('gala', 'abcdef')).ok, true);
  assert.equal((await access.verify('gala', 'abc')).ok, false);
});

test('a password is 4 to 100 characters by default and is stored hashed', async () => {
  await assert.rejects(access.hashNew('abc'), { code: 'VALIDATION_ERROR' });
  await assert.rejects(access.hashNew('    '), { code: 'VALIDATION_ERROR' });
  await assert.rejects(access.hashNew('x'.repeat(101)), { code: 'VALIDATION_ERROR' });
  const hash = await access.hashNew('abcd');
  assert.ok(hash.startsWith('pbkdf2$') && !hash.includes('abcd'));
});

// ── The route guard, mounted as app.js mounts it ─────────────────────────────

async function withApp(fn) {
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(cookieParser());
  const router = express.Router({ mergeParams: true });
  router.get('/', (req, res) => res.json({ success: true, data: 'vendor page' }));
  app.use('/api/v1/public/events/:slug/vendors', access.gate(), router);
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('the guard refuses a locked private event and lets the rest through', async () => {
  await withApp(async (base) => {
    row = privateEvent();
    let res = await fetch(`${base}/api/v1/public/events/gala/vendors`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'EVENT_PRIVATE');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');

    const token = access.issueToken(privateEvent());
    res = await fetch(`${base}/api/v1/public/events/gala/vendors`, {
      headers: { cookie: `${access.cookieName(EVENT_ID)}=${token}` },
    });
    assert.equal(res.status, 200);

    row = privateEvent({ is_private: false });
    res = await fetch(`${base}/api/v1/public/events/gala/vendors`);
    assert.equal(res.status, 200, 'public event');

    row = null;
    res = await fetch(`${base}/api/v1/public/events/nope/vendors`);
    assert.equal(res.status, 200, 'unknown slug is the handler\'s to answer');
  });
});

test("the website's cached read gets the lock as a 200, so its cache cannot keep an old public copy", async () => {
  // Next's data cache stores only 200s: with a 403, a page cached while the
  // event was public stayed cached after it went private (2026-11-22).
  await withApp(async (base) => {
    row = privateEvent();
    const res = await fetch(`${base}/api/v1/public/events/gala/vendors?locked=ok`);
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.locked, true);
    assert.equal(data.code, 'EVENT_PRIVATE');
    assert.deepEqual(data.event, access.lockedFailure(privateEvent()).meta.event, 'the teaser and nothing more');
  });
});

// ── Every public listing leaves private events out ───────────────────────────

test('every public listing of events filters out private ones', () => {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const expectations = [
    ['controllers/discoveryController.js', 1],    // /events, saved events, the sitemap
    ['controllers/landingController.js', 2],      // homepage cities and "near you"
    ['controllers/assistantController.js', 1],    // the homepage assistant
    ['services/organizerProfileService.js', 1],   // /o/<slug>
    ['services/vipEventsService.js', 2],          // the VIP slider and its fallback
    ['services/statsService.js', 1],              // the city count
  ];
  for (const [file, count] of expectations) {
    const found = (read(file).match(/\.eq\('is_private', false\)/g) || []).length;
    assert.equal(found, count, `${file}: expected ${count} private-event filter(s), found ${found}`);
  }
});
