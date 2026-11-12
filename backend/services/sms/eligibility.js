/**
 * Whether one audience member may receive a marketing campaign — the same
 * questions the dispatch policy asks, answered early so a campaign's counts
 * are honest before anything is queued. Pure.
 */
/** Why one audience member cannot receive marketing, or null if they can. Pure. */
function exclusion({ parsed, cfg, def, suppression, consent }) {
  if (!parsed) return 'invalid_number';
  if (def.recipientCountries && !def.recipientCountries.includes(parsed.country)) return 'filtered_country';
  const country = cfg.countryByIso.get(parsed.country);
  if (!country || country.status !== 'enabled') return 'country_not_enabled';
  if (!country.marketing_allowed) return 'marketing_not_allowed';
  if (suppression) return 'suppressed';
  if (!consent || consent.status === 'opted_out') return 'no_consent';
  if (consent.status !== 'opted_in') return 'consent_pending';
  return null;
}

module.exports = { exclusion };
