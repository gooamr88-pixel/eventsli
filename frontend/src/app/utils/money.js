/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Money, on the client: FORMATTING ONLY.
 *
 * There is no add, no multiply, no percentage in this file, and that absence is
 * the design. Every total shown to a buyer comes from
 * `GET /public/reservations/:id/quote`, which computes it in the backend where
 * `utils/money.js` is tested and where the four fee items (face, event tax,
 * commission, payment fee) are actually reconciled against what Stripe bills.
 *
 * A client that re-derives a total will eventually disagree with the charge,
 * and the version the buyer believes is the one on their screen. The classic
 * way in is `parseFloat("19.99") * 100`, which is 1998.9999999999998 — a cent
 * short, every time, silently.
 *
 * So: cents in, string out. If you find yourself wanting arithmetic here, the
 * number you want already exists on a quote.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Formatters are cached because constructing an Intl.NumberFormat is genuinely
 * expensive, and a seat map renders one price label per seat — hundreds of
 * calls in a single paint.
 */
const cache = new Map();

function formatter(currency, options) {
  const key = `${currency}|${options}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      ...(options === 'whole'
        ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
    cache.set(key, f);
  }
  return f;
}

/**
 * The only money function most components need.
 *
 *   formatMoney(1999, 'USD')  → "$19.99"
 *   formatMoney(0, 'CAD')     → "CA$0.00"
 *   formatMoney(null, 'USD')  → "—"
 *
 * Locale is fixed to en-US, not the viewer's. The product is English-only, and
 * a viewer-dependent locale would render the same price as "$1,234.50" for one
 * person and "1.234,50 $" for another — then a support call about a price
 * neither party can reproduce. `currency` still varies: it comes from the event
 * row, and CA$ vs $ is information the buyer needs.
 */
export function formatMoney(cents, currency = 'USD') {
  if (cents === null || cents === undefined || Number.isNaN(Number(cents))) return '—';
  return formatter(currency, 'cents').format(Number(cents) / 100);
}

/**
 * Drops the decimals when there are none to show — for headline prices and
 * card labels, where "$45" reads better than "$45.00".
 *
 * Falls back to the full form the moment there IS a fractional part. Rounding
 * a price for display is how "$19.99" becomes "$20" on the card and "$19.99" at
 * checkout, and the buyer notices that difference every time.
 */
export function formatMoneyCompact(cents, currency = 'USD') {
  if (cents === null || cents === undefined || Number.isNaN(Number(cents))) return '—';
  const n = Number(cents);
  if (n % 100 !== 0) return formatMoney(n, currency);
  return formatter(currency, 'whole').format(n / 100);
}

/**
 * A price band across a set of tiers — "From $25" or "$25 – $80".
 *
 * Takes prices already in cents from the API. Sold-out or unpriced tiers arrive
 * as null and are dropped rather than treated as zero, which would render the
 * whole event as "From $0".
 */
export function formatPriceRange(centsList, currency = 'USD') {
  const prices = (centsList || [])
    // null and undefined MUST be dropped before Number(), not after.
    // `Number(null)` is 0 and `Number.isFinite(0)` is true, so filtering on
    // the converted value lets an unpriced tier through as a free one — which
    // rendered a $25 event as "$0 – $25" until a test caught it. `Number('')`
    // is 0 too, so the empty string goes with them.
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(Number)
    .filter((n) => Number.isFinite(n));

  if (prices.length === 0) return null;

  const low = Math.min(...prices);
  const high = Math.max(...prices);

  if (low === high) return formatMoneyCompact(low, currency);
  return `${formatMoneyCompact(low, currency)} – ${formatMoneyCompact(high, currency)}`;
}

/**
 * "Free" is a different statement from "$0.00" — one is a price and the other
 * is an invitation — so it is a separate call the caller opts into rather than
 * a special case buried inside formatMoney.
 */
export function formatPrice(cents, currency = 'USD') {
  if (Number(cents) === 0) return 'Free';
  return formatMoneyCompact(cents, currency);
}
