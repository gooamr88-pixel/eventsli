'use client';

import { useId, useMemo, useSyncExternalStore } from 'react';
import NavIcon from '../shell/NavIcon';
import { allZones, zoneLabel } from '../../lib/demoTime';

const noSubscribe = () => () => {};

/**
 * Every zone the browser knows — but only once in the browser. The server's
 * list (Node's ICU) and Safari's differ by a few zones, and rendering the full
 * list on both made the first paint disagree with the server's HTML
 * (a hydration error, seen in WebKit 2026-11-19). The server renders just the
 * chosen zone; the full list arrives right after hydration.
 */
export function useZones(value) {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  return useMemo(() => {
    if (!inBrowser) return [value];
    const list = allZones();
    return list.includes(value) ? list : [value, ...list];
  }, [inBrowser, value]);
}

/** "Time zone": every zone the browser knows, labelled with its offset now. */
export default function TimezoneSelect({ value, onChange }) {
  const id = useId();
  const zones = useZones(value);
  return (
    <div className="es-demo-tz">
      <label htmlFor={id} className="es-demo-tz__label">Time zone</label>
      <div className="es-demo-tz__box">
        <NavIcon name="globe" size={18} />
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {zones.map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}
        </select>
      </div>
    </div>
  );
}
