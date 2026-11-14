import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

/** The door's preferences on this phone. Not secret; kept beside the session for simplicity. */
export type Settings = {
  sound: boolean;
  haptics: boolean;
  /** After an admission, go back to the camera on its own after a moment. */
  autoContinue: boolean;
  /**
   * Offline check-in on this phone (the dashboard's Offline Mode): keep the
   * event's ticket list here and decide with no signal. Off, the list is
   * deleted and scans with no signal are held, as before Phase 3. The
   * organizer can still switch it off for the whole event.
   */
  offlineMode: boolean;
};

const KEY = 'eventsli.settings';
const DEFAULTS: Settings = { sound: true, haptics: true, autoContinue: true, offlineMode: true };

type State = Settings & {
  load: () => Promise<void>;
  set: (patch: Partial<Settings>) => Promise<void>;
};

export const useSettings = create<State>((set, get) => ({
  ...DEFAULTS,
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) set({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch {
      // Defaults are fine.
    }
  },
  async set(patch) {
    const next = { sound: get().sound, haptics: get().haptics, autoContinue: get().autoContinue, offlineMode: get().offlineMode, ...patch };
    set(next);
    await SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => undefined);
  },
}));
