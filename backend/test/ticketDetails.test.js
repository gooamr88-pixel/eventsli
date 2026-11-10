const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// A unit test: no database. mediaService needs credentials at load, so its one
// function used here is stubbed, as in venueStudio.test.js.
{
  const file = require.resolve(path.join(__dirname, '..', 'services', 'mediaService'));
  require.cache[file] = {
    id: file, filename: file, loaded: true,
    exports: { publicUrl: (p) => `https://storage.test/object/public/media/${p}` },
  };
}
const { clean, present, ownTierImage, LIMITS } = require('../services/ticketDetails');

const EVENT = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const photo = (event = EVENT) => `events/${event}/tier-0123456789abcdef.jpg`;

test('the photo is kept as a path of this event, and its URL is derived on read', () => {
  const stored = clean(EVENT, { image: { path: photo(), url: 'https://evil.test/x.jpg' } });
  assert.deepEqual(stored.image, { path: photo() });
  const shown = present(EVENT, stored);
  assert.equal(shown.image.url, `https://storage.test/object/public/media/${photo()}`);
});

test("another event's photo, or a non-tier image, is dropped", () => {
  assert.equal(clean(EVENT, { image: { path: photo(OTHER) } }).image, undefined);
  assert.equal(clean(EVENT, { image: { path: `events/${EVENT}/cover-0123456789abcdef.jpg` } }).image, undefined);
  assert.equal(ownTierImage(EVENT, `events/${EVENT}/../${OTHER}/tier-0123456789abcdef.jpg`), false);
});

test('unknown icons fall back, empty rows are dropped, lists are capped', () => {
  const out = clean(EVENT, {
    included: [
      { icon: '<svg onload=x>', title: 'Dinner', text: '' },
      { icon: 'drink', title: '   ' },
      ...Array.from({ length: 20 }, (_, i) => ({ icon: 'star', title: `Perk ${i}` })),
    ],
    notes: [{ icon: 'tag', text: 'Final sale' }, { text: '' }, ...Array.from({ length: 9 }, () => ({ text: 'x' }))],
  });
  assert.deepEqual(out.included[0], { icon: 'check', title: 'Dinner' });
  assert.equal(out.included.length, LIMITS.included);
  assert.equal(out.notes[0].icon, 'tag');
  assert.equal(out.notes.length, LIMITS.notes);
});

test('strings are collapsed and capped; unknown keys are not kept', () => {
  const out = clean(EVENT, { tagline: `  A\n\tlong ${'x'.repeat(500)}`, priceUnit: 'table', evil: 1 });
  assert.ok(out.tagline.startsWith('A long '));
  assert.equal(out.tagline.length, LIMITS.tagline);
  assert.equal(out.priceUnit, 'table');
  assert.equal('evil' in out, false);
});

test('a buyer gets null for an empty card; the editor gets its settings', () => {
  assert.equal(present(EVENT, { showBeforeBuying: true }), null);
  assert.deepEqual(present(EVENT, { showBeforeBuying: true }, { forEditor: true }), { showBeforeBuying: true });
  assert.equal(present(EVENT, null), null);
  assert.deepEqual(clean(EVENT, ['not', 'an', 'object']), {});
});
