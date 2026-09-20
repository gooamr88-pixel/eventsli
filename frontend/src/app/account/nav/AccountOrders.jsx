'use client';

import { createContext, useContext } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS BUYER'S ORDERS, FETCHED ONCE FOR THE WHOLE SHELL.
 *
 * The same arrangement `OrganizerEvents` makes, for the same reason. Four things
 * in the buyer workspace want `GET /tickets`:
 *
 *   the sidebar     a count for the "My tickets" badge
 *   the dashboard   the next event, the tiles, the recent orders
 *   My tickets      the tickets themselves
 *   Orders          the same payload read as receipts
 *
 * Fetched per screen that would be a request on every navigation inside the
 * workspace, three of them returning bytes another component on the same page
 * already had — and, worse, a sidebar badge that can disagree with the list
 * beside it because the two reads happened a second apart.
 *
 * `loadedAt` TRAVELS WITH THE DATA, and it is not a detail. Every derived figure
 * splits upcoming from past against an instant, and `lib/buyerOrders.js` argues
 * why that instant must be captured rather than read from the clock inside a
 * memo. Captured once, here, beside the payload it describes — so the badge, the
 * dashboard's "next event" and the tickets list all split on the same moment and
 * cannot land one event in two different groups.
 *
 * THE ERROR IS CARRIED, NOT SWALLOWED, as it is for the organizer's list. A
 * sidebar badge that cannot be computed simply does not render; a screen whose
 * whole job is to show the tickets has to say that it could not. Both facts
 * travel and each reader decides which it needs.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const AccountOrdersContext = createContext(null);

export const AccountOrdersProvider = AccountOrdersContext.Provider;

/**
 * `{ orders, loadedAt, error, loading, reload }` — `orders` is null until the
 * first answer arrives, and `ready` distinguishes that from an empty list.
 *
 * Outside the account layout (a test rendering one screen on its own) there is
 * no provider, and the caller gets a permanent "still loading" rather than a
 * crash — which is what `useOrganizerEvents` does and for the same reason.
 */
export function useAccountOrders() {
  const value = useContext(AccountOrdersContext);
  const orders = value?.orders ?? null;
  const error = value?.error ?? null;

  return {
    orders,
    /** The instant `orders` was fetched. Pass it to `splitOrders`. */
    loadedAt: value?.loadedAt ?? 0,
    error,
    loading: orders === null && !error,
    reload: value?.reload,
  };
}
