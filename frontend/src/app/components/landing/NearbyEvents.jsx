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
 *
 * ── REDESIGNED 2026-10-16, at the owner's request ─────────────────────────
 * It read as a form: a big gap, a heading, an outline button, a labelled
 * full-width select saying "No cities with events yet", and a paragraph of
 * small print. Now the controls are ONE location bar — where we are looking,
 * and the two ways to change it side by side — and the privacy line is the
 * bar's own subtitle. The homepage leaves the whole section out while no city
 * has an event (page.jsx), so a visitor is never shown controls that cannot
 * find anything.
 *
 * `initialCities` comes from the server render, so the city list is there on
 * first paint instead of a second request after it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function NearbyEvents({ initialCities = null }) {
  const [state, setState] = useState({ phase: 'offer' });
  const [canLocate, setCanLocate] = useState(true);
  const [cities, setCities] = useState(Array.isArray(initialCities) ? initialCities : []);
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
    // Only when the server did not send the list (an older page, or its fetch failed).
    if (!Array.isArray(initialCities)) {
      get('/public/cities', { noRedirect: true })
        .then((d) => { if (!cancelled) setCities(Array.isArray(d?.cities) ? d.cities : []); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [loadCity, locate, initialCities]);

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
  const title = place?.city ? `What's on in ${place.city}` : place?.here ? 'Happening near you' : "What's on near you";
  const browseHref = place?.city ? `/events?city=${encodeURIComponent(place.city)}` : '/events';

  // The bar's two lines: where we are looking, and what happens to the answer.
  const where = place?.here
    ? { main: 'Near your location', sub: 'Within 100 km, nearest first. Your location is never stored.' }
    : place?.city
      ? { main: place.city, sub: 'Remembered on this device only.' }
      : { main: 'Find events near you', sub: canLocate
        ? 'Use your location — rounded to about 100 m and never stored — or pick a city.'
        : 'Pick a city to see what is on there.' };

  return (
    <section className="es-near fx-section" aria-labelledby="near-title">
      <div className="fx-container fx-container--xl">
        <div className="es-near__head">
          <div className="fx-min0">
            <p className="es-lp-kicker">Near you</p>
            <h2 id="near-title" className="es-lp-title">{title}</h2>
          </div>
          <Link href={browseHref} className="es-lp-link es-near__all">
            See all <NavIcon name="arrow" size={16} />
          </Link>
        </div>

        <div className="es-near__bar">
          <div className="es-near__where">
            <span aria-hidden className="es-near__pin"><NavIcon name="pin" size={20} /></span>
            <div className="fx-min0">
              <p className="es-near__place">{where.main}</p>
              <p className="es-near__hint">{where.sub}</p>
            </div>
          </div>

          <div className="es-near__actions">
            {canLocate && (
              <button type="button" className="es-near__locate" onClick={locate} disabled={loading}>
                <NavIcon name="locate" size={18} />
                {place?.here ? 'Refresh location' : 'Use my location'}
              </button>
            )}
            <label className="es-near__city">
              <span className="sr-only">{canLocate ? 'Or choose a city' : 'Choose a city'}</span>
              <select
                className="es-input es-near__select"
                value={place?.city ? `${place.city}|${place.country || ''}` : ''}
                onChange={(e) => chooseCity(e.target.value)}
                disabled={loading}
              >
                <option value="">{place?.city ? 'Any city' : 'Select a city'}</option>
                {cities.map((c) => (
                  <option key={`${c.city}|${c.country}`} value={`${c.city}|${c.country}`}>
                    {c.city} ({c.events})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {state.note && <p className="es-near__note" role="status">{state.note}</p>}

        <div className="es-near__results" aria-live="polite" aria-busy={loading}>
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
                  {distanceLabel(event) && (
                    <p className="es-near__distance">
                      <NavIcon name="pin" size={14} />
                      {distanceLabel(event)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {state.phase === 'empty' && (
            <div className="es-empty es-empty--rich es-near__empty">
              <span aria-hidden className="es-empty__mark"><NavIcon name="pin" size={22} /></span>
              <p className="text-md font-medium text-ink">{state.message}</p>
              <div className="es-near__empty-actions">
                {state.nearest?.city && (
                  <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => loadCity({ city: state.nearest.city, country: state.nearest.country })}>
                    See events in {state.nearest.city}
                  </button>
                )}
                <Link href="/events" className="es-btn es-btn--secondary es-btn--sm">Browse all events</Link>
              </div>
            </div>
          )}
          {state.phase === 'error' && (
            <div className="es-empty es-empty--rich es-near__empty" role="alert">
              <span aria-hidden className="es-empty__mark"><NavIcon name="alert" size={22} /></span>
              <p className="text-md font-medium text-ink">We could not load nearby events just now.</p>
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={retry}>Try again</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
