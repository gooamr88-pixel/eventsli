const { test } = require('node:test');
const assert = require('node:assert/strict');
const { uniqueSlug, qualifiedSlugs } = require('../utils/slug');

/**
 * A slug that collides tries the words people search with — the city, the
 * year — before a random suffix, because the slug is the part of the URL a
 * search result shows in full.
 */

const takenBy = (...slugs) => { const set = new Set(slugs); return async (s) => set.has(s); };

test('a free slug is still just the title', async () => {
  assert.equal(await uniqueSlug('Jazz Night', takenBy(), { qualifiers: { city: 'Toronto', year: '2026' } }), 'jazz-night');
});

test('a taken slug tries the city, then the city and year, then the year', async () => {
  const q = { qualifiers: { city: 'Toronto', year: '2026' } };
  assert.equal(await uniqueSlug('Jazz Night', takenBy('jazz-night'), q), 'jazz-night-toronto');
  assert.equal(await uniqueSlug('Jazz Night', takenBy('jazz-night', 'jazz-night-toronto'), q), 'jazz-night-toronto-2026');
  assert.match(
    await uniqueSlug('Jazz Night', takenBy('jazz-night', 'jazz-night-toronto', 'jazz-night-toronto-2026', 'jazz-night-2026'), q),
    /^jazz-night-[0-9a-f]{6}$/, 'then the random suffix, as before',
  );
});

test('a word the title already has is not added twice, and odd input is dropped', () => {
  assert.deepEqual(qualifiedSlugs('toronto-jazz-fest-2026', { city: 'Toronto', year: '2026' }), []);
  assert.deepEqual(qualifiedSlugs('fete', { city: 'Montréal', year: '2026' }), ['fete-montreal', 'fete-montreal-2026', 'fete-2026']);
  assert.deepEqual(qualifiedSlugs('gala', { city: '', year: 'soon' }), []);
  assert.deepEqual(qualifiedSlugs('gala', {}), []);
});

test('without qualifiers the behaviour is exactly what it was', async () => {
  assert.match(await uniqueSlug('Jazz Night', takenBy('jazz-night')), /^jazz-night-[0-9a-f]{6}$/);
});
