import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { eventsNear } from '../api/endpoints';
import { approximatePosition, locationStatus, positionIfAllowed, type Position } from '../lib/location';

const REFRESH_MS = 10 * 60_000;

/**
 * Events near the phone, for Home's "Near You".
 *
 *   granted  the position is read (no prompt) when Home opens and again when
 *            the app comes back to the front after ten minutes, so the row
 *            follows the person from one part of town to another;
 *   ask      nothing is read until they tap "Turn on location";
 *   denied   only the phone's Settings can change it, and the row says so.
 */
export function useNearMe() {
  const [status, setStatus] = useState<'checking' | 'granted' | 'ask' | 'denied'>('checking');
  const [pos, setPos] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);
  const readAt = useRef(0);

  useEffect(() => {
    let alive = true;
    // Everything set here is set when the phone answers, never synchronously.
    const read = () => locationStatus().then((s) => {
      if (!alive) return undefined;
      setStatus(s);
      return s === 'granted' ? positionIfAllowed() : null;
    }).then((p) => {
      if (alive && p) { readAt.current = Date.now(); setPos(p); }
    });
    void read();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - readAt.current > REFRESH_MS) void read();
    });
    return () => { alive = false; sub.remove(); };
  }, []);

  /** The person tapped "Turn on location": the system prompt, then the events. */
  const enable = useCallback(async () => {
    setBusy(true);
    const p = await approximatePosition();
    setBusy(false);
    if (p === 'denied') { setStatus('denied'); return; }
    if (p) { readAt.current = Date.now(); setStatus('granted'); setPos(p); }
  }, []);

  const near = useQuery({
    queryKey: ['events', 'near', pos?.lat, pos?.lng],
    enabled: Boolean(pos),
    queryFn: () => eventsNear(pos!.lat, pos!.lng),
    staleTime: REFRESH_MS,
  });

  return { status, pos, busy, enable, near };
}
