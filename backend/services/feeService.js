const { supabase } = require('../config/supabase');
const { minorUnits } = require('../utils/markets');
const { commissionExamples } = require('../utils/fees');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FEES' SETTINGS — the part of the fee rules that lives in the database:
 * the card cost model, the platform's default rates for a new event, and the
 * commission an organizer is shown before they create one. The maths is in
 * utils/fees.js; this only reads what it is given.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Stripe's real cost model: settings first, then the environment, then 2.9% + 30. */
async function stripeCostModel() {
  const { data } = await supabase
    .from('platform_settings').select('value').eq('key', 'stripe_cost').maybeSingle();
  return {
    pct: Number(data?.value?.pct ?? process.env.STRIPE_FEE_PCT ?? 2.9),
    fixedCents: Number(data?.value?.fixed_cents ?? process.env.STRIPE_FEE_FIXED_CENTS ?? 30),
  };
}

/**
 * The platform's default rates for a NEW event in `currency` (BRD §04–§06).
 * The fixed commission is per currency (settingsSchema `fixed_by_currency`):
 * a currency with no amount set gets none.
 */
async function defaultFinancials(currency = null) {
  const { data } = await supabase
    .from('platform_settings').select('key, value')
    .in('key', ['commission', 'payment_fee']);
  const byKey = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  const fixedBy = byKey.commission?.fixed_by_currency || {};
  return {
    commission_pct: byKey.commission?.default_pct ?? 1.5,
    commission_fixed_cents: currency ? Number(fixedBy[String(currency).toUpperCase()] || 0) : 0,
    commission_tax_pct: byKey.commission?.default_tax_pct ?? 0,
    payment_fee_mode: byKey.payment_fee?.default_mode ?? 'auto',
    payment_fee_pct: byKey.payment_fee?.default_pct ?? 2.9,
    payment_fee_fixed_cents: byKey.payment_fee?.default_fixed_cents ?? 30,
  };
}

/** Round example prices for a currency: 10, 25, 50, 100 of its major unit. */
function samplePrices(currency, extra = []) {
  const scale = 10 ** minorUnits(currency);
  const base = [10, 25, 50, 100].map((n) => n * scale);
  return [...new Set([...extra.filter((c) => Number.isInteger(c) && c > 0), ...base])].sort((a, b) => a - b).slice(0, 6);
}

/**
 * WHAT EVENTSLI WILL CHARGE ON A NEW EVENT (owner, 2026-11-24: "show the
 * organizer the exact commission before event creation"). The rates a new
 * event in this country would get, and the commission on one ticket at a few
 * prices — the same `commissionCents` every sale uses, so the figure shown is
 * the figure charged. `prices` adds the organizer's own ticket prices.
 */
async function termsFor({ country, prices = [] }) {
  const { currencyForCountry } = require('./eventService');
  const currency = await currencyForCountry(country);
  const d = await defaultFinancials(currency);
  const rates = {
    commissionPct: Number(d.commission_pct),
    commissionFixedCents: Number(d.commission_fixed_cents),
    commissionTaxPct: Number(d.commission_tax_pct),
  };
  return {
    currency,
    ...rates,
    perTicket: rates.commissionFixedCents > 0,
    freeTickets: 'No commission on free tickets.',
    examples: commissionExamples({ ...rates, pricesCents: samplePrices(currency, prices) }),
  };
}

module.exports = { stripeCostModel, defaultFinancials, termsFor, samplePrices };
