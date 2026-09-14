/**
 * The time zones an event can run in, by the countries Eventsli sells into
 * (BRD §07). A list rather than a free-text box: the API stores the name, and
 * every date on the event page, the ticket and the emails is formatted with it,
 * so a typo is not a cosmetic problem.
 *
 * One representative IANA zone per civil zone, named the way people say it.
 */
export const TIME_ZONES = {
  CA: [
    ['America/St_Johns', 'Newfoundland'],
    ['America/Halifax', 'Atlantic — Halifax'],
    ['America/Toronto', 'Eastern — Toronto, Ottawa, Montréal'],
    ['America/Winnipeg', 'Central — Winnipeg'],
    ['America/Regina', 'Saskatchewan — Regina'],
    ['America/Edmonton', 'Mountain — Calgary, Edmonton'],
    ['America/Vancouver', 'Pacific — Vancouver'],
    ['America/Whitehorse', 'Yukon — Whitehorse'],
  ],
  US: [
    ['America/New_York', 'Eastern — New York, Miami'],
    ['America/Chicago', 'Central — Chicago, Houston'],
    ['America/Denver', 'Mountain — Denver'],
    ['America/Phoenix', 'Arizona — Phoenix'],
    ['America/Los_Angeles', 'Pacific — Los Angeles, Seattle'],
    ['America/Anchorage', 'Alaska — Anchorage'],
    ['Pacific/Honolulu', 'Hawaii — Honolulu'],
    ['America/Puerto_Rico', 'Atlantic — Puerto Rico'],
  ],
};

const FALLBACK = { CA: 'America/Toronto', US: 'America/New_York' };

/** The zone to preselect: the browser's own when it belongs to the country, else the most populous. */
export function defaultTimeZone(country, browserZone) {
  const zones = zonesFor(country);
  if (browserZone && zones.some(([z]) => z === browserZone)) return browserZone;
  // Not `zones[0]`: the lists run east to west, so that was Newfoundland.
  return FALLBACK[country] || FALLBACK.CA;
}

export function zonesFor(country) {
  return TIME_ZONES[country] || TIME_ZONES.CA;
}
