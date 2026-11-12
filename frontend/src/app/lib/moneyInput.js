/**
 * What an admin TYPES as an amount, read as cents: "25.50" → 2550, "1,250" →
 * 125000. Null for anything that is not an amount with at most two decimals —
 * checked, not parsed loosely, so "25.999" and "abc" are refused rather than
 * rounded or zeroed.
 *
 * Kept out of utils/money.js on purpose: that module formats and never
 * computes (test/money.test.js), because totals come from the API. This reads
 * a form field; the server re-checks the amount against the balance.
 */
export function parseMoneyToCents(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!/^[0-9]+([.][0-9]{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}
