'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { post } from '../utils/apiClient';
import { addToCart } from '../lib/cartStore';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hold, as an object with a life of its own.
 *
 * A reservation is not a value one page returns. It is created on the seat map,
 * carried to the checkout, spent at Stripe or released — and it expires on a
 * clock nobody controls, 35 minutes after it was made. Keeping it inside
 * whichever page happens to be mounted means a reload on the checkout loses the
 * token, and the seats are stranded until the sweeper collects them.
 *
 * WHY THE TOKEN AND NOT THE ID. `POST /hold` returns a `reservationToken`
 * beside the id, and both release and promo require it. The API's reasoning,
 * which this file exists to respect: a bare reservation id travels to the
 * client, so anyone who picked one up could drop somebody else's seats while
 * they were paying. The id identifies; the token authorises.
 *
 * WHY sessionStorage AND NOT localStorage. A hold belongs to one tab's attempt
 * at buying. localStorage would share it, so opening the same event in a second
 * tab would have that tab adopt the first's hold and release it out from
 * under them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KEY = 'eventsli.reservation';

/** The header a private table's unlock key travels in — read by the public
 *  seat map AND by the hold (seatMapController.js). One name, one place. */
export const TABLE_ACCESS_HEADER = 'x-table-access';

/** The header that proves a cart's existing hold is the buyer's, when a new hold replaces it. */
export const REPLACE_HEADER = 'x-replace-token';

/**
 * A module-level cache, because useSyncExternalStore demands a STABLE snapshot:
 * parsing the JSON on every call returns a new object each time, React sees the
 * store as perpetually changed, and the component re-renders forever.
 */
let cachedRaw;
let cachedValue = null;

const listeners = new Set();

function rawItem() {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    // A private window, or storage disabled. Not remembering a hold is
    // survivable; throwing on a seat map is not.
    return null;
  }
}

function snapshot() {
  const raw = rawItem();
  if (raw === cachedRaw) return cachedValue;

  cachedRaw = raw;
  cachedValue = null;

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      // An expiry already past is not a reservation, it is litter. Dropping it
      // here means no page is ever handed a hold it will only be refused for.
      if (parsed?.reservationId && new Date(parsed.expiresAt).getTime() > Date.now()) {
        cachedValue = parsed;
      }
    } catch { /* corrupt entry — treated as absent */ }
  }

  return cachedValue;
}

function subscribe(callback) {
  listeners.add(callback);
  // Another tab writing the same key. Rare, since a hold is per-tab, but a
  // second tab that releases one should not leave this one showing it.
  if (typeof window !== 'undefined') window.addEventListener('storage', callback);
  return () => {
    listeners.delete(callback);
    if (typeof window !== 'undefined') window.removeEventListener('storage', callback);
  };
}

function commit(value) {
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
    else sessionStorage.removeItem(KEY);
  } catch { /* see rawItem() */ }
  for (const listener of listeners) listener();
}

export function useReservation() {
  // The server snapshot is null, so the server render and the first client
  // render agree and hydration is clean — then the real value arrives without
  // a setState in an effect body.
  const reservation = useSyncExternalStore(subscribe, snapshot, () => null);

  /**
   * Holds seats or a whole table. The API refuses both at once — two prices and
   * two rules — so this mirrors that rather than trying to be clever.
   */
  /**
   * Takes a hold, in whichever of the three shapes this event sells in: named
   * seats, one whole table, or — on a general-admission event, which has no map
   * at all — a quantity of each ticket type.
   *
   * The API refuses a request carrying more than one of them, so the branch
   * below picks exactly one rather than merging what it was given.
   */
  /**
   * `replaces` (the cart, 2026-11-17): the buyer's existing hold on THIS
   * event. The selection sent is then the WHOLE new selection for the event
   * (the seat page starts from what the cart holds), and the server releases
   * the old hold and places this one in a single request. Holds on OTHER
   * events are left alone — that is the cart.
   */
  const hold = useCallback(async (slug, { seatIds, tableId, tableToken, lines }, { replaces = null } = {}) => {
    const body = {
      ...(lines ? { lines } : tableId ? { tableId } : { seatIds }),
      ...(replaces ? { replaces: replaces.reservationId } : {}),
    };
    /**
     * THE TABLE KEYS GO IN `x-table-access` — the header the seat map is read
     * with, and the one the hold reads (TECH-AUDIT-LOG S-01).
     *
     * They went in `x-access-token`, which is the RESERVATION token's header.
     * The API never looked there for a table key, so every hold of a private
     * table — whole, or a seat at it — was refused as "needs its password"
     * right after the buyer had unlocked it. Sent for seats as well as tables:
     * a seat at a private table needs the key just the same.
     */
    const sent = {
      ...(tableToken ? { [TABLE_ACCESS_HEADER]: tableToken } : {}),
      // Proof the replaced hold is this buyer's (seatMapController.hold).
      ...(replaces ? { [REPLACE_HEADER]: replaces.reservationToken } : {}),
    };
    // None at all rather than an empty set: an empty header is split by the
    // API into a bogus token (test/holdHeaders.test.jsx).
    const headers = Object.keys(sent).length ? sent : undefined;
    // WHAT IS BEING HELD, so the checkout can name it. See `heldNoun` below.
    const kind = lines ? 'general' : tableId ? 'table' : 'seats';

    // `noRedirect`, like every other call on the purchase path. `optionalAuth`
    // cannot answer 401 today, so nothing is broken — but this is the one
    // request that turns a chosen seat into a hold, and a future 401 anywhere
    // behind it would hard-navigate the buyer to /login and lose the selection
    // instead of showing them an error they can act on.
    let data;
    try {
      data = await post(`/public/events/${slug}/hold`, body, { headers, noRedirect: true });
    } catch (err) {
      // A refused replace: the server put the original hold back, under a new
      // id. The cart follows it before the refusal is shown.
      const restored = err?.meta?.restored;
      if (replaces && restored?.reservationId) addToCart({ ...restored, slug }, { replaces: replaces.reservationId });
      throw err;
    }

    /**
     * ONE HOLD PER EVENT (TECH-AUDIT-LOG T-034, kept by the cart).
     *
     * A buyer who went Back from the checkout and chose again used to keep
     * BOTH holds, the first one's seats off sale for 35 minutes with nobody
     * able to release them. Now every hold goes into the cart, and a second
     * choice for an event already in it is sent as `replaces` — the server
     * releases the old hold in the same request. Holds on OTHER events stay:
     * keeping several is what a cart is for.
     */
    addToCart({ ...data, slug }, { replaces: replaces?.reservationId || null });

    const next = {
      reservationId: data.reservationId,
      reservationToken: data.reservationToken,
      expiresAt: data.expiresAt,
      seatCount: data.seatCount,
      subtotalCents: data.subtotalCents,
      currency: data.currency,
      tableLabel: data.tableLabel || null,
      kind,
      slug,
    };
    commit(next);
    return next;
  }, []);

  /**
   * Gives the seats back.
   *
   * Local state is cleared even when the request fails. A hold we cannot
   * release is the sweeper's problem in 35 minutes; a hold we keep showing the
   * buyer is one they will try to pay for and be refused. The failure that
   * matters — a wrong token — is not one a retry fixes.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * IT NEVER THROWS, AND IT USED TO.
   *
   * The guard was `if (!(err instanceof ApiError)) throw err`, and a dropped
   * connection does not produce an `ApiError` — `apiFetch` throws `NetworkError`
   * for offline, DNS, a dead connection and its own timeout, and that class does
   * not extend `ApiError`. So exactly the failure this is most likely to meet
   * was the one it rethrew.
   *
   * Its only caller is the checkout's "Release my seats":
   *
   *     setBusy('release');
   *     await release(…);          ← threw
   *     router.push(…);            ← never ran
   *
   * an unhandled rejection inside an onClick, leaving the button disabled and
   * the buyer on the checkout with nothing on screen having changed. Which
   * contradicted the paragraph directly above: the local record IS cleared in
   * `finally`, so the caller has nothing left to fail about. It returns whether
   * the server was told, for a caller that wants to know.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const release = useCallback(async (current) => {
    const target = current || snapshot();
    if (!target?.reservationId) return false;
    try {
      await post(
        `/public/reservations/${target.reservationId}/release`,
        undefined,
        { headers: { 'x-access-token': target.reservationToken }, noRedirect: true },
      );
      return true;
    } catch {
      // Refused, or never reached. Either way the seats come back on their own.
      return false;
    } finally {
      // Only if the tab still remembers THIS hold. Releasing an older one must
      // not wipe the record of the newer hold the buyer is paying for.
      if (snapshot()?.reservationId === target.reservationId) commit(null);
    }
  }, []);

  /** Called when the clock runs out, or once a hold becomes an order. No
   *  request: the hold is already gone server-side and asking would 410. */
  const forget = useCallback(() => commit(null), []);

  /**
   * Makes a cart item the hold this tab checks out (the checkout page reads it
   * by id). From the cart's live data: the token is fresh, the deadline real.
   */
  const select = useCallback((item) => {
    const kind = item.selection?.lines ? 'general' : item.selection?.tableId ? 'table' : 'seats';
    commit({
      reservationId: item.reservationId,
      reservationToken: item.reservationToken,
      expiresAt: item.expiresAt,
      seatCount: item.ticketCount,
      subtotalCents: item.subtotalCents,
      currency: item.currency,
      tableLabel: item.lines?.find((l) => l.kind === 'table')?.label?.replace(/^Table /, '') || null,
      kind,
      slug: item.event?.slug || null,
    });
  }, []);

  return { reservation, hold, release, forget, select };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT TO CALL THE THING ON HOLD.
 *
 * The checkout was written when every event had a seat map, so it says "seats"
 * throughout: "Your seats are reserved for 14:32", "Release my seats", "The
 * seats went back on sale". General admission arrived later and has no seats,
 * no map and no seat numbers — so the one screen standing between a GA buyer
 * and their money describes something the event does not have, three times.
 * A buyer who reads carefully enough to notice is a buyer wondering whether
 * they are on the right checkout.
 *
 * Derived from the SHAPE OF THE HOLD REQUEST, which is the only place this is
 * known: the quote is a list of money and names no admission type, and adding
 * one to it would be an API change to fix a wording problem.
 *
 * `kind` is absent on a hold made before this existed and still sitting in a
 * tab's sessionStorage, so the fallback is the plural that was there — never
 * an empty string or a crash on a live checkout.
 *
 * @param {{kind?: string}|null} reservation
 * @returns {{one: string, many: string, they: string}}
 */
const NOUNS = {
  seats:   { one: 'seat',   many: 'seats',   they: 'they' },
  table:   { one: 'table',  many: 'table',   they: 'it' },
  general: { one: 'ticket', many: 'tickets', they: 'they' },
};

export function heldNoun(reservation) {
  return NOUNS[reservation?.kind] || NOUNS.seats;
}
