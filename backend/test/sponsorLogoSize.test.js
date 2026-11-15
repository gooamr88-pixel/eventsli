const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Sponsor logo size (migration 20261119100000): an admin can show a headline
 * sponsor's logo larger. The size is one of three named steps; anything else
 * is refused with a sentence, and a row without one reads as 'standard'.
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const inserted = [];
let rows = [];

function builder() {
  const q = {
    select() { return q; },
    eq() { return q; },
    not() { return q; },
    order() { return q; },
    insert(row) { inserted.push(row); q.row = row; return q; },
    single: async () => ({ data: { id: 's1', sort_order: 0, is_enabled: true, ...q.row }, error: null }),
    then(resolve) { return resolve({ data: rows, error: null }); },
  };
  return q;
}

stub('config/supabase.js', { supabase: { from: () => builder() } });
stub('services/siteMediaService.js', { remove: async () => {} });

const storefront = require('../services/storefrontService');

test('a size is stored as given, and read back in the public shape', async () => {
  inserted.length = 0;
  const sponsor = await storefront.createSponsor({ name: 'Acme', size: 'xlarge' });
  assert.equal(inserted[0].logo_size, 'xlarge');
  assert.equal(sponsor.size, 'xlarge');
});

test('no size sent leaves the column to its default', async () => {
  inserted.length = 0;
  await storefront.createSponsor({ name: 'Acme' });
  assert.equal('logo_size' in inserted[0], false);
});

test('an unknown size is refused with a sentence, before anything is written', async () => {
  inserted.length = 0;
  await assert.rejects(
    storefront.createSponsor({ name: 'Acme', size: 'huge' }),
    (err) => err instanceof storefront.StorefrontError && /standard, large or extra large/.test(err.message),
  );
  assert.equal(inserted.length, 0);
});

test('the public list carries each size, and an unset one reads as standard', async () => {
  rows = [
    { id: 'a', name: 'A', logo_url: 'https://x/a.svg', logo_size: 'large' },
    { id: 'b', name: 'B', logo_url: 'https://x/b.svg', logo_size: null },
  ];
  const list = await storefront.listSponsors({ publicOnly: true });
  assert.deepEqual(list.map((s) => s.size), ['large', 'standard']);
});
