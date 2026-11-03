/**
 * Free text from a query string, made safe to put inside a PostgREST filter.
 *
 * `q` reaches PostgREST inside `ilike` patterns and `or(...)` strings, where a
 * comma or a parenthesis is filter syntax, `%` and `*` are wildcards and a
 * backslash is an escape. Seven call sites each carried their own regex — some
 * stripped the wildcards, some did not, and the organizer's event list passed
 * `q` into `ilike` untouched.
 *
 * Pure, so it is testable without a database.
 */
function safeSearch(q) {
  return String(q ?? '')
    .replace(/[,()\\%*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Text compared as a WHOLE value with `ilike` — a case-insensitive equals.
 *
 * Its LIKE wildcards are escaped, so a tier called "VIP_A" is not a clash with
 * "VIPxA" and a name containing `%` does not match every other name.
 */
function escapeLike(text) {
  return String(text ?? '').replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The PostgREST filter for a text search: EVERY word must appear in the
 * title, the venue, the city or the description — in any order — or the
 * whole query must name a category.
 *
 * Word by word, not one phrase. The phrase form (`title ilike %q%`) found
 * "An Evening of Elegance" for that exact string and for nothing else: "evening
 * elegance", "elegance evening" or "grand evening Baliwag" all came back
 * empty, which reads as a broken search on a catalogue that plainly has the
 * event. Each word is still escaped by `safeSearch`, so no word can carry
 * filter syntax, and the count is capped so a pasted paragraph cannot build an
 * unbounded filter on a public endpoint.
 *
 * @param {string}   q
 * @param {string[]} categorySlugs  categories the whole query names (may be empty)
 * @returns {string|null}  the `or=` value, or null when there is nothing to search
 */
const MAX_WORDS = 6;
const COLUMNS = ['title', 'venue_name', 'city', 'description'];

function textFilter(q, categorySlugs = []) {
  // Double quotes are PostgREST's own quoting inside or(); a stray one would
  // unbalance the filter, so they go along with what safeSearch removes.
  const words = [...new Set(safeSearch(q).replace(/"/g, ' ').toLowerCase().split(' ').filter((w) => w.length >= 2))].slice(0, MAX_WORDS);
  if (words.length === 0) return null;
  const anyColumn = (w) => `or(${COLUMNS.map((c) => `${c}.ilike.%${w}%`).join(',')})`;
  const allWords = words.length === 1 ? anyColumn(words[0]).slice(3, -1) : `and(${words.map(anyColumn).join(',')})`;
  return categorySlugs.length ? `${allWords},category.in.(${categorySlugs.join(',')})` : allWords;
}

module.exports = { safeSearch, escapeLike, textFilter };
