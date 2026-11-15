const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.IP_HASH_SALT = process.env.IP_HASH_SALT || 'test-salt-for-unit-tests';

/**
 * The checkout signature (signatureService, 2026-11-15).
 *
 * What must hold: a real drawing is accepted and kept exactly; a tap, a dash,
 * junk, or an oversized payload is refused with words a buyer can act on; the
 * SVG we keep is built from numbers or ESCAPED text only, so nothing the
 * browser sent becomes markup; the fingerprint covers what was signed; and an
 * organizer can only reach a signature through an order on their own event.
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const db = { orders: [], purchase_signatures: [], inserted: [] };

function query(table) {
  let rows = [...(db[table] || [])];
  let single = false;
  const q = {
    select() { return q; },
    eq(col, v) { rows = rows.filter((r) => r[col] === v); return q; },
    in(col, list) { rows = rows.filter((r) => list.includes(r[col])); return q; },
    order(col, { ascending = true } = {}) {
      rows.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (ascending ? 1 : -1));
      return q;
    },
    limit(n) { rows = rows.slice(0, n); return q; },
    maybeSingle() { single = true; return q; },
    single() { single = true; return q; },
    insert(row) { db.inserted.push({ table, row }); rows = [{ id: 'sig-1', signed_at: 'now', ...row }]; return q; },
    then(resolve) { return resolve({ data: single ? rows[0] || null : rows, error: null }); },
  };
  return q;
}

stub('config/supabase.js', { supabase: { from: query } });

const sig = require('../services/signatureService');

/** A plausible signature: a long wavy stroke and a crossing one. */
const drawn = () => ({
  method: 'drawn',
  width: 1000,
  height: 300,
  strokes: [
    Array.from({ length: 40 }, (_, i) => [100 + i * 18, 150 + Math.sin(i / 3) * 60]).flat(),
    [300, 80, 360, 220, 420, 90],
  ],
});

test('a real drawing is accepted, rounded to a tenth, and kept stroke for stroke', () => {
  const input = drawn();
  input.strokes[1] = [300.04, 80.06, 360, 220, 420, 90];
  const out = sig.normalize(input);
  assert.equal(out.method, 'drawn');
  assert.equal(out.strokes.length, 2);
  assert.deepEqual(out.strokes[1], [300, 80.1, 360, 220, 420, 90]);
});

test('nothing at all, or an empty pad, asks the buyer to sign', () => {
  for (const input of [undefined, null, 'yes', [], {}, { method: 'drawn', width: 1000, height: 300, strokes: [] }, { method: 'typed', name: '   ' }]) {
    assert.throws(() => sig.normalize(input), (e) => e.code === 'SIGNATURE_REQUIRED', JSON.stringify(input));
  }
});

test('a tap or a short dash is not a signature', () => {
  const dot = { method: 'drawn', width: 1000, height: 300, strokes: [[500, 150]] };
  const dash = { method: 'drawn', width: 1000, height: 300, strokes: [[500, 150, 540, 150]] };
  for (const input of [dot, dash]) {
    assert.throws(() => sig.normalize(input), (e) => e.code === 'SIGNATURE_INVALID' && /full signature/.test(e.message));
  }
});

test('points outside the box, non-numbers, odd arrays and a foreign box size are refused', () => {
  const cases = [
    { ...drawn(), width: 800 },
    { ...drawn(), height: 50 },
    { ...drawn(), strokes: [[100, 100, 1200, 100]] },
    { ...drawn(), strokes: [[100, 100, -1, 100]] },
    { ...drawn(), strokes: [[100, '100', 300, 100]] },
    { ...drawn(), strokes: [[100, 100, 300]] },
    { ...drawn(), strokes: [[100, 100, NaN, 100]] },
    { ...drawn(), strokes: ['<script>'] },
  ];
  for (const input of cases) {
    assert.throws(() => sig.normalize(input), (e) => e.code === 'SIGNATURE_INVALID', JSON.stringify(input));
  }
});

test('an oversized payload is refused before it is stored', () => {
  const many = { ...drawn(), strokes: Array.from({ length: sig.MAX_STROKES + 1 }, () => [100, 100, 400, 200]) };
  assert.throws(() => sig.normalize(many), (e) => e.code === 'SIGNATURE_INVALID');
  const long = { ...drawn(), strokes: Array.from({ length: 5 }, () => Array.from({ length: 1400 }, (_, i) => [i % 1000, 100]).flat()) };
  assert.throws(() => sig.normalize(long), (e) => e.code === 'SIGNATURE_INVALID');
});

test('a typed signature is a trimmed name, without control or direction-override characters', () => {
  assert.deepEqual(sig.normalize({ method: 'typed', name: '  Mona   Adel ' }), { method: 'typed', name: 'Mona Adel' });
  assert.throws(() => sig.normalize({ method: 'typed', name: 'A' }), (e) => e.code === 'SIGNATURE_INVALID');
  assert.throws(() => sig.normalize({ method: 'typed', name: 'x'.repeat(81) }), (e) => e.code === 'SIGNATURE_INVALID');
  assert.throws(() => sig.normalize({ method: 'typed', name: 'Mona‮ládA' }), (e) => e.code === 'SIGNATURE_INVALID');
});

test('the SVG is drawn from the numbers alone, and typed text is escaped', () => {
  const svg = sig.toSvg(sig.normalize(drawn()));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1000 300"/);
  assert.match(svg, /<path d="M[0-9. MQL]+" fill="none"/);
  assert.equal((svg.match(/M/g) || []).length, 2, 'one move per stroke');

  const typed = sig.toSvg(sig.normalize({ method: 'typed', name: '<img src=x onerror=alert(1)> & "Co"' }));
  assert.ok(!typed.includes('<img'), typed);
  assert.match(typed, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;Co&quot;/);
});

test('the fingerprint is stable for the same signature and changes with any point', () => {
  const a = sig.fingerprint(sig.normalize(drawn()));
  assert.equal(a, sig.fingerprint(sig.normalize(drawn())));
  const moved = drawn();
  moved.strokes[1][0] += 1;
  assert.notEqual(a, sig.fingerprint(sig.normalize(moved)));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('recording keeps the buyer, the acceptance, the picture and the fingerprint', async () => {
  db.inserted.length = 0;
  const s = sig.normalize(drawn());
  await sig.record({
    sig: s, eventId: 'ev-1', reservationId: 'res-1', acceptanceId: 'acc-1',
    buyer: { userId: null, email: 'b@x.test', name: 'B' },
    req: { ip: '203.0.113.9', headers: { 'user-agent': 'UA' } },
  });
  const { table, row } = db.inserted[0];
  assert.equal(table, 'purchase_signatures');
  assert.equal(row.method, 'drawn');
  assert.equal(row.typed_name, null);
  assert.deepEqual(row.strokes.strokes, s.strokes);
  assert.equal(row.terms_acceptance_id, 'acc-1');
  assert.equal(row.sha256, sig.fingerprint(s));
  assert.ok(row.svg.startsWith('<svg'));
  assert.equal(row.user_agent, 'UA');
  assert.notEqual(row.ip_hash, '203.0.113.9', 'the address is hashed, never stored');
});

test('an organizer reaches a signature only through an order on their event, latest first', async () => {
  db.orders = [{ id: 'o1', event_id: 'ev-1', reservation_id: 'r1' }, { id: 'o2', event_id: 'ev-2', reservation_id: 'r2' }];
  db.purchase_signatures = [
    { id: 's-old', reservation_id: 'r1', method: 'typed', svg: '<svg/>', sha256: 'a', signed_at: '2026-11-15T10:00:00Z' },
    { id: 's-new', reservation_id: 'r1', method: 'drawn', svg: '<svg/>', sha256: 'b', signed_at: '2026-11-15T10:05:00Z' },
    { id: 's-other', reservation_id: 'r2', method: 'drawn', svg: '<svg/>', sha256: 'c', signed_at: '2026-11-15T10:00:00Z' },
  ];
  const mine = await sig.forOrder('ev-1', 'o1');
  assert.equal(mine.signature.id, 's-new');

  const theirs = await sig.forOrder('ev-1', 'o2');
  assert.equal(theirs.order, null, "another event's order is not found");
  assert.equal(theirs.signature, null);

  const signed = await sig.signedReservations(['r1', null, 'r9']);
  assert.deepEqual([...signed], ['r1']);
});
