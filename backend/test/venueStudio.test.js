const { test } = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');

// A unit test: no database and no environment. mediaService requires
// config/supabase, which throws at load without credentials (CI's unit job has
// none), so its one function used here is stubbed, the way the other unit
// tests stub what they import. The stub keeps the property tested below: the
// URL is derived from the path, nothing else.
{
  const file = require.resolve(path.join(__dirname, '..', 'services', 'mediaService'));
  require.cache[file] = {
    id: file, filename: file, loaded: true,
    exports: { publicUrl: (p) => `https://storage.test/object/public/media/${p}` },
  };
}
const {
  sanitizeLayout, ownPath, MAX_VIEWS, DEFAULT_WORLD, MAX_WORLD,
} = require('../services/venueStudio');

/**
 * The Venue Studio's keys in the layout blob. The blob is written by a client
 * and read on the buyer's public page, so the property that matters is: an
 * image URL on that page is always one the server derived from a path this
 * event's upload step could have created.
 */
const EVENT = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const pano = (n = 'a') => `events/${EVENT}/panorama-${n.repeat(16).slice(0, 16)}.jpg`;

test('a client-supplied URL is discarded and the URL is derived from the path', () => {
  const out = sanitizeLayout(EVENT, {
    views: [{ id: 'v1', name: 'Row H', kind: 'seat', path: pano('a'), url: 'https://evil.test/x.jpg' }],
  });
  assert.equal(out.views.length, 1);
  assert.ok(!out.views[0].url.includes('evil.test'));
  assert.ok(out.views[0].url.endsWith(pano('a')), 'the URL is the public URL of the path');
});

test('a path outside this event, or not an upload key, is dropped', () => {
  const out = sanitizeLayout(EVENT, {
    views: [
      { name: 'Theirs', path: `events/${OTHER}/panorama-aaaaaaaaaaaaaaaa.jpg` },
      { name: 'Traversal', path: `events/${EVENT}/../${OTHER}/panorama-aaaaaaaaaaaaaaaa.jpg` },
      { name: 'Cover', path: `events/${EVENT}/cover-aaaaaaaaaaaaaaaa.jpg` },
      { name: 'Url only', url: 'https://cdn.test/p.jpg' },
    ],
    venue: { name: 'Hall', photo: { path: `events/${OTHER}/venue-aaaaaaaaaaaaaaaa.png` } },
  });
  assert.deepEqual(out.views, []);
  assert.equal(out.venue.photo, null);
});

test('ownPath accepts exactly the keys mediaService signs', () => {
  assert.ok(ownPath(EVENT, `events/${EVENT}/venue-0123456789abcdef.webp`, ['venue']));
  assert.ok(!ownPath(EVENT, `events/${EVENT}/venue-0123456789abcdef.webp`, ['panorama']));
  assert.ok(!ownPath(EVENT, `events/${EVENT}/venue-0123456789abcdef.svg`, ['venue']));
  assert.ok(!ownPath(EVENT, null, ['venue']));
});

test('views are capped, de-duplicated and their fields clamped', () => {
  const many = Array.from({ length: MAX_VIEWS + 5 }, (_, i) => ({
    id: `v${i}`, path: pano(String(i % 10)), kind: 'nonsense', heading: 999, tables: ['A', 'A', 'B'],
  }));
  many.push({ id: 'v0', path: pano('b') });
  const out = sanitizeLayout(EVENT, { views: many });
  assert.equal(out.views.length, MAX_VIEWS);
  assert.equal(out.views[0].kind, 'other');
  assert.equal(out.views[0].heading, 180);
  assert.deepEqual(out.views[0].tables, ['A', 'B']);
});

test("a view's spot (where the photo was taken) is kept, clamped, or dropped when unreadable", () => {
  const out = sanitizeLayout(EVENT, {
    views: [
      { id: 'a', path: pano('a'), spot: { x: 42.12345, y: 130, h: 99 } },
      { id: 'b', path: pano('b'), spot: { x: 'left', y: 10 } },
      { id: 'c', path: pano('c') },
      { id: 'd', path: pano('d'), spot: { x: 5, y: 6 } },
    ],
  });
  assert.deepEqual(out.views[0].spot, { x: 42.123, y: 100, h: 6 });
  assert.ok(!('spot' in out.views[1]), 'an unreadable spot is dropped, not guessed');
  assert.ok(!('spot' in out.views[2]));
  assert.deepEqual(out.views[3].spot, { x: 5, y: 6, h: 1.5 }, 'a missing height is a standing person');
});

test('unknown keys pass through untouched, and absent studio keys stay absent', () => {
  const layout = { world: { width: 1000, height: 700 }, zones: [{ id: 'z', kind: 'stage' }], future: { x: 1 } };
  assert.deepEqual(sanitizeLayout(EVENT, layout), layout);
});

test('the venue size (layout.world) is kept, clamped and rounded, and an unreadable one is dropped', () => {
  // A stadium: kept as sent.
  assert.deepEqual(sanitizeLayout(EVENT, { world: { width: 8000, height: 5600 } }).world, { width: 8000, height: 5600 });
  // Out of range either way: held to the default below and the maximum above.
  assert.deepEqual(sanitizeLayout(EVENT, { world: { width: 200, height: 99999 } }).world, { width: DEFAULT_WORLD.width, height: MAX_WORLD.height });
  assert.deepEqual(sanitizeLayout(EVENT, { world: { width: '4000.6', height: 2800.2 } }).world, { width: 4001, height: 2800 });
  // Unreadable: the key goes, and the map draws in the default world.
  for (const bad of [null, 'big', { width: 'x', height: 700 }, { width: 4000 }]) {
    assert.equal('world' in sanitizeLayout(EVENT, { world: bad, zones: [] }), false, JSON.stringify(bad));
  }
  // Every map saved before worlds were per map carries exactly the default.
  assert.deepEqual(DEFAULT_WORLD, { width: 1000, height: 700 });
});

test('scene and venue settings are clamped to what the renderers draw', () => {
  const out = sanitizeLayout(EVENT, {
    scene: { rake: 500, stageHeight: -3, mood: 'disco', screens: false },
    venue: { name: 'x'.repeat(500), type: 'castle', standingCapacity: -4, access: ['wheelchair', 'lasers'] },
  });
  assert.deepEqual(out.scene, { rake: 40, stageHeight: 0, mood: 'concert', screens: false, roof: true });
  assert.equal(out.venue.name.length, 120);
  assert.equal(out.venue.type, 'arena');
  assert.equal(out.venue.standingCapacity, 0);
  assert.deepEqual(out.venue.access, ['wheelchair']);
});

test('a blob too large to serve is refused as a validation error', () => {
  const zones = Array.from({ length: 3000 }, (_, i) => ({ id: `z${i}`, kind: 'custom', label: 'x'.repeat(80) }));
  assert.throws(() => sanitizeLayout(EVENT, { zones }), (err) => err.code === 'VALIDATION_ERROR');
});
