const { test } = require('node:test');
const assert = require('node:assert/strict');
const FP = require('../services/vendorFloorPlan');

/** The vendor floor plan, as data (2026-11-20). */

const TYPE = '11111111-1111-1111-1111-111111111111';

test('a plan is rebuilt from known kinds, bounded numbers and short strings', () => {
  const plan = FP.cleanPlan({
    width: 99999,
    height: 'tall',
    elements: [
      { id: 'b1', kind: 'booth', x: 10, y: 20, w: 60.04, h: 60, code: 'DB1 <script>alert', boothTypeId: TYPE, blocked: 'yes', extra: 'dropped' },
      { id: 'b1', kind: 'booth', x: 80, y: 20 },
      { kind: 'wall', points: [[0, 0], [100, 0], ['x', 5], [100]] },
      { kind: 'wall', points: [[0, 0]] },
      { kind: 'label', text: '   ' },
      { kind: 'label', text: 'Lobby', color: 'red' },
      { kind: 'area', text: 'stage', sub: 'Scene', fill: '#0B4F8A' },
      { kind: 'table', seats: 99 },
      { kind: 'spaceship' },
      null,
    ],
  });
  assert.equal(plan.width, 20000);
  assert.equal(plan.height, 800);
  const [b1, b2, wall, label, area, table] = plan.elements;
  assert.deepEqual(b1, { id: 'b1', kind: 'booth', x: 10, y: 20, w: 60, h: 60, r: 0, code: 'DB1 <script>', boothTypeId: TYPE, blocked: false });
  assert.notEqual(b2.id, 'b1', 'a repeated id is replaced');
  assert.equal(b2.boothTypeId, null);
  assert.deepEqual(wall.points, [[0, 0], [100, 0], [0, 5]]);
  assert.equal(label.color, '#1f5fa8', 'a colour that is not hex falls back');
  assert.equal(area.fill, '#0b4f8a');
  assert.equal(table.seats, 16);
  assert.equal(plan.elements.length, 6, 'empty labels, one-point walls and unknown kinds are dropped');
});

test('a plan that is not an object is refused; a huge one is refused', () => {
  assert.throws(() => FP.cleanPlan(null), /could not be read/);
  assert.throws(() => FP.cleanPlan([]), /could not be read/);
  assert.throws(() => FP.cleanPlan({ elements: Array.from({ length: FP.MAX_ELEMENTS + 1 }, () => ({ kind: 'table' })) }), /at most/);
});

test('booth statuses: held, sold, blocked, available — names only for the right audience', () => {
  const plan = FP.cleanPlan({
    elements: [
      { id: 'a', kind: 'booth', code: 'A' }, { id: 'b', kind: 'booth', code: 'B' },
      { id: 'c', kind: 'booth', code: 'C', blocked: true }, { id: 'd', kind: 'booth', code: 'D' },
      { id: 'e', kind: 'booth', code: 'E' },
    ],
  });
  const claims = [
    { id: 'app1', booth_key: 'a', stage: 'offered', business_name: 'Held Co', listed: true },
    { id: 'app2', booth_key: 'b', stage: 'confirmed', paid_at: '2026-11-20', business_name: 'Paid Co', category: 'Food', listed: true },
    { id: 'app3', booth_key: 'e', stage: 'confirmed', paid_at: null, business_name: 'Unpaid Co', listed: true },
  ];
  const pub = FP.boothStatuses(plan, claims);
  assert.deepEqual(pub.a, { status: 'held' });
  assert.deepEqual(pub.b, { status: 'sold', vendor: { name: 'Paid Co', category: 'Food' } });
  assert.deepEqual(pub.c, { status: 'blocked' });
  assert.deepEqual(pub.d, { status: 'available' });
  assert.deepEqual(pub.e, { status: 'sold' }, 'not named in public until paid');
  const org = FP.boothStatuses(plan, claims, { audience: 'organizer' });
  assert.equal(org.a.vendor.name, 'Held Co');
  assert.equal(org.a.applicationId, 'app1');
  assert.equal(FP.boothStatuses(plan, claims, { audience: 'vendor', mine: 'e' }).e.mine, true);
});

test('a save that drops a held booth is caught', () => {
  const next = FP.cleanPlan({ elements: [{ id: 'a', kind: 'booth' }] });
  const lost = FP.removedClaimedBooths(next, [{ booth_key: 'a' }, { booth_key: 'gone', business_name: 'X' }]);
  assert.deepEqual(lost.map((c) => c.booth_key), ['gone']);
});
