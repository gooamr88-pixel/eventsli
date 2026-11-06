const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * services/checkoutSessions.js — the Checkout Session never outlives the hold,
 * a retried "Pay" is never refused, and fulfilment records what was charged.
 *
 * The Supabase client and the Stripe service are replaced before the module
 * loads. The fake `reservations` table APPLIES the filters it is given
 * (eq/gt/lt), so the conditional UPDATE that lengthens a hold is exercised for
 * real rather than assumed. Regressions for TECH-AUDIT-LOG T-010, T-011, T-012.
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const MIN = 60 * 1000;
const RID = '11111111-1111-4111-8111-111111111111';
let row;          // the one reservation
let failUpdate;   // make the next attendee_data update fail
const calls = { create: [], expire: [], retrieve: [] };
const sessions = new Map();

function reservationsTable() {
  let patch = null;
  const filters = [];
  const matches = () => row && filters.every(([op, col, v]) => {
    const have = row[col];
    if (op === 'eq') return have === v;
    const a = new Date(have).getTime();
    const b = new Date(v).getTime();
    return op === 'gt' ? a > b : a < b;
  });
  const run = () => {
    if (!patch) return { data: matches() ? { ...row } : null, error: null };
    if (failUpdate && patch.attendee_data) { failUpdate = false; return { data: null, error: { message: 'boom' } }; }
    if (!matches()) return { data: null, error: null };
    Object.assign(row, patch);
    return { data: { ...row }, error: null };
  };
  const chain = {
    select: () => chain,
    update: (p) => { patch = p; return chain; },
    eq: (c, v) => { filters.push(['eq', c, v]); return chain; },
    gt: (c, v) => { filters.push(['gt', c, v]); return chain; },
    lt: (c, v) => { filters.push(['lt', c, v]); return chain; },
    maybeSingle: async () => run(),
    then: (ok, ko) => Promise.resolve(run()).then(ok, ko),
  };
  return chain;
}

stub('config/supabase.js', { supabase: { from: () => reservationsTable() } });
stub('services/stripeService.js', {
  enabled: () => true,
  async retrieveSession(id) { calls.retrieve.push(id); return { ...sessions.get(id) }; },
  async expireSession(id) {
    calls.expire.push(id);
    const s = sessions.get(id);
    if (s.status !== 'open') throw new Error('not open');
    s.status = 'expired';
  },
  async createCheckoutSession(args) {
    calls.create.push(args);
    // Stripe's idempotency contract: the same key returns the same session.
    const prior = [...sessions.values()].find((s) => s.key === args.idempotencyKey);
    if (prior) return prior;
    const s = {
      id: `cs_${sessions.size + 1}`,
      key: args.idempotencyKey,
      status: 'open',
      url: `https://checkout.stripe.test/${sessions.size + 1}`,
      amount_total: args.quote.breakdown.buyerTotalCents,
      currency: args.quote.event.currency.toLowerCase(),
      expires_at: args.expiresAt,
      customer_email: args.buyer.email,
    };
    sessions.set(s.id, s);
    return s;
  },
});
stub('utils/logger.js', { warn() {}, error() {}, info() {} });

const cs = require('../services/checkoutSessions');

const quote = (total = 11300) => ({
  event: { id: 'e1', currency: 'CAD' },
  breakdown: { buyerTotalCents: total, applicationFeeCents: 300, subtotalCents: total },
});
const buyer = { userId: null, name: 'Ada', email: 'ada@example.test', phone: '' };
const open = (q = quote(), b = buyer) => cs.openSession({
  reservationId: RID, quote: q, buyer: b, origin: 'https://eventsli.test', accountId: 'acct_1',
});

beforeEach(() => {
  const now = Date.now();
  row = {
    id: RID,
    state: 'active',
    created_at: new Date(now - 20 * MIN).toISOString(),
    expires_at: new Date(now + 15 * MIN).toISOString(),   // picked 20 min ago, 35 min TTL
    attendee_data: null,
  };
  failUpdate = false;
  sessions.clear();
  calls.create.length = 0; calls.expire.length = 0; calls.retrieve.length = 0;
});

test('REGRESSION T-010: the session never outlives the hold — the hold is lengthened first', async () => {
  const before = new Date(row.expires_at).getTime();
  const s = await open();
  const holdEnds = new Date(row.expires_at).getTime();
  const sessionEnds = sessions.get(s.id).expires_at * 1000;

  assert.ok(holdEnds > before, 'a hold with 15 minutes left is lengthened');
  assert.ok(sessionEnds <= holdEnds - cs.SESSION_MARGIN_MIN * MIN, 'the session ends inside the hold');
  assert.ok(sessionEnds >= Date.now() + cs.STRIPE_MIN_SESSION_MIN * MIN, 'and still meets Stripe\'s 30-minute minimum');
});

test('a hold already long enough is not lengthened', async () => {
  row.expires_at = new Date(Date.now() + 60 * MIN).toISOString();
  const before = row.expires_at;
  await open();
  assert.equal(row.expires_at, before);
});

test('"Pay" cannot keep seats off sale forever: a hold near its maximum life is refused', async () => {
  row.created_at = new Date(Date.now() - 70 * MIN).toISOString();
  row.expires_at = new Date(Date.now() + 5 * MIN).toISOString();
  await assert.rejects(open(), (e) => e.code === 'RESERVATION_EXPIRED');
  assert.equal(calls.create.length, 0, 'no session is made');
});

test('a lapsed or released hold gets no session', async () => {
  row.expires_at = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(open(), (e) => e.code === 'RESERVATION_EXPIRED');
  row.expires_at = new Date(Date.now() + 10 * MIN).toISOString();
  row.state = 'expired';
  await assert.rejects(open(), (e) => e.code === 'RESERVATION_EXPIRED');
});

test('REGRESSION T-011: a second "Pay" on the same hold returns the same open session', async () => {
  const first = await open();
  const second = await open();
  assert.equal(second.id, first.id);
  assert.equal(second.reused, true);
  assert.equal(calls.create.length, 1, 'Stripe is asked once');
});

test('the idempotency key changes with anything that changes the charge, and only then', () => {
  const base = { amount: 100, currency: 'cad', expiresAt: 1, email: 'a@b' };
  const k = cs.idempotencyKey(RID, base);
  assert.equal(cs.idempotencyKey(RID, { ...base }), k);
  assert.notEqual(cs.idempotencyKey(RID, { ...base, amount: 99 }), k);
  assert.notEqual(cs.idempotencyKey(RID, { ...base, expiresAt: 2 }), k);
  assert.notEqual(cs.idempotencyKey(RID, { ...base, email: 'c@d' }), k);
  assert.ok(k.startsWith(`checkout_${RID}_`));
});

test('REGRESSION T-012: a changed total expires the old session before opening a new one', async () => {
  const first = await open(quote(11300));
  const second = await open(quote(5650));
  assert.notEqual(second.id, first.id);
  assert.deepEqual(calls.expire, [first.id], 'the stale session was made unpayable');
  assert.equal(sessions.get(first.id).status, 'expired');
  assert.equal(row.attendee_data.stripeSessionId, second.id);
  assert.equal(row.attendee_data.quote.buyerTotalCents, 5650, 'the snapshot is the new total');
});

test('a changed buyer detail opens a fresh session rather than reusing one with stale metadata', async () => {
  const first = await open();
  const second = await open(quote(), { ...buyer, name: 'Ada Lovelace' });
  assert.notEqual(second.id, first.id);
  assert.equal(row.attendee_data.buyer.name, 'Ada Lovelace');
});

test('an already-paid session sends the buyer to the receipt, never to a second charge', async () => {
  const first = await open();
  sessions.get(first.id).status = 'complete';
  const again = await open();
  assert.equal(again.id, first.id);
  assert.match(again.url, /\/checkout\/success\?session_id=/);
  assert.equal(calls.create.length, 1);
});

test('closeOpenSession: expires an open session and forgets it, keeping the buyer', async () => {
  const s = await open();
  await cs.closeOpenSession(RID);
  assert.equal(sessions.get(s.id).status, 'expired');
  assert.equal(row.attendee_data.stripeSessionId, undefined);
  assert.equal(row.attendee_data.quote, undefined);
  assert.equal(row.attendee_data.buyer.email, buyer.email);
});

test('closeOpenSession: refuses once the session is paid — its fulfilment needs the hold', async () => {
  const s = await open();
  sessions.get(s.id).status = 'complete';
  await assert.rejects(cs.closeOpenSession(RID), (e) => e.code === 'CONFLICT');
  assert.equal(row.attendee_data.stripeSessionId, s.id, 'nothing was forgotten');
});

test('closeOpenSession: a hold with no session is a no-op', async () => {
  assert.deepEqual(await cs.closeOpenSession(RID), { closed: false });
  assert.equal(calls.retrieve.length, 0);
});

test('a session that cannot be recorded is expired, not handed out', async () => {
  failUpdate = true;
  await assert.rejects(open(), /could not record the checkout session/);
  assert.equal(calls.expire.length, 1, 'the unrecorded session was made unpayable');
});

test('fulfilment records the snapshot when Stripe charged exactly it, even if the quote moved', () => {
  const snapshot = { sessionId: 'cs_1', buyerTotalCents: 5650, currency: 'cad', breakdown: { buyerTotalCents: 5650, tag: 'snap' } };
  const got = cs.breakdownForFulfilment({
    session: { id: 'cs_1', amount_total: 5650, currency: 'cad' },
    snapshot,
    requoted: { buyerTotalCents: 11300, tag: 'requote' },
  });
  assert.equal(got.tag, 'snap');
});

test('fulfilment falls back to the re-quote when the snapshot is for another session or does not match the charge', () => {
  const requoted = { buyerTotalCents: 11300, tag: 'requote' };
  const snapshot = { sessionId: 'cs_1', buyerTotalCents: 5650, currency: 'cad', breakdown: { tag: 'snap' } };
  assert.equal(cs.breakdownForFulfilment({ session: { id: 'cs_2', amount_total: 11300, currency: 'cad' }, snapshot, requoted }).tag, 'requote');
  assert.equal(cs.breakdownForFulfilment({ session: { id: 'cs_1', amount_total: 9999, currency: 'cad' }, snapshot, requoted }).tag, 'requote');
  assert.equal(cs.breakdownForFulfilment({ session: { id: 'cs_1', amount_total: 11300, currency: 'cad' }, snapshot: null, requoted }).tag, 'requote');
});

test('planHold arithmetic: the extension clears Stripe\'s minimum plus the margin', () => {
  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  const plan = cs.planHold({ expiresAt: now + 10 * MIN, createdAt: now - 25 * MIN, now });
  assert.equal(plan.ok, true);
  const sessionEnd = cs.sessionExpiryFor(plan.extendTo.getTime()) * 1000;
  assert.ok(sessionEnd - now >= cs.STRIPE_MIN_SESSION_MIN * MIN);
});
