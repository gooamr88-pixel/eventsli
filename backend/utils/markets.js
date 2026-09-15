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

module.exports = { SUPPORTED_MARKETS, SUPPORTED_COUNTRIES, SUPPORTED_CURRENCIES };
