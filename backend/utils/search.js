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

module.exports = { safeSearch, escapeLike };
