/**
 * ─────────────────────────────────────────────────────────────────────────────
 * How big the platform is, counted.
 *
 * THE STATISTICS ARE THE POINT OF THIS FILE.
 *
 * The design this storefront was built to showed "10K+ Events Created · 2M+
 * Happy Guests · 150+ Cities Worldwide". Every one of those is a number
 * somebody typed. This platform currently has one published event, and the
 * honest version of that strip says so.
 *
 * There is no prop here that takes a number from the CMS, and there is no field
 * for one in `landingSchema`. An admin chooses which measures appear and what
 * they are called; the values are counted in `statsService` at render time. The
 * only way to change the number on the page is to change the business.
 *
 * Anything that fails to count comes back null and its tile is dropped, rather
 * than rendering "0" — which would be a claim ("no organizers") where the truth
 * is "we could not count just now".
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * A count, written the way a person would say it.
 *
 * NOT "10K+" until it earns it. Rounding 1,240 to "1.2K+" hides nothing and
 * reads as bigger; rounding 12 to "10+" is a lie in the other direction, and
 * rounding 1 to "1+" is absurd. So exact below a thousand, abbreviated above,
 * and the "+" only appears where rounding actually discarded something.
 */
export function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.floor(k) : Math.floor(k * 10) / 10}K+`;
  }
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.floor(m) : Math.floor(m * 10) / 10}M+`;
}

/**
 * Which tiles the strip would render, as data.
 *
 * Separate from the component because the CALLER has to know whether the strip
 * is empty, and `<StatStrip/>` is an element object — truthy even when the
 * component returns null. Asking "is this element empty?" is not a question
 * JSX can answer, so the emptiness is decided here instead.
 */
export function statTiles(block, stats) {
  if (!stats || !block || block.enabled === false) return [];

  return [
    block.showEvents !== false && { key: 'events', value: stats.events, label: block.eventsLabel, icon: 'sparkle' },
    block.showOrganizers !== false && { key: 'organizers', value: stats.organizers, label: block.organizersLabel, icon: 'briefcase' },
    block.showGuests !== false && { key: 'guests', value: stats.guests, label: block.guestsLabel, icon: 'users' },
    block.showCities !== false && { key: 'cities', value: stats.cities, label: block.citiesLabel, icon: 'pin' },
    block.showVisits === true && { key: 'visits', value: stats.visits, label: block.visitsLabel, icon: 'trend' },
  ]
    .filter(Boolean)
    // A measure that could not be counted is dropped, not rendered as zero.
    .map((tile) => ({ ...tile, display: formatCount(tile.value) }))
    .filter((tile) => tile.display !== null);
}
