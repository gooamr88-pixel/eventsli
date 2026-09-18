/**
 * ─────────────────────────────────────────────────────────────────────────────
 * JSON-LD, safe to put inside a <script> tag.
 *
 * `JSON.stringify` IS NOT ENOUGH, and the gap is not theoretical. JSON escaping
 * has no opinion about `<`, so a string containing a closing script tag
 * survives stringification intact — and inside a `<script>` element the HTML
 * parser ends the block at those characters before any JavaScript is parsed at
 * all. What follows is markup.
 *
 * On this platform the values in question are an event's TITLE, VENUE and
 * DESCRIPTION, which an organizer types. An organizer who ends their title with
 * a closing script tag followed by a script of their own gets it executed on
 * the public event page, for every visitor, in the platform's own origin. Admin
 * review stands between a draft and publication, but a reviewer reading a title
 * for tone is not auditing it for markup — and "somebody will notice" is not a
 * control.
 *
 * THE FIX IS TO ESCAPE THE CHARACTERS THAT END THE BLOCK, as unicode escapes.
 * `\u003c` is still `<` to any JSON parser, so the structured data a crawler
 * reads is byte-for-byte what it was; only the bytes the HTML parser sees
 * change. That is why this is done on the way out rather than by stripping the
 * input: the organizer keeps their title, and the page stops executing it.
 *
 * U+2028 and U+2029 are here for a different reason. They are valid inside a
 * JSON string but are LINE TERMINATORS in JavaScript source, so a title
 * containing one produces a script that does not parse — a broken page rather
 * than a stolen session, but broken by the same mechanism.
 *
 * Which is also why this file refers to them only by escape sequence and never
 * types them: the first version of it embedded the real characters in the
 * regex below, and a literal line terminator inside a regex literal ends the
 * regex. The bundler's error ("invalid regular expression: missing /") was the
 * same hazard this module exists to defend against, one level down.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * The KEYS are the characters to find, so they are written as escapes that
 * resolve to those characters. The VALUES are the six-character text that has
 * to appear in the output, so each one needs a DOUBLED backslash — written
 * singly they resolve to the very character they are meant to replace, and the
 * whole replace becomes a no-op that looks correct.
 */
const ESCAPES = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/**
 * @param {unknown} data  the structured-data object
 * @returns {string} JSON that cannot break out of a <script> element
 */
export function jsonLdScript(data) {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (c) => ESCAPES[c]);
}
