const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapLimit } = require('../utils/mapLimit');

const tick = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test('results come back in input order, whatever order the work finishes in', async () => {
  const out = await mapLimit([30, 5, 20, 1], 4, async (ms, i) => { await tick(ms); return i; });
  assert.deepEqual(out, [0, 1, 2, 3]);
});

test('never more than `limit` calls are in flight', async () => {
  let inFlight = 0;
  let peak = 0;
  await mapLimit(Array.from({ length: 40 }, (_, i) => i), 6, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await tick(2);
    inFlight -= 1;
  });
  assert.equal(peak, 6);
});

test('an empty list and a silly limit are both fine', async () => {
  assert.deepEqual(await mapLimit([], 8, async () => 1), []);
  assert.deepEqual(await mapLimit([1, 2], 0, async (n) => n * 2), [2, 4]);
});
