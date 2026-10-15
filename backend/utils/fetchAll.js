/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Every row of a query, however many there are.
 *
 * Supabase's Data API returns at most `max_rows` rows (1,000 by default) and
 * says nothing when it stops — no error, no flag, just a shorter list. A read
 * that wants ALL of something (every seat in a room) and asks once gets the
 * first page and treats it as the whole. With no ORDER BY, it is not even the
 * same page twice: it follows the physical row order, which a hold or a sale
 * rewrites.
 *
 * So this pages explicitly:
 *
 *   ORDERED by a unique column, so a row cannot slip between pages or appear in
 *   two of them while the set is being read.
 *
 *   COUNTED on the first request (`count: 'exact'`), so the loop stops when it
 *   has them all — not when a page comes back short, which is also what a page
 *   cut down by a lower `max_rows` looks like. That keeps a room under one page
 *   at ONE round trip.
 *
 *   LOUD. An error is thrown, never returned as an empty or partial list: a
 *   seat map that failed to load must read as "it did not load", not as a room
 *   with nobody's seats in it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @param {(range: {from:number,to:number}, first:boolean) => PromiseLike<{data, error, count}>} page
 *        Builds and runs ONE request for the given range. It must apply its own
 *        `.order()` on a unique column and `.range(from, to)`; on the first call
 *        it must select with `{ count: 'exact' }`.
 * @param {object} [opts]
 * @param {number} [opts.pageSize=1000]
 * @param {number} [opts.max=50000]   a ceiling, so a runaway set fails loudly
 * @param {string} [opts.what='rows'] for the error message
 */
async function fetchAll(page, { pageSize = 1000, max = 50000, what = 'rows' } = {}) {
  const rows = [];
  let total = null;

  for (;;) {
    const from = rows.length;
    // eslint-disable-next-line no-await-in-loop
    const { data, error, count } = await page({ from, to: from + pageSize - 1 }, total === null);
    if (error) throw new Error(`could not read ${what}: ${error.message}`);

    if (total === null) total = Number.isFinite(count) ? count : null;
    const got = Array.isArray(data) ? data : [];
    rows.push(...got);

    if (got.length === 0) return rows;                    // nothing more to read
    if (total !== null && rows.length >= total) return rows;
    if (total === null && got.length < pageSize) return rows;   // no count: best effort
    if (rows.length >= max) throw new Error(`refusing to read more than ${max} ${what}`);
  }
}

module.exports = { fetchAll };
