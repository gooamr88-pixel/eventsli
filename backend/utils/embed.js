/**
 * A to-one embed, however PostgREST returned it: an object, a one-row array,
 * or nothing. Three files carried their own copy of this line.
 *
 * Pure, so it is testable without a database.
 */
const one = (x) => (Array.isArray(x) ? x[0] : x) || null;

module.exports = { one };
