/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MONEY PRIMITIVES: integer cents, rounding, formatting, parsing.
 *
 * Every amount in this system is an INTEGER NUMBER OF CENTS. No floats, ever,
 * anywhere — not in the database, not in an API response, not in a local
 * variable. `parseFloat("19.99") * 100` is 1998.9999999999998, and a cent lost
 * per order is a real reconciliation gap by the end of a month.
 *
 * Percentages are the one exception: they arrive as decimals (1.5 means 1.5%)
 * because that is how an admin types them, and they are multiplied out and
 * rounded here, once, at the end.
 *
 * THE FEES — commission, payment fee, tax, Stripe cost and every breakdown —
 * live in ./fees.js (2026-11-24). They are re-exported from here, read on
 * first use, so `require("../utils/money").describeOrder` keeps working.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { minorUnits } = require('./markets');

/** Guard: every amount crossing this module must be a safe integer. */
function assertCents(value, label) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer number of cents, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} exceeds the safe integer range: ${value}`);
  }
  return value;
}

/**
 * Apply a percentage to a cent amount, rounding half away from zero.
 *
 * Deliberately NOT Math.round: that rounds -0.5 to -0 ("half up" toward
 * positive infinity), so a refund reversal would round differently from the
 * sale it reverses and the pair would not cancel to zero in the ledger.
 */
function pctOf(cents, pct) {
  assertCents(cents, 'base');
  const raw = (cents * Number(pct)) / 100;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/**
 * Money → display string. Presentation only; never feed this back into math.
 *
 * "Cents" throughout this module means the currency's MINOR unit — yen for
 * JPY, fils for KWD — and `minorUnits` says how many decimals that is. The
 * decimals shown are always those, never Intl's own default (which hides the
 * decimals of HUF, COP, IDR and others that Stripe and ISO 4217 keep).
 */
function formatCents(cents, currency = 'USD', locale = 'en-CA') {
  assertCents(cents, 'amount');
  const code = String(currency).toUpperCase();
  const digits = minorUnits(code);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 10 ** digits);
}

/** As formatCents, without the decimals when they are all zero: "$45", "€12.50", "¥3,000". */
function formatCompact(cents, currency = 'USD', locale = 'en-US') {
  assertCents(cents, 'amount');
  const scale = 10 ** minorUnits(currency);
  if (cents % scale !== 0) return formatCents(cents, currency, locale);
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: String(currency).toUpperCase(), minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(cents / scale);
}

/**
 * Parse a human-typed amount ("19.99", "1,299.50") into minor units WITHOUT
 * floats, allowing exactly as many decimals as the currency has.
 *
 * String-split rather than `Math.round(parseFloat(x) * 100)` so the value never
 * passes through a binary float at all. The float route is correct for almost
 * every input, which is exactly what makes the handful it gets wrong so hard to
 * find later.
 */
function parseAmountToCents(input, currency = 'USD') {
  const digits = minorUnits(currency);
  const s = String(input).trim().replace(/,/g, '');
  const pattern = digits === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+(\\.\\d{0,${digits}})?$`);
  if (!pattern.test(s)) {
    throw new TypeError(`Not a valid money amount: "${input}"`);
  }
  const negative = s.startsWith('-');
  const [whole, frac = ''] = (negative ? s.slice(1) : s).split('.');
  const minor = parseInt(whole, 10) * 10 ** digits
    + (digits ? parseInt((frac + '000').slice(0, digits), 10) : 0);
  return negative ? -minor : minor;
}

module.exports = {
  assertCents,
  pctOf,
  formatCents,
  formatCompact,
  parseAmountToCents,
};

// The fee names, from ./fees.js. Getters, read on first use: fees.js requires
// this file for the primitives above, so a plain require here would be a cycle.
const FEE_NAMES = [
  'stripeCostCents', 'solvePaymentFeeCents', 'autoPaymentFeeCents', 'describeOrder', 'describeFeeConfig',
  'commissionCents', 'FEE_BEARER', 'PAYMENT_FEE_MODE', 'CHARGE_MODEL',
];
for (const name of FEE_NAMES) {
  Object.defineProperty(module.exports, name, { enumerable: true, get: () => require('./fees')[name] });
}
