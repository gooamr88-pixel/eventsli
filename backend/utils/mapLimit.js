/**
 * `items.map(fn)`, awaited, with at most `limit` calls in flight — results in
 * input order.
 *
 * For work that is too slow one at a time and too heavy all at once: an offline
 * scanner reconnecting with 500 queued scans used to upload them as 500
 * sequential database calls, and firing all 500 together would take every
 * connection in the pool from checkout and login.
 *
 * Pure, so it is testable without a database.
 */
async function mapLimit(items, limit, fn) {
  const list = Array.from(items);
  const results = new Array(list.length);
  let next = 0;

  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await fn(list[index], index);
    }
  }

  const width = Math.max(1, Math.min(Math.floor(limit) || 1, list.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

module.exports = { mapLimit };
