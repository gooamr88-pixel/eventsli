'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { post, ApiError } from '../utils/apiClient';

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
  const hold = useCallback(async (slug, { seatIds, tableId, tableToken, lines }) => {
    const body = lines ? { lines } : tableId ? { tableId } : { seatIds };
    const headers = tableToken ? { 'x-access-token': tableToken } : undefined;

    const data = await post(`/public/events/${slug}/hold`, body, { headers });

    const next = {
      reservationId: data.reservationId,
      reservationToken: data.reservationToken,
      expiresAt: data.expiresAt,
      seatCount: data.seatCount,
      subtotalCents: data.subtotalCents,
      currency: data.currency,
      tableLabel: data.tableLabel || null,
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
   */
  const release = useCallback(async (current) => {
    const target = current || snapshot();
    if (!target?.reservationId) return;
    try {
      await post(
        `/public/reservations/${target.reservationId}/release`,
        undefined,
        { headers: { 'x-access-token': target.reservationToken }, noRedirect: true },
      );
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    } finally {
      commit(null);
    }
  }, []);

  /** Called when the clock runs out, or once a hold becomes an order. No
   *  request: the hold is already gone server-side and asking would 410. */
  const forget = useCallback(() => commit(null), []);

  return { reservation, hold, release, forget };
}
