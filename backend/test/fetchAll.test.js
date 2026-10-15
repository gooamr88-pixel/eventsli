const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchAll } = require('../utils/fetchAll');

/**
 * The pager behind every "all the seats" read. A fake server that caps each
 * response, the way PostgREST's max_rows does.
 */
function server(total, cap = 1000) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls = [];
  const page = async ({ from, to }, first) => {
    calls.push({ from, to, first });
    const slice = rows.slice(from, Math.min(to + 1, from + cap));
    return { data: slice, error: null, count: first ? total : null };
  };
  return { page, calls };
}

test('a set under one page is one request', async () => {
  const s = server(40);
  assert.equal((await fetchAll(s.page)).length, 40);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].first, true, 'the first request asks for the count');
});

test('a set over the cap is read whole, each row once', async () => {
  const s = server(2500);
  const rows = await fetchAll(s.page);
  assert.equal(rows.length, 2500);
  assert.equal(new Set(rows.map((r) => r.id)).size, 2500);
});

test('a server cap LOWER than the page size does not end the read early', async () => {
  // A short page is what the last page looks like — and also what a page cut
  // down by a lower max_rows looks like. The count is what tells them apart.
  const s = server(1300, 500);
  assert.equal((await fetchAll(s.page, { pageSize: 1000 })).length, 1300);
});

test('an error is thrown, never returned as a short list', async () => {
  let n = 0;
  const page = async () => {
    n += 1;
    return n === 1
      ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null, count: 1500 }
      : { data: null, error: { message: 'statement timeout' } };
  };
  await assert.rejects(() => fetchAll(page, { what: 'seats' }), /could not read seats: statement timeout/);
});

test('a runaway set stops at the ceiling', async () => {
  const s = server(5000);
  await assert.rejects(() => fetchAll(s.page, { max: 2000 }), /more than 2000/);
});
