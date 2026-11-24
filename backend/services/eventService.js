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

  // The setting opens a country; the table says what it sells in. Both must
  // agree, as the database's foreign key into `markets` will also insist.
  const { SUPPORTED_MARKETS, marketFor } = require('../utils/markets');
  const code = String(country || '').toUpperCase();
  const map = data?.value?.by_country || {};
  const currency = map[code] && map[code] === SUPPORTED_MARKETS[code] ? map[code] : null;
  if (!currency) {
    // The open list is ~240 countries now; naming them all helps nobody.
    throw Object.assign(
      new Error(`Events cannot be created in ${marketFor(code)?.name || `"${country}"`} — Eventsli is not open there.`),
      { code: 'VALIDATION_ERROR' },
    );
  }
  return currency;
}

/** Platform defaults for a new event's money settings (BRD §05, §04, §06). */
// The rates come from the fees file's settings reader (feeService), with the
// fixed commission in the event's own currency (2026-11-24).
async function defaultFinancials(currency = null) {
  return require('./feeService').defaultFinancials(currency);
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