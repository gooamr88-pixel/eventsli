import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { EventCard } from '../api/types';

/**
 * RECENTLY VIEWED — the last few event pages opened on this phone, for
 * Home's "Recently Viewed" row. Kept on the phone only (it is nobody else's
 * business), at most six, and only the fields a card draws, so it stays
 * under the 2 KB a SecureStore value should hold.
 */
const KEY = 'eventsli.app.recent';
const MAX = 6;

export type RecentEvent = Pick<EventCard, 'id' | 'slug' | 'title' | 'coverUrl' | 'startsAt' | 'timezone' | 'venue' | 'city'>;

type State = {
  items: RecentEvent[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (e: EventCard) => void;
  clear: () => void;
};

/** The compact copy of a card that is remembered. */
export function compact(e: EventCard): RecentEvent {
  return { id: e.id, slug: e.slug, title: e.title, coverUrl: e.coverUrl, startsAt: e.startsAt, timezone: e.timezone, venue: e.venue, city: e.city };
}

/** A remembered event as a card again, for the posters that draw it. */
export function asCard(r: RecentEvent): EventCard {
  return {
    ...r, comingSoon: false, venueAddress: null, endsAt: null, isPast: Date.parse(r.startsAt) < Date.now() - 6 * 3_600_000,
    category: null, categoryLabel: null, displayOnly: false, organizer: null, fromPriceCents: null, availability: null,
  };
}

/** `e` first, without a duplicate, at most MAX. */
export function withRecent(items: RecentEvent[], e: EventCard): RecentEvent[] {
  return [compact(e), ...items.filter((x) => x.id !== e.id)].slice(0, MAX);
}

export const useRecent = create<State>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    if (get().loaded) return;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      set({ items: raw ? (JSON.parse(raw) as RecentEvent[]).slice(0, MAX) : [], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  add(e) {
    if (e.isPrivate) return; // a private event is not shown on Home
    const items = withRecent(get().items, e);
    set({ items });
    SecureStore.setItemAsync(KEY, JSON.stringify(items)).catch(() => undefined);
  },
  clear() {
    set({ items: [] });
    SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  },
}));
