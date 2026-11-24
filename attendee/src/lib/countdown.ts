import { useEffect, useState } from 'react';

/**
 * The event page's four-cell countdown (the owner's seat-page mockup: Days ·
 * Hours · Mins · Secs). Whole units, never negative; null once it has started,
 * so the page shows "Happening now" rather than a row of zeros.
 */
export function countdownParts(ms: number): { days: number; hours: number; minutes: number; seconds: number } | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  return {
    days: Math.floor(s / 86_400),
    hours: Math.floor((s % 86_400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

/** The clock, ticking every `every` ms while the screen is mounted. */
export function useNow(every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}
