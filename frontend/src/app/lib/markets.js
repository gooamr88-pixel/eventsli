/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE EVENTSLI OPERATES, AND IN WHAT — mirrored from the API (BRD §07).
 *
 * `markets.json` here is a byte-identical copy of `backend/utils/markets.json`
 * (test/markets.test.js fails the moment they differ). Every country picker,
 * the admin's market switches and every money formatter read it, so opening a
 * country or fixing a currency is a change to that one file in both places.
 *
 *   currency   follows the country and is never chosen separately
 *   card       Stripe offers accounts there, so card checkout CAN be switched
 *              on by a super admin. Elsewhere organizers sell OFFLINE, with
 *              their own payment methods, and confirm payments by hand.
 *
 * Which countries are actually open, and where card is on, is the platform
 * setting `GET /public/markets` answers (hooks/useOpenCountries).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import data from './markets.json';

/** `[{ country, name, currency, region, zone, card }]`, by name. */
export const MARKET_LIST = Object.freeze(data.markets.map((m) => Object.freeze({ ...m })));

/** Country → currency. The same table the API holds. */
export const MARKETS = Object.freeze(Object.fromEntries(MARKET_LIST.map((m) => [m.country, m.currency])));

/** What to call each country in a form. Display only; the codes are the data. */
export const COUNTRY_NAMES = Object.freeze(Object.fromEntries(MARKET_LIST.map((m) => [m.country, m.name])));

export const COUNTRIES = Object.freeze(MARKET_LIST.map((m) => m.country));
export const CURRENCIES = Object.freeze([...new Set(MARKET_LIST.map((m) => m.currency))].sort());

/** Where card checkout can be switched on at all. */
export const CARD_CAPABLE = Object.freeze(MARKET_LIST.filter((m) => m.card).map((m) => m.country));

/** A form that has to start somewhere starts in Canada, where Eventsli began. */
export const DEFAULT_COUNTRY = 'CA';

/** `[['AF', 'Afghanistan'], …]` — the shape every country `<select>` takes, by name. */
export const COUNTRY_OPTIONS = Object.freeze(
  MARKET_LIST.map((m) => Object.freeze([m.country, m.name])),
);

/** `[{ country, name, currency, region, card }]`, for the settings screen's switches. */
export const MARKET_ROWS = Object.freeze(
  MARKET_LIST.map((m) => Object.freeze({
    country: m.country, name: m.name, currency: m.currency, region: m.region, card: m.card,
  })),
);

/** The regions the settings screen groups countries under, in table order. */
export const REGIONS = Object.freeze([...new Set(MARKET_LIST.map((m) => m.region))].sort());

const ZERO = new Set(data.zeroDecimal);
const THREE = new Set(data.threeDecimal);

/**
 * Decimals of the currency's minor unit: 2 for most, 0 for JPY or XOF, 3 for
 * KWD. Every amount from the API is an integer of that unit ("cents" in a
 * field name means minor units). ISO 4217, as Stripe and the API use — NOT
 * Intl's display default, which hides the decimals of HUF, COP, IDR and more.
 */
export function minorUnits(currency) {
  const c = String(currency || '').toUpperCase();
  if (ZERO.has(c)) return 0;
  if (THREE.has(c)) return 3;
  return 2;
}

/**
 * What an event in this country is priced in.
 *
 * An unknown country falls back to the default market's currency rather than
 * throwing: this is read to LABEL money that already exists, and a dashboard
 * that crashes on an unexpected code is worse than one that names the wrong
 * one for a moment.
 */
export function currencyFor(country) {
  return MARKETS[String(country || '').toUpperCase()] || MARKETS[DEFAULT_COUNTRY];
}

/**
 * The visitor's likely country, from their clock and then their language:
 * "Africa/Cairo" → EG, "ar-EG" → EG. Null when neither names a country we
 * have. BROWSER ONLY — call it in an effect, never during render, or the
 * server's answer and the browser's will differ and hydration breaks.
 */
export function guessCountry() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const byZone = MARKET_LIST.find((m) => m.zone === zone);
    if (byZone) return byZone.country;
  } catch { /* no Intl zone */ }
  const langs = typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language]) : [];
  for (const lang of langs) {
    const region = String(lang || '').split('-').find((part, i) => i > 0 && /^[A-Za-z]{2}$/.test(part));
    if (region && MARKETS[region.toUpperCase()]) return region.toUpperCase();
  }
  return null;
}

/** The country's main time zone, for a form before a venue sets one. */
export function zoneFor(country) {
  return MARKET_LIST.find((m) => m.country === String(country || '').toUpperCase())?.zone || null;
}
