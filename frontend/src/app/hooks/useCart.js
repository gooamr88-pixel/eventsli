'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { post } from '../utils/apiClient';
import { useAuth } from './useAuth';
import {
  cartEntries, subscribeCart, syncCart, dropFromCart,
} from '../lib/cartStore';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The live cart, for the header's cart button and the /cart page (2026-11-17).
 *
 * ONE COPY FOR THE WHOLE PAGE. The header and the page both use this hook;
 * the server's answer is kept at module level and shared, and a refresh
 * already in flight is joined rather than repeated, so a page with both does
 * one request, not two.
 *
 * WHEN IT ASKS: on first use, whenever the device's list changes (something
 * added or removed), when the tab comes back into view, and every 30 seconds
 * while it is visible — a hold elsewhere in the account, or one that lapsed,
 * shows up without a reload. Holds the server reports gone are dropped from
 * the device; the page shows the last batch of them once (`gone`).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const EMPTY = Object.freeze({ items: [], groups: [], gone: [], count: 0, loaded: false, error: null });
let state = EMPTY;
let inflight = null;
let lastSent = null;
const listeners = new Set();

function set(next) {
  state = next;
  for (const l of listeners) l();
}

/** Asks the server what the cart holds now. Joins a request already in flight. */
export function refreshCart() {
  if (inflight) return inflight;
  const askedAt = new Date().toISOString();
  const tokens = cartEntries().map((e) => e.reservationToken);
  lastSent = tokens.join(',');
  inflight = post('/public/cart', { tokens }, { noRedirect: true, cache: 'no-store' })
    .then((data) => {
      syncCart(data.items, { askedAt });
      const purchasedOrGone = (data.gone || []).map((g) => g.reservationId);
      if (purchasedOrGone.length) dropFromCart(purchasedOrGone);
      set({
        items: data.items || [], groups: data.groups || [], gone: data.gone || [],
        count: data.count || 0, loaded: true, error: null,
      });
    })
    .catch((error) => set({ ...state, loaded: true, error }))
    .finally(() => { inflight = null; });
  return inflight;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when nothing is held on this device and the server has not answered. */
const nothingHeld = () => cartEntries().length === 0;

export function useCart() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  // A guest with nothing on this device has no cart to ask about; a signed-in
  // buyer may have one from another device.
  const { signedIn, loading: authLoading } = useAuth();
  const worthAsking = () => signedIn || !nothingHeld() || state.items.length > 0;

  useEffect(() => {
    if (authLoading) return undefined;
    // The first refresh, and one whenever the device's list changes — unless
    // the tokens sent last time are the same ones (a sync writing back fresh
    // tokens for the same holds must not loop).
    const onChange = () => {
      const now = cartEntries().map((e) => e.reservationToken).join(',');
      if (now !== lastSent) refreshCart();
    };
    if (!state.loaded && !inflight) {
      if (worthAsking()) refreshCart();
      else set({ ...EMPTY, loaded: true });
    } else if (signedIn) {
      // Just signed in: the account's holds join, and this device's are claimed.
      refreshCart();
    }
    const stop = subscribeCart(onChange);

    const onVisible = () => { if (document.visibilityState === 'visible' && worthAsking()) refreshCart(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && worthAsking()) refreshCart();
    }, 30_000);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worthAsking reads signedIn, listed below
  }, [signedIn, authLoading]);

  /** Removes one hold: its seats go back on sale, and it leaves the cart. */
  const remove = useCallback(async (item) => {
    try {
      await post(`/public/reservations/${item.reservationId}/release`, undefined, {
        headers: { 'x-access-token': item.reservationToken }, noRedirect: true,
      });
    } finally {
      // Gone either way: refused means it had already lapsed or been bought,
      // and the refresh below says which.
      dropFromCart(item.reservationId);
      set({ ...state, items: state.items.filter((i) => i.reservationId !== item.reservationId) });
      await refreshCart();
    }
  }, []);

  return { ...snapshot, refresh: refreshCart, remove };
}
