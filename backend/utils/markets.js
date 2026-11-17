/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE EVENTSLI OPERATES, AND IN WHAT (BRD §07).
 *
 * Every country an organizer can be in, from `markets.json`. The frontend holds
 * a byte-identical copy (`frontend/src/app/lib/markets.json`, checked by a
 * test) and the database a `markets` table seeded from it, which the
 * organizers' and events' country and currency are foreign keys into.
 *
 *   currency   follows the country and is never chosen separately
 *   card       Stripe offers accounts there, so card checkout CAN be switched
 *              on. Every other country is OFFLINE-ONLY: tickets are sold by
 *              the organizer's own payment methods (bank transfer, cash, …)
 *              and confirmed by hand, and Eventsli invoices its commission.
 *
 * What is actually open is a platform setting (`currencies`):
 *
 *   by_country   { CA: 'CAD', … }  the countries organizers can choose
 *   card         ['CA', 'US']      where card checkout is switched on
 *
 * Card is a separate switch because a Stripe country is not automatically a
 * country this platform's Stripe account can onboard: Stripe's cross-border
 * rules depend on the platform's own country, and CA and US are the only ones
 * verified (connectModel.js). A super admin turns a country's card payments on
 * once an account there has been created in test mode.
 *
 * Six countries under comprehensive sanctions are absent from the table and
 * cannot be opened at all.
 *
 * No imports but the data: pure, so it loads without credentials.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const data = require('./markets.json');

/** `[{ country, name, currency, region, zone, card }]`, by name. */
const MARKET_LIST = Object.freeze(data.markets.map((m) => Object.freeze({ ...m })));

/** Country → currency, for every country Eventsli can open. */
const SUPPORTED_MARKETS = Object.freeze(Object.fromEntries(MARKET_LIST.map((m) => [m.country, m.currency])));

const SUPPORTED_COUNTRIES = Object.freeze(MARKET_LIST.map((m) => m.country));
const SUPPORTED_CURRENCIES = Object.freeze([...new Set(MARKET_LIST.map((m) => m.currency))].sort());

/** The countries where card checkout can be offered at all. */
const CARD_CAPABLE = Object.freeze(MARKET_LIST.filter((m) => m.card).map((m) => m.country));

/** Card checkout's default: the two countries verified against Stripe. */
const DEFAULT_CARD_COUNTRIES = Object.freeze(['CA', 'US']);

const ZERO_DECIMAL = new Set(data.zeroDecimal);
const THREE_DECIMAL = new Set(data.threeDecimal);

/**
 * How many decimal places this currency's minor unit has — 2 for most, 0 for
 * the yen or the CFA franc, 3 for the Kuwaiti dinar. ISO 4217, which is also
 * what Stripe uses; NOT `Intl`'s default, which drops the decimals of a dozen
 * currencies (HUF, COP, IDR, …) for display.
 *
 * Every amount in the system is an integer of THIS unit. "Cents" in a variable
 * name means minor units: yen for JPY, fils for KWD.
 */
function minorUnits(currency) {
  const c = String(currency || '').toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** The market row for a country, or null. */
function marketFor(country) {
  const c = String(country || '').toUpperCase();
  return MARKET_LIST.find((m) => m.country === c) || null;
}

/**
 * The markets a super admin has OPEN, from the `currencies` setting's
 * `by_country` map, in this table's order.
 *
 * Only supported countries selling in their own currency count: a hand-edited
 * row naming an unknown country, or the wrong currency, is offered to nobody.
 * A setting that was never saved (`undefined`) means every supported market;
 * one that was saved and opens nothing means none.
 */
function openCountries(byCountry) {
  if (byCountry === undefined || byCountry === null) return [...SUPPORTED_COUNTRIES];
  if (typeof byCountry !== 'object' || Array.isArray(byCountry)) return [];
  return SUPPORTED_COUNTRIES.filter((c) => byCountry[c] === SUPPORTED_MARKETS[c]);
}

/**
 * The countries where card checkout is ON: the setting's `card` list, kept to
 * card-capable countries. Never saved → the verified default.
 */
function cardCountries(card) {
  if (card === undefined || card === null) return [...DEFAULT_CARD_COUNTRIES];
  if (!Array.isArray(card)) return [];
  const wanted = new Set(card.map((c) => String(c).toUpperCase()));
  return CARD_CAPABLE.filter((c) => wanted.has(c));
}

/** Can an organizer in this country take card payments, given the setting? */
function cardEnabledFor(country, setting) {
  const c = String(country || '').toUpperCase();
  return cardCountries(setting?.card).includes(c);
}

module.exports = {
  MARKET_LIST,
  SUPPORTED_MARKETS,
  SUPPORTED_COUNTRIES,
  SUPPORTED_CURRENCIES,
  CARD_CAPABLE,
  DEFAULT_CARD_COUNTRIES,
  minorUnits,
  marketFor,
  openCountries,
  cardCountries,
  cardEnabledFor,
};
