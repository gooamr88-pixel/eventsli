/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHOSE GUEST — the host a buyer arrived from (2026-11-23).
 *
 * Each host has their own link to the event: `/e/<slug>?guestof=<code>`. The
 * event page remembers the code for that event, in this browser, so the
 * checkout can pick that host for the buyer — who can still change it. Nothing
 * else is stored, and never anything about the buyer.
 *
 * Storage can be refused (a private window, blocked site data): every read
 * and write is guarded, and the checkout simply asks with nothing picked.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const KEY = (slug) => `es_guestof:${slug}`;
const CODE = /^[a-z0-9-]{1,32}$/;

/** Remembers the host code from a link, for this event. */
export function rememberGuestOf(slug, code) {
  if (!slug || !CODE.test(String(code || ''))) return;
  try { window.localStorage.setItem(KEY(slug), String(code)); } catch { /* storage refused */ }
}

/** The host code remembered for this event, or null. */
export function recalledGuestOf(slug) {
  if (!slug || typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(KEY(slug));
    return CODE.test(String(v || '')) ? v : null;
  } catch {
    return null;
  }
}

/** The host a remembered code points at, among the hosts the checkout offers. */
export function pickFromCode(guestOf, code) {
  if (!guestOf || !code) return null;
  return guestOf.hosts.find((h) => h.code === code)?.id || null;
}
