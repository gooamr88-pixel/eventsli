const { supabase } = require('../config/supabase');
const rules = require('./eventRules');

/**
 * Event queries that need the database.
 *
 * The RULES — the field allowlists and the status machine — live in
 * eventRules.js with no imports at all, so they can be tested without
 * credentials. They are re-exported here so callers have one place to import
 * from and do not have to know which half a given helper came from.
 */
/**
 * Currency follows the event's country (BRD §07).
 *
 * Resolved from platform_settings so an admin can open a new market without a
 * deploy. Unknown country is an error rather than a default: silently charging
 * a Montreal event in USD is a worse outcome than refusing to create it.
 */
async function currencyForCountry(country) {
  const { data } = await supabase
    .from('platform_settings').select('value').eq('key', 'currencies').maybeSingle();

  const map = data?.value?.by_country || {};
  const currency = map[String(country || '').toUpperCase()];
  if (!currency) {
    const allowed = Object.keys(map).join(', ') || 'none configured';
    throw Object.assign(
      new Error(`Events cannot be created in "${country}" yet. Supported: ${allowed}.`),
      { code: 'VALIDATION_ERROR' },
    );
  }
  return currency;
}

/** Platform defaults for a new event's money settings (BRD §05, §04, §06). */
async function defaultFinancials() {
  const { data } = await supabase
    .from('platform_settings').select('key, value')
    .in('key', ['commission', 'payment_fee']);

  const byKey = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return {
    commission_pct: byKey.commission?.default_pct ?? 1.5,
    commission_tax_pct: byKey.commission?.default_tax_pct ?? 0,
    payment_fee_mode: byKey.payment_fee?.default_mode ?? 'auto',
    payment_fee_pct: byKey.payment_fee?.default_pct ?? 2.9,
    payment_fee_fixed_cents: byKey.payment_fee?.default_fixed_cents ?? 30,
  };
}

/**
 * Has anything been sold? Several rules hinge on this (BRD §07, §13).
 *
 * The database enforces the price and currency freezes with triggers; this
 * exists so the API can refuse with a clear message BEFORE Postgres raises a
 * constraint error the user cannot read.
 */
async function hasPaidOrders(eventId) {
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'paid');
  return (count || 0) > 0;
}

module.exports = {
  // Pure rules, re-exported from eventRules.js
  ...rules,
  // Queries
  currencyForCountry,
  defaultFinancials,
  hasPaidOrders,
};