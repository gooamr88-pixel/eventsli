/**
 * Where Eventsli sells, and in what (BRD §07).
 *
 * Canada in CAD, the United States in USD — the currency follows the country
 * and is never chosen separately. One table, read by the organizer sign-up
 * route, the platform settings schema and (as CHECK constraints) the database,
 * so opening a third market is a deliberate change in three known places rather
 * than a two-letter code anyone could type.
 *
 * No imports: pure, so it loads without credentials.
 */
const SUPPORTED_MARKETS = Object.freeze({ CA: 'CAD', US: 'USD' });

const SUPPORTED_COUNTRIES = Object.freeze(Object.keys(SUPPORTED_MARKETS));
const SUPPORTED_CURRENCIES = Object.freeze([...new Set(Object.values(SUPPORTED_MARKETS))]);

/**
 * The markets a super admin has OPEN, from the `currencies` platform setting's
 * `by_country` map, in this table's order.
 *
 * Only supported countries selling in their own currency count: a hand-edited
 * row naming an unknown country, or the wrong currency, is offered to nobody.
 * A setting that was never saved (`undefined`) means the seeded default, every
 * supported market; one that was saved and opens nothing means none.
 */
function openCountries(byCountry) {
  if (byCountry === undefined || byCountry === null) return [...SUPPORTED_COUNTRIES];
  if (typeof byCountry !== 'object' || Array.isArray(byCountry)) return [];
  return SUPPORTED_COUNTRIES.filter((c) => byCountry[c] === SUPPORTED_MARKETS[c]);
}

module.exports = { SUPPORTED_MARKETS, SUPPORTED_COUNTRIES, SUPPORTED_CURRENCIES, openCountries };
