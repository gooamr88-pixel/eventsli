import { create } from 'zustand';

import { release } from '../api/endpoints';
import type { Hold } from '../api/types';

/**
 * The hold being paid for — in memory only.
 *
 * The reservation token is a credential (it spends the hold), and a hold
 * lives 35 minutes, so there is nothing to gain from writing it to disk and a
 * leak to lose. An app killed mid-checkout simply lets the hold expire; the
 * seats go back on sale by themselves (the scheduler's expire-reservations).
 */
type Current = Hold & { slug: string; eventTitle: string };

type State = {
  current: Current | null;
  /** The checkout session started for it, to read the result after Stripe. */
  sessionId: string | null;
  start: (h: Current) => void;
  setSession: (id: string) => void;
  /** Gives the seats back now rather than at expiry. Best effort. */
  abandon: () => void;
  clear: () => void;
};

export const useReservation = create<State>((set, get) => ({
  current: null,
  sessionId: null,
  start: (current) => {
    const previous = get().current;
    // Holding new seats while an old hold runs would take stock off sale for
    // nobody; release the old one first.
    if (previous && previous.reservationId !== current.reservationId) {
      release(previous.reservationId, previous.reservationToken).catch(() => undefined);
    }
    set({ current, sessionId: null });
  },
  setSession: (sessionId) => set({ sessionId }),
  abandon: () => {
    const { current } = get();
    if (current) release(current.reservationId, current.reservationToken).catch(() => undefined);
    set({ current: null, sessionId: null });
  },
  clear: () => set({ current: null, sessionId: null }),
}));
