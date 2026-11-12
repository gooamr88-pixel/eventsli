/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Phone numbers → E.164, and E.164 → country.
 *
 * Buyers type their number the way they would dial it at home: "0412 345 678",
 * "(416) 555-0199", "+20 100 123 4567", "0020 100…". The checkout stores what
 * they typed. A provider wants E.164. This turns one into the other, using the
 * EVENT's country as the default region for a number typed without a country
 * code — the best evidence we have of where the buyer is.
 *
 * Countries come from `sms_countries` (the database, not this file), so a new
 * country needs no code change. Shared calling codes (+1, +7, +44, +262 …) are
 * told apart by each country's `prefixes`, longest match first; a country with
 * no prefixes owns its whole calling code when `dial_primary`.
 *
 * Pure. No libphonenumber: the rules below cover the trunk-prefix and
 * international-prefix conventions buyers actually use, and anything that does
 * not normalise cleanly is refused rather than guessed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const E164 = /^\+[1-9][0-9]{6,14}$/;

// Countries whose national numbers keep their leading 0 after the country code
// (Italian landlines: 06… is +39 06…). Everywhere else a leading 0 is a trunk
// prefix that is dropped.
const KEEPS_TRUNK_ZERO = new Set(['IT', 'SM', 'VA']);

function buildMatcher(countries) {
  const entries = [];
  const byIso = new Map();
  for (const c of countries || []) {
    byIso.set(c.iso2, c);
    const prefixes = Array.isArray(c.prefixes) ? c.prefixes.filter(Boolean) : [];
    const keys = prefixes.length > 0 ? prefixes : (c.dial_primary !== false ? [c.dial_code] : []);
    for (const k of keys) entries.push([String(k), c.iso2]);
  }
  entries.sort((a, b) => b[0].length - a[0].length);
  return { entries, byIso };
}

function countryOf(e164, matcher) {
  if (!E164.test(String(e164 || ''))) return null;
  const digits = e164.slice(1);
  for (const [prefix, iso] of matcher.entries) {
    if (digits.startsWith(prefix)) return iso;
  }
  return null;
}

function nationalToInternational(digits, country) {
  const dial = country.dial_code;
  if (dial === '1') {
    if (digits.length === 10) return `1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return digits;
    return null;
  }
  if (digits.startsWith('0') && !KEEPS_TRUNK_ZERO.has(country.iso2)) {
    const rest = digits.replace(/^0/, '');
    return rest.length >= 6 ? `${dial}${rest}` : null;
  }
  // Typed with the country code but without + or 00 ("20 100 123 4567").
  const nsnLength = digits.length - dial.length;
  if (digits.startsWith(dial) && nsnLength >= 7 && nsnLength <= 12) return digits;
  return `${dial}${digits}`;
}

/**
 * @returns {{ e164: string, country: string } | null}
 */
function normalize(raw, { defaultCountry = null, matcher } = {}) {
  if (raw == null || !matcher) return null;
  let s = String(raw).trim();
  if (!s || s.length > 40) return null;
  s = s.replace(/\s*(?:ext\.?|x|#)\s*[0-9]+$/i, '');   // extensions cannot receive SMS
  if (/[a-z]/i.test(s)) return null;

  const plus = s.startsWith('+');
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return null;

  const fallback = defaultCountry ? matcher.byIso.get(String(defaultCountry).toUpperCase()) : null;
  let intl = null;
  if (plus) intl = digits;
  else if (digits.startsWith('00')) intl = digits.slice(2);
  else if (digits.startsWith('011') && fallback?.dial_code === '1') intl = digits.slice(3);
  else if (fallback) intl = nationalToInternational(digits, fallback);
  if (!intl) return null;

  const e164 = `+${intl}`;
  if (!E164.test(e164)) return null;
  // North American numbers: NPA and exchange never start with 0 or 1.
  if (intl.startsWith('1') && (intl.length !== 11 || /[01]/.test(intl[1]) || /[01]/.test(intl[4]))) return null;

  const country = countryOf(e164, matcher);
  return country ? { e164, country } : null;
}

/** For logs and lists: enough to recognise, not enough to dial. */
function mask(e164) {
  const s = String(e164 || '');
  if (s.length < 8) return s ? '•••' : '';
  return `${s.slice(0, Math.min(4, s.length - 4))}•••${s.slice(-2)}`;
}

module.exports = { E164, buildMatcher, countryOf, normalize, mask };
