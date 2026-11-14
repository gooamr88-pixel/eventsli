import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { logout as logoutCall } from '../api/endpoints';
import type { DoorToken, User } from '../api/types';
import { useOfflineList } from '../gate/offlineList';
import { useScanLog } from '../gate/scanLog';
import { queryClient } from '../lib/queryClient';

/**
 * Who this phone is signed in as, and which door it is working.
 *
 *   account — the person (from a password or "Sign in with Eventsli"). Picks
 *             events. Absent on a shared PIN tablet.
 *   door    — the event this phone is scanning, as which device. Every scan,
 *             count and guest-list call uses this token.
 *
 * Both live in the Keychain / Keystore only, readable only while the phone is
 * unlocked and never copied to another device by a backup.
 */

const SECURE = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const ACCOUNT_KEY = 'eventsli.account';
const DOOR_KEY = 'eventsli.door';

export type Account = { token: string; expiresAt: string; user: User };
export type Door = {
  token: string;
  eventId: string;
  deviceId: string;
  label: string;
  kind: 'staff' | 'pin';
  eventTitle: string | null;
};

type State = {
  hydrated: boolean;
  account: Account | null;
  door: Door | null;
  hydrate: () => Promise<void>;
  setAccount: (a: Account | null) => Promise<void>;
  setDoor: (d: DoorToken, kind: 'staff' | 'pin') => Promise<void>;
  /** Leave this event; the account (if any) stays signed in. */
  leaveDoor: () => Promise<void>;
  /** Everything: revoke on the server, forget on the phone. */
  signOut: () => Promise<void>;
};

async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key, SECURE);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown) {
  if (value === null) await SecureStore.deleteItemAsync(key, SECURE);
  else await SecureStore.setItemAsync(key, JSON.stringify(value), SECURE);
}

const expired = (a: Account | null) => !a || Date.parse(a.expiresAt) <= Date.now();

export const useSession = create<State>((set, get) => ({
  hydrated: false,
  account: null,
  door: null,

  async hydrate() {
    const [account, door] = await Promise.all([read<Account>(ACCOUNT_KEY), read<Door>(DOOR_KEY)]);
    // A session past its expiry is gone on the server too; do not pretend.
    set({ account: expired(account) ? null : account, door, hydrated: true });
    if (account && expired(account)) await write(ACCOUNT_KEY, null);
  },

  async setAccount(account) {
    await write(ACCOUNT_KEY, account);
    set({ account });
  },

  async setDoor(d, kind) {
    const door: Door = {
      token: d.token,
      eventId: d.device.eventId,
      deviceId: d.device.id,
      label: d.device.label,
      kind,
      eventTitle: d.event?.title ?? null,
    };
    await write(DOOR_KEY, door);
    set({ door });
  },

  async leaveDoor() {
    await write(DOOR_KEY, null);
    await forgetGuestList();
    set({ door: null });
  },

  async signOut() {
    const { account } = get();
    // Best effort: a phone with no signal must still be able to sign out. The
    // session then simply expires on the server, or is ended from the web.
    if (account) logoutCall(account.token).catch(() => undefined);
    await Promise.all([write(ACCOUNT_KEY, null), write(DOOR_KEY, null)]);
    await forgetGuestList();
    set({ account: null, door: null });
  },
}));

/**
 * The event's ticket list (offline admission) is guest data: it leaves with
 * the door, whatever the reason — switching event, signing out, or the server
 * closing the door (a 401 goes through leaveDoor). Held scans are NOT touched:
 * they are admissions waiting to upload, and they upload after the next sign-in.
 * A failed delete is not a reason to keep someone signed in; the list is also
 * never used for another event, and is deleted 24 h after its own.
 */
async function forgetGuestList() {
  // What is in memory goes too: the guest list, search results, counts and the
  // log on screen were fetched with the door's token and are not the next
  // person's to see. (Held scans stay on disk, as above.)
  queryClient.clear();
  useScanLog.getState().clear();
  try {
    await useOfflineList.getState().wipeAll();
  } catch {
    // See above.
  }
}
