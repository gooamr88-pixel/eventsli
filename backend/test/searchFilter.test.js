const { test } = require('node:test');
const assert = require('node:assert/strict');
const { textFilter } = require('../utils/search');

/**
 * The public listing's text search, as the PostgREST filter it becomes. Every
 * word must match somewhere — in any order — so a search does not depend on
 * typing the title exactly as it was written.
 */

test('one word: any of the four columns, or a category it names', () => {
  assert.equal(
    textFilter('gala', ['gala']),
    'title.ilike.%gala%,venue_name.ilike.%gala%,city.ilike.%gala%,description.ilike.%gala%,category.in.(gala)',
  );
});

test('several words: each must match, in any order', () => {
  const f = textFilter('Elegance  Evening');
  assert.match(f, /^and\(or\(title\.ilike\.%elegance%.*\),or\(title\.ilike\.%evening%.*\)\)$/);
});

test('filter syntax in the query is neutralised, and the word count is capped', () => {
  const f = textFilter('jazz),title.eq.x,(%* night');
  assert.ok(!/[()]\s*title\.eq/.test(f));
  assert.ok(!f.includes('*'));
  const many = textFilter('one two three four five six seven eight');
  assert.equal((many.match(/or\(/g) || []).length, 6);
});

test('nothing searchable is no filter', () => {
  assert.equal(textFilter(''), null);
  assert.equal(textFilter(' a , ( '), null);
});
