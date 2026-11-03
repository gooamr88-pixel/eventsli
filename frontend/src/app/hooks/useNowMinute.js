'use client';

import { useSyncExternalStore } from 'react';

/**
 * "Now", to the minute, read through a store so a render stays pure (see the
 * React 19 rules in AGENTS.md). `null` on the server and during hydration —
 * callers treat that as "the clock is not known yet".
 */
const MINUTE = 60_000;
const subscribe = (onChange) => {
  const t = setInterval(onChange, MINUTE);
  return () => clearInterval(t);
};
const read = () => Math.floor(Date.now() / MINUTE) * MINUTE;
const onServer = () => null;

export function useNowMinute() {
  return useSyncExternalStore(subscribe, read, onServer);
}
