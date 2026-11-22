const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * A private event's cover, blurred (2026-11-22) — controllers/lockedCoverController.js.
 * Storage and the database are stubbed; the image work is real (sharp), where
 * sharp is installed.
 */
let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }

const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let row = null;
let file = null;
const downloads = [];
stub('config/supabase.js', {
  supabase: {
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
      return chain;
    },
    storage: {
      from: (bucket) => ({
        download: async (p) => { downloads.push({ bucket, p }); return { data: file, error: file ? null : { message: 'missing' } }; },
      }),
    },
  },
});

const { show } = require('../controllers/lockedCoverController');

function response() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.set = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.end = (b) => { res.body = b ?? null; return res; };
  return res;
}
async function run(slug = 'gala') {
  const res = response();
  await show({ params: { slug } }, res, (err) => { throw err; });
  return res;
}
const event = (over = {}) => ({
  id: 'e1', status: 'published', is_private: true, cover_path: 'events/e1/cover.jpg', locked_reveal: ['title'], ...over,
});

test('a hidden cover comes back 24 pixels wide, read from storage by its path', { skip: !sharp && 'sharp is not installed' }, async () => {
  const big = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();
  file = new Blob([big]);
  row = event();
  const res = await run();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
  assert.equal((await sharp(res.body).metadata()).width, 24);
  assert.ok(res.body.length < big.length / 10);
  assert.deepEqual(downloads.at(-1), { bucket: 'event-media', p: 'events/e1/cover.jpg' });
});

test('nothing for a public event, an unpublished one, a shown cover, or no cover', async () => {
  file = new Blob([Buffer.from('x')]);
  for (const over of [{ is_private: false }, { status: 'draft' }, { locked_reveal: ['cover'] }, { cover_path: null }]) {
    row = event(over);
    const before = downloads.length;
    assert.equal((await run()).statusCode, 404, JSON.stringify(over));
    assert.equal(downloads.length, before, 'storage is not even read');
  }
  row = null;
  assert.equal((await run()).statusCode, 404, 'an unknown slug');
});

test('a cover that cannot be read is a 404, never a crash', { skip: !sharp && 'sharp is not installed' }, async () => {
  row = event();
  file = null;
  assert.equal((await run()).statusCode, 404);
});
