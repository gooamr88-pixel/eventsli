import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { Alert } from 'react-native';

import { onAuthLost } from '../api/client';
import { renderDemoSession } from '../dev/renderDemo';
import { logout as logoutCall, removePushDevice } from '../api/endpoints';
import type { AppSession } from '../api/types';
import { queryClient } from '../lib/queryClient';
import { clearTickets, loadTickets } from '../lib/ticketCache';

/**
 * Who this phone is signed in as, and the few preferences that must survive a
 * restart.
 *
 *   account   the session (token + user), from /auth/app/login. The token
 *             lives in the Keychain / Keystore only, readable only while the
 *             phone is unlocked and never copied to another device by a backup.
 *   pushToken the Expo push token this install registered for the account, so
 *             signing out can unregister it — otherwise the next person to
 *             sign in on a shared phone would get the last one's tickets on
 *             the lock screen until Expo reported the token dead.
 *   city      the city the Home screen is browsing ("Cairo ▾").
 *   onboarded the welcome screen has been seen.
 *
 * Browsing never needs an account. Saving, the inbox and My Tickets do, and
 * checkout works either way (the API takes a guest's name and email).
 */

const SECURE = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const KEYS = {
  account: 'eventsli.app.account',
  pushToken: 'eventsli.app.pushToken',
  city: 'eventsli.app.city',
  onboarded: 'eventsli.app.onboarded',
} as const;

export type Account = AppSession;
export type CityChoice = { city: string; country: string } | null;

type State = {
  hydrated: boolean;
  account: Account | null;
  pushToken: string | null;
  city: CityChoice;
  onboarded: boolean;
  hydrate: () => Promise<void>;
  signIn: (a: Account) => Promise<void>;
  setPushToken: (t: string | null) => Promise<void>;
  setCity: (c: CityChoice) => Promise<void>;
  finishOnboarding: () => Promise<void>;
  /**
   * Revoke on the server (best effort), unregister the phone, forget
   * everything personal. `remote: false` when the server already ended the
   * session: there is nothing left to revoke, and calling would 401 again.
   */
  signOut: (opts?: { remote?: boolean }) => Promise<void>;
};

let signingOut = false;

async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key, SECURE);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) await SecureStore.deleteItemAsync(key, SECURE);
    else await SecureStore.setItemAsync(key, JSON.stringify(value), SECURE);
  } catch {
    // A preference that could not be stored is re-asked next launch; never a crash.
  }
}

const expired = (a: Account | null) => !a || Date.parse(a.expiresAt) <= Date.now();

export const useSession = create<State>((set, get) => ({
  hydrated: false,
  account: null,
  pushToken: null,
  city: null,
  onboarded: false,

  async hydrate() {
    const [account, pushToken, city, onboarded] = await Promise.all([
      read<Account>(KEYS.account),
      read<string>(KEYS.pushToken),
      read<NonNullable<CityChoice>>(KEYS.city),
      read<boolean>(KEYS.onboarded),
    ]);
    // A session past its expiry is gone on the server too; do not pretend.
    const live = expired(account) ? null : account;
    if (account && !live) await Promise.all([write(KEYS.account, null), clearTickets()]);
    // My Tickets from the last time it loaded, so the codes open with no
    // signal (lib/ticketCache.ts). Marked with when it was saved, so the query
    // still refreshes it as soon as there is a connection.
    if (live) {
      const saved = await loadTickets(live.user.id);
      if (saved && !queryClient.getQueryData(['tickets'])) {
        queryClient.setQueryData(['tickets'], saved.orders, { updatedAt: saved.savedAt });
      }
    }
    // A development web render stands in for the Keychain (dev/renderDemo.ts).
    const demo = renderDemoSession();
    set({ account: live, pushToken, city, onboarded: onboarded === true, ...demo, hydrated: true });
  },

  async signIn(account) {
    await write(KEYS.account, account);
    await write(KEYS.onboarded, true);
    set({ account, onboarded: true });
  },

  async setPushToken(pushToken) {
    await write(KEYS.pushToken, pushToken);
    set({ pushToken });
  },

  async setCity(city) {
    await write(KEYS.city, city);
    set({ city });
  },

  async finishOnboarding() {
    await write(KEYS.onboarded, true);
    set({ onboarded: true });
  },

  async signOut({ remote = true } = {}) {
    if (signingOut) return;
    signingOut = true;
    try {
      const { account, pushToken } = get();
      if (account && remote) {
        // Best effort, in this order: the phone stops receiving this account's
        // pushes, then the session ends. A phone with no signal must still be
        // able to sign out; the session then expires, or is ended from the web.
        if (pushToken) await removePushDevice(account.token, pushToken).catch(() => undefined);
        logoutCall(account.token).catch(() => undefined);
      }
      await Promise.all([write(KEYS.account, null), write(KEYS.pushToken, null), clearTickets()]);
      // Tickets, saved events and the inbox were fetched with that session and
      // are not the next person's to see.
      queryClient.clear();
      set({ account: null, pushToken: null });
    } finally {
      signingOut = false;
    }
  },
}));

/**
 * THE SERVER ENDED THE SESSION (2026-11-27). Expiry used to be checked only
 * at launch, so a session revoked from the web, or one that ran out while the
 * app was open, left the phone looking signed in with every personal screen
 * failing. A 401 on a request that carried the CURRENT session now signs the
 * phone out; one carrying an older token (a request that left before a new
 * sign-in) is ignored.
 */
onAuthLost((token) => {
  const { account } = useSession.getState();
  if (!account || account.token !== token || signingOut) return;
  void useSession.getState().signOut({ remote: false }).then(() => {
    Alert.alert('You were signed out', 'Your session ended. Sign in again to see your tickets.');
  });
});

/** The session token, or null — for queries that are personal. */
export const useToken = () => useSession((s) => s.account?.token ?? null);
