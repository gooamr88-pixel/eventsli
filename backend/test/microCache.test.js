const { test } = require('node:test');
const assert = require('node:assert/strict');

const { microCache } = require('../utils/microCache');

/** A tiny stand-in for Express's req/res, enough for the middleware. */
function call(mw, url, handler, { method = 'GET' } = {}) {
  const req = { method, originalUrl: url };
  const res = {
    statusCode: 200,
    headers: {},
    sent: undefined,
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(body) { this.sent = body; return this; },
  };
  let ran = false;
  mw(req, res, () => { ran = true; handler(res); });
  return { res, ran };
}

test('the second caller of the same URL gets the remembered body without running the handler', () => {
  let t = 1000;
  const mw = microCache(30_000, { now: () => t });
  let runs = 0;
  const handler = (res) => { runs += 1; res.status(200).json({ success: true, data: runs }); };

  const first = call(mw, '/public/vip-events', handler);
  assert.equal(first.res.headers['X-Cache'], 'MISS');
  t += 5_000;
  const second = call(mw, '/public/vip-events', handler);
  assert.equal(second.ran, false);
  assert.equal(second.res.headers['X-Cache'], 'HIT');
  assert.deepEqual(second.res.sent, { success: true, data: 1 });
  assert.equal(runs, 1);
});

test('each query string is its own entry, and an entry expires', () => {
  let t = 0;
  const mw = microCache(30_000, { now: () => t });
  let runs = 0;
  const handler = (res) => { runs += 1; res.json({ n: runs }); };
  call(mw, '/public/events?city=Cairo', handler);
  call(mw, '/public/events?city=Giza', handler);
  assert.equal(runs, 2);
  t = 31_000;
  call(mw, '/public/events?city=Cairo', handler);
  assert.equal(runs, 3);
});

test('an error is never remembered, and only GET is cached', () => {
  const mw = microCache(30_000);
  let runs = 0;
  call(mw, '/public/cities', (res) => { runs += 1; res.status(500).json({ success: false }); });
  call(mw, '/public/cities', (res) => { runs += 1; res.status(200).json({ ok: true }); });
  assert.equal(runs, 2);
  const post = call(mw, '/public/cities', () => { runs += 1; }, { method: 'POST' });
  assert.equal(post.ran, true);
});

test('stays within its size, dropping the oldest entry first', () => {
  const mw = microCache(30_000, { max: 2 });
  const handler = (res) => res.json({});
  call(mw, '/a', handler);
  call(mw, '/b', handler);
  call(mw, '/c', handler);
  assert.equal(mw.size(), 2);
  assert.equal(call(mw, '/a', handler).ran, true); // /a was evicted
});
