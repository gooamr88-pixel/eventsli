/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CART ON THIS DEVICE (owner, 2026-11-17).
 *
 * What a device keeps is only the PROOF of its holds: each reservation's id,
 * its token and the event it is for. The contents — what is held, the price,
 * the deadline — always come from the server (`POST /public/cart`, read by
 * hooks/useCart.js), because the stock is the truth and a second copy kept
 * here would drift from it.
 *
 * localStorage, not sessionStorage: a cart outlives the tab. A guest who
 * closes it and comes back within the hold's 35 minutes still has their seats.
 * Signed in, the account carries the cart between devices; this list is then
 * merged with the server's answer, never trusted over it.
 *
 * Every read and write is guarded — a private window or blocked storage is a
 * cart that lasts one page, not a broken page.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const KEY = 'eventsli.cart.v1';
const MAX = 20;

let cachedRaw;
let cachedList = [];
const listeners = new Set();

function read() {
  if (typeof window === 'undefined') return [];
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { return cachedList; }
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    cachedList = Array.isArray(parsed)
      ? parsed.filter((e) => e && typeof e.reservationId === 'string' && typeof e.reservationToken === 'string').slice(0, MAX)
      : [];
  } catch {
    cachedList = [];
  }
  return cachedList;
}

function write(list) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable — the in-memory copy below still serves this page */ }
  cachedRaw = undefined;
  cachedList = list.slice(0, MAX);
  for (const l of listeners) l();
}

/** The device's holds: `[{ reservationId, reservationToken, slug, addedAt }]`. */
export function cartEntries() {
  return read();
}

export function subscribeCart(listener) {
  listeners.add(listener);
  // Another tab adding or removing something.
  const onStorage = (e) => { if (e.key === KEY) listener(); };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** Adds a hold; `replaces` drops the hold it superseded (a merge). */
export function addToCart(entry, { replaces = null } = {}) {
  const list = read().filter((e) => e.reservationId !== entry.reservationId && e.reservationId !== replaces);
  write([...list, {
    reservationId: entry.reservationId,
    reservationToken: entry.reservationToken,
    slug: entry.slug || null,
    addedAt: new Date().toISOString(),
  }]);
}

/** Drops holds by id — removed, bought or lapsed. */
export function dropFromCart(ids) {
  const gone = new Set(Array.isArray(ids) ? ids : [ids]);
  const list = read();
  const next = list.filter((e) => !gone.has(e.reservationId));
  if (next.length !== list.length) write(next);
}

/**
 * Brings the device in line with the server's live cart: every live item is
 * kept with its fresh token (a signed-in buyer's other devices' holds arrive
 * this way), everything else is dropped.
 */
export function syncCart(items, { askedAt = null } = {}) {
  const known = new Map(read().map((e) => [e.reservationId, e]));
  const next = (items || []).map((i) => ({
    reservationId: i.reservationId,
    reservationToken: i.reservationToken,
    slug: i.event?.slug || known.get(i.reservationId)?.slug || null,
    addedAt: known.get(i.reservationId)?.addedAt || i.addedAt || new Date().toISOString(),
  }));
  // A hold added while this answer was on its way is not in it — and must not
  // be dropped for that. Kept until the next answer can speak for it.
  if (askedAt) {
    const answered = new Set(next.map((e) => e.reservationId));
    for (const e of known.values()) {
      if (!answered.has(e.reservationId) && e.addedAt && e.addedAt > askedAt) next.push(e);
    }
  }
  const same = next.length === known.size
    && next.every((e) => known.get(e.reservationId)?.reservationToken === e.reservationToken);
  if (!same) write(next);
}

/**
 * THE BUYER'S DETAILS, BETWEEN A CART'S CHECKOUTS (2026-11-17).
 *
 * Each event in a cart checks out on its own, and typing the same name and
 * email for each is the first thing a buyer would call unprofessional. Kept in
 * sessionStorage — this tab only, gone when it closes — never across devices
 * or people. A signed-in buyer's details come from the account instead.
 */
const BUYER_KEY = 'eventsli.cart.buyer';

export function rememberBuyer({ name = '', email = '', phone = '' } = {}) {
  try {
    if (!email) return;
    sessionStorage.setItem(BUYER_KEY, JSON.stringify({ name: String(name).slice(0, 200), email: String(email).slice(0, 254), phone: String(phone || '').slice(0, 40) }));
  } catch { /* storage unavailable: the next checkout simply asks again */ }
}

export function recalledBuyer() {
  try {
    const kept = JSON.parse(sessionStorage.getItem(BUYER_KEY) || 'null');
    return kept && typeof kept.email === 'string' ? kept : null;
  } catch {
    return null;
  }
}
