const { supabase } = require('../config/supabase');
const markets = require('../utils/markets');

/**
 * The `currencies` platform setting, read for the two questions every payment
 * path asks: is this country open, and can it take cards (utils/markets.js).
 *
 * Read on every call rather than cached: a super admin switching a country's
 * card payments off must stop the next checkout, not the one after a restart.
 * It is one indexed row.
 */
async function currencySetting() {
  const { data, error } = await supabase
    .from('platform_settings').select('value').eq('key', 'currencies').maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data.value || {}) : undefined;
}

/** Is card checkout switched on for this country? */
async function cardEnabled(country) {
  const setting = await currencySetting();
  return markets.cardEnabledFor(country, setting);
}

/** What a closed card market is called, for an organizer who asks for Stripe. */
function cardUnavailableMessage(country) {
  const name = markets.marketFor(country)?.name || country;
  return markets.CARD_CAPABLE.includes(String(country || '').toUpperCase())
    ? `Card payments are not switched on for ${name} yet. Sell with your own payment methods — bank transfer, cash — and confirm each payment yourself.`
    : `Card payments are not available in ${name}. Sell with your own payment methods — bank transfer, cash — and confirm each payment yourself.`;
}

/** Throws CARD_NOT_AVAILABLE unless card checkout is on for this country. */
async function assertCardAvailable(country) {
  if (await cardEnabled(country)) return;
  throw Object.assign(new Error(cardUnavailableMessage(country)), { code: 'CARD_NOT_AVAILABLE' });
}

module.exports = { currencySetting, cardEnabled, assertCardAvailable, cardUnavailableMessage };
