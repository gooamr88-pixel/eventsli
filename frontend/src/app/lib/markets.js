/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE EVENTSLI SELLS, AND IN WHAT — mirrored from the API (BRD §07).
 *
 * The currency follows the country and is never chosen separately.
 *
 * `backend/utils/markets.js` is the authority, and its own note says the list
 * is read "in three known places": that route, the settings schema, and the
 * database's CHECK constraints. There were four more it did not count, all
 * here:
 *
 *     admin/settings/Settings.jsx        the market switches a super admin sets
 *     organizer/CreateProfile.jsx        the country an organization is created in
 *     organizer/events/new/NewEventForm  the country a new event is created in
 *     organizer/dashboard/Dashboard.jsx  country → currency, written as a ternary
 *
 * So opening a third market meant editing seven files, and the four nobody
 * would think to look at are the ones that decide whether anybody can SELECT
 * the new market at all. The failure is quiet in the worst way: the backend
 * accepts it, the database allows it, and no form offers it.
 *
 * Adding one here and in the API's copy is now the whole frontend change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Country → currency. The same table the API holds. */
export const MARKETS = Object.freeze({ CA: 'CAD', US: 'USD' });

/** What to call each country in a form. Display only; the codes are the data. */
export const COUNTRY_NAMES = Object.freeze({ CA: 'Canada', US: 'United States' });

export const COUNTRIES = Object.freeze(Object.keys(MARKETS));
export const CURRENCIES = Object.freeze([...new Set(Object.values(MARKETS))]);

/** The first market, for a form that has to start somewhere. */
export const DEFAULT_COUNTRY = COUNTRIES[0];

/**
 * `[['CA', 'Canada'], …]` — the shape every country `<select>` in the product
 * already takes, so the call sites read exactly as they did.
 */
export const COUNTRY_OPTIONS = Object.freeze(
  COUNTRIES.map((code) => Object.freeze([code, COUNTRY_NAMES[code] || code])),
);

/** `[{ country, name, currency }]`, for the settings screen's switches. */
export const MARKET_ROWS = Object.freeze(
  COUNTRIES.map((country) => Object.freeze({
    country,
    name: COUNTRY_NAMES[country] || country,
    currency: MARKETS[country],
  })),
);

/**
 * What an event in this country is priced in.
 *
 * An unknown country falls back to the first market's currency rather than
 * throwing: this is read to LABEL money that already exists, and a dashboard
 * that crashes on an unexpected code is worse than one that names the wrong
 * one for a moment.
 */
export function currencyFor(country) {
  return MARKETS[String(country || '').toUpperCase()] || MARKETS[DEFAULT_COUNTRY];
}
