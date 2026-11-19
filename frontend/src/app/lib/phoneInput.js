import { PHONE_COUNTRIES } from './phoneCountries';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The phone field's logic (2026-11-19): a country (flag + calling code) and
 * the number as people dial it at home. Pure, so it is tested directly.
 *
 * The value handed to forms is international — "+20 100 123 4567" — which
 * the API's normaliser (backend/services/sms/phone.js) reads exactly. A
 * national trunk 0 ("0100…" in Egypt, "07…" in the UK) is dropped on the way,
 * the way it is dialled from abroad, except where it is part of the number
 * (Italy, San Marino, the Vatican).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const COUNTRIES = PHONE_COUNTRIES.map(([iso, name, dial, prefixes = [], primary = true]) => ({
  iso, name, dial, prefixes, primary,
}));
export const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));

const KEEPS_TRUNK_ZERO = new Set(['IT', 'SM', 'VA']);

// Longest match first: "+1 204…" is Canada by prefix, "+1 212…" the US by default.
const MATCHERS = COUNTRIES
  .flatMap((c) => (c.prefixes.length ? c.prefixes : c.primary ? [c.dial] : []).map((p) => [p, c.iso]))
  .sort((a, b) => b[0].length - a[0].length);

/** "/flags/EG.svg" — the site's own copy (country-flag-icons, MIT). */
export const flagSrc = (iso) => `/flags/${iso}.svg`;

/**
 * An international value → { iso, national }. `prefer` keeps the country a
 * person chose when the code is shared ("+1" stays Canada if Canada was picked).
 */
export function splitPhone(value, prefer = null) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('+')) return { iso: prefer, national: raw };
  const digits = raw.replace(/\D/g, '');
  const preferred = prefer && BY_ISO.get(prefer);
  if (preferred && digits.startsWith(preferred.dial)) {
    return { iso: prefer, national: raw.replace(/^\+\s*/, '').slice(nationalOffset(raw, preferred.dial)).trim() };
  }
  for (const [prefix, iso] of MATCHERS) {
    if (digits.startsWith(prefix)) {
      const dial = BY_ISO.get(iso).dial;
      return { iso, national: raw.replace(/^\+\s*/, '').slice(nationalOffset(raw, dial)).trim() };
    }
  }
  return { iso: prefer, national: raw };
}

/** Where the national part starts in "+<dial>…", counting only the dial's digits. */
function nationalOffset(raw, dial) {
  const s = raw.replace(/^\+\s*/, '');
  let seen = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (/\d/.test(s[i])) seen += 1;
    if (seen === dial.length) return i + 1;
  }
  return s.length;
}

/** { iso, national } → "+20 100 123 4567", or "" when nothing is typed. */
export function joinPhone(iso, national) {
  const c = BY_ISO.get(iso);
  let n = String(national || '').replace(/[^\d\s\-()]/g, '').trim();
  if (!n.replace(/\D/g, '')) return '';
  if (!c) return n;
  if (!KEEPS_TRUNK_ZERO.has(c.iso)) n = n.replace(/^0+(?=\d)/, '');
  return `+${c.dial} ${n}`;
}

/** Countries matching a search: by name, ISO code or calling code ("+20", "20", "egy"). */
export function searchCountries(q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return COUNTRIES;
  const digits = t.replace(/\D/g, '');
  return COUNTRIES.filter((c) => c.name.toLowerCase().includes(t)
    || c.iso.toLowerCase() === t
    || (digits && t.replace(/[\s+]/g, '') === digits && c.dial.startsWith(digits)));
}

/** The visitor's country from their browser's language ("en-EG" → EG), if we know it. */
export function localeCountry(languages) {
  for (const tag of languages || []) {
    const region = String(tag).split(/[-_]/)[1];
    if (region && region.length === 2 && BY_ISO.has(region.toUpperCase())) return region.toUpperCase();
  }
  return null;
}
