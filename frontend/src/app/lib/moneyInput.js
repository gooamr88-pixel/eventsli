import { minorUnits } from './markets';

/**
 * What a person TYPES as an amount, read as the currency's minor units:
 * "25.50" → 2550 in dollars, "3000" → 3000 in yen, "12.5" → 12500 in dinar,
 * "1,250" → 125000 in dollars. Null for anything that is not an amount with at
 * most as many decimals as the currency has — checked, not parsed loosely, so
 * "25.999" in dollars, "30.5" in yen and "abc" are refused rather than
 * rounded or zeroed.
 *
 * Parsed from the string, never `Number(x) * 100`: `19.99 * 100` is
 * 1998.9999999999998, a cent short on every ticket.
 *
 * Kept out of utils/money.js on purpose: that module formats and never
 * computes (test/money.test.js), because totals come from the API. This reads
 * a form field; the server re-checks every amount.
 */
export function parseMoneyToCents(value, currency = 'USD') {
  const digits = minorUnits(currency);
  const text = String(value ?? '').trim().replace(/,/g, '');
  const pattern = digits === 0 ? /^[0-9]+$/ : new RegExp(`^[0-9]+([.][0-9]{1,${digits}})?$`);
  if (!pattern.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  return Number(whole) * 10 ** digits + (digits ? Number((frac + '000').slice(0, digits)) : 0);
}

/**
 * Minor units → what an input shows to edit: 2550 → "25.5", 3000 (yen) →
 * "3000", 12500 (dinar) → "12.5". Empty for no amount.
 */
export function centsToInput(cents, currency = 'USD') {
  if (cents === null || cents === undefined || cents === '' || !Number.isFinite(Number(cents))) return '';
  const digits = minorUnits(currency);
  const n = Number(cents);
  if (!digits) return String(n);
  const scale = 10 ** digits;
  const whole = Math.trunc(n / scale);
  const frac = String(Math.abs(n % scale)).padStart(digits, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** The input's hint: "0.00", "0" or "0.000". */
export function moneyPlaceholder(currency = 'USD') {
  const digits = minorUnits(currency);
  return digits ? `0.${'0'.repeat(digits)}` : '0';
}
