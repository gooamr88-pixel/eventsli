'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import EventCard from '../EventCard';
import NavIcon from '../shell/NavIcon';
import { get } from '../../utils/apiClient';
import {
  NEARBY_LIMIT, NEARBY_RADIUS_KM, distanceLabel, emptyMessage, readSavedCity, roundCoords,
  saveCity, startMode,
} from './nearbyModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Near you" — nearby events by default, on the homepage.
 *
 *   · Location already allowed for this site → the nearest published events,
 *     found quietly, nearest first, each with how far away it is.
 *   · Not yet allowed → a button that asks, plus a city list. Nothing asks on
 *     page load (see nearbyModel.startMode for why).
 *   · Refused, unavailable, insecure, or failed → the city list, which always
 *     works, and a retry where retrying could help.
 *
 * PRIVACY: coordinates are rounded to about 110 m in the browser, sent once to
 * the Eventsli API, used for one answer and never stored (landingController
 * eventsNear). A chosen city is remembered in this browser only.
 *
 * The page never waits on this: it renders its own placeholder and loads after.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function NearbyEvents() {
  const [state, setState] = useState({ phase: 'offer' });
  const [canLocate, setCanLocate] = useState(true);
  const [cities, setCities] = useState([]);
  const [place, setPlace] = useState(null);       // { here: true } | { city, country }
  const lastAttempt = useRef(null);

  const loadCity = useCallback(async (choice) => {
    lastAttempt.current = { via: 'city', choice };
    setPlace(choice);
    saveCity(choice);
    setState({ phase: 'loading' });
    try {
      // `country` only when known: the API wants two letters or nothing.
      const country = choice.country ? `&country=${encodeURIComponent(choice.country)}` : '';
      const rows = await get(
        `/public/events?city=${encodeURIComponent(choice.city)}${country}&limit=${NEARBY_LIMIT}`,
        { noRedirect: true },
      );
      setState(Array.isArray(rows) && rows.length
        ? { phase: 'results', events: rows }
        : { phase: 'empty', message: `Nothing is on in ${choice.city} just yet.` });
    } catch {
      setState({ phase: 'error' });
    }
  }, []);

  const locate = useCallback(() => {
    lastAttempt.current = { via: 'location' };
    setState({ phase: 'loading' });
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { lat, lng } = roundCoords(position.coords);
      try {
        const data = await get(
          `/public/events/near?lat=${lat}&lng=${lng}&radiusKm=${NEARBY_RADIUS_KM}&limit=${NEARBY_LIMIT}`,
          { noRedirect: true },
        );
        setPlace({ here: true });
        saveCity(null);
        setState(data?.events?.length
          ? { phase: 'results', events: data.events }
          : { phase: 'empty', message: emptyMessage(data), nearest: data?.nearest || null });
      } catch {
        setState({ phase: 'error' });
      }
    }, (err) => {
      // 1 = PERMISSION_DENIED: say so once and fall back to the city list.
      if (err?.code === 1) {
        setCanLocate(false);
        setState({ phase: 'manual', note: 'Location is turned off for this site. Choose a city instead.' });
      } else {
        setState({ phase: 'error' });
      }
    }, { maximumAge: 10 * 60 * 1000, timeout: 15000 });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = 'geolocation' in navigator;
      const secure = window.isSecureContext;
      let permission = 'unknown';
      try {
        permission = (await navigator.permissions?.query({ name: 'geolocation' }))?.state || 'unknown';
      } catch { /* no Permissions API: treat as "would have to ask" */ }
      if (cancelled) return;
      setCanLocate(supported && secure && permission !== 'denied');
      const saved = readSavedCity();
      const mode = startMode({ supported, secure, permission, savedCity: saved });
      if (mode === 'city') loadCity(saved);
      else if (mode === 'locate') locate();
      else setState({ phase: mode });
    })();
    get('/public/cities', { noRedirect: true })
      .then((d) => { if (!cancelled) setCities(Array.isArray(d?.cities) ? d.cities : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [loadCity, locate]);

  function retry() {
    const last = lastAttempt.current;
    if (last?.via === 'city') loadCity(last.choice);
    else if (canLocate) locate();
    else setState({ phase: 'manual' });
  }

  function chooseCity(value) {
    if (!value) { saveCity(null); setPlace(null); setState({ phase: canLocate ? 'offer' : 'manual' }); return; }
    const [city, country] = value.split('|');
    loadCity({ city, country });
  }

  const loading = state.phase === 'loading';
  const title = place?.city ? `What's on in ${place.city}` : place?.here ? 'On near you' : "What's on near you";
  const browseHref = place?.city ? `/events?city=${encodeURIComponent(place.city)}` : '/events';

  return (
    <section className="es-band fx-section es-near" aria-labelledby="near-title">
      <div className="fx-container fx-container--xl">
        <div className="es-lp-head">
          <div>
            <p className="es-lp-kicker">Near you</p>
            <h2 id="near-title" className="es-lp-title">{title}</h2>
          </div>
          <Link href={browseHref} className="es-lp-link">
            Browse all events <NavIcon name="arrow" size={16} />
          </Link>
        </div>

        <div className="es-near__controls">
          {canLocate && (
            <button type="button" className="es-btn es-btn--secondary" onClick={locate} disabled={loading}>
              <NavIcon name="pin" size={18} /> {place?.here ? 'Refresh my location' : 'Use my location'}
            </button>
          )}
          <label className="es-near__city">
            <span className="text-sm text-muted">{canLocate ? 'Or choose a city' : 'Choose a city'}</span>
            <select
              className="es-input"
              value={place?.city ? `${place.city}|${place.country || ''}` : ''}
              onChange={(e) => chooseCity(e.target.value)}
              disabled={loading}
            >
              <option value="">{cities.length ? 'Any city' : 'No cities with events yet'}</option>
              {cities.map((c) => (
                <option key={`${c.city}|${c.country}`} value={`${c.city}|${c.country}`}>
                  {c.city} ({c.events})
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="es-near__privacy text-xs text-subtle">
          Your location is rounded to about 100&nbsp;m, used once for this search and never stored. A city you choose is remembered on this device only.
        </p>
        {state.note && <p className="text-sm text-muted" role="status">{state.note}</p>}

        <div aria-live="polite" aria-busy={loading}>
          {loading && (
            <ul className="es-lp-cards" aria-label="Finding events near you">
              {[0, 1, 2].map((n) => <li key={n} className="es-skeleton es-lp-cards__ghost" />)}
            </ul>
          )}
          {state.phase === 'results' && (
            <ul className="es-lp-cards es-lp-rail">
              {state.events.map((event) => (
                <li key={event.id} className="es-near__item">
                  <EventCard event={event} />
                  {distanceLabel(event) && <p className="es-near__distance text-sm text-muted">{distanceLabel(event)}</p>}
                </li>
              ))}
            </ul>
          )}
          {state.phase === 'empty' && (
            <div className="es-empty">
              <p className="text-md font-medium text-ink">{state.message}</p>
              {state.nearest?.city && (
                <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => loadCity({ city: state.nearest.city, country: state.nearest.country })}>
                  See events in {state.nearest.city}
                </button>
              )}
            </div>
          )}
          {state.phase === 'error' && (
            <div className="es-empty" role="alert">
              <p className="text-md font-medium text-ink">We could not load nearby events just now.</p>
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={retry}>Try again</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
