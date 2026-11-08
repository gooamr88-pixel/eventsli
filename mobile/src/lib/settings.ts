import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

/** The door's preferences on this phone. Not secret; kept beside the session for simplicity. */
export type Settings = {
  sound: boolean;
  haptics: boolean;
  /** After an admission, go back to the camera on its own after a moment. */
  autoContinue: boolean;
};

const KEY = 'eventsli.settings';
const DEFAULTS: Settings = { sound: true, haptics: true, autoContinue: true };

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
    const next = { sound: get().sound, haptics: get().haptics, autoContinue: get().autoContinue, ...patch };
    set(next);
    await SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => undefined);
  },
}));
