'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import EventCard from '../EventCard';
import CardRail from './CardRail';
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

  /**
   * REDESIGNED 2026-11-18 (owner: "very terrible in mobile mode — also laptop").
   * The location bar and its dropdown became ONE row of chips — Near me, then
   * the busiest cities with their counts — that swipes on a phone and wraps on
   * a laptop; the rest of the cities sit in a small "More cities" menu. The
   * results are a compact horizontal strip at every size, so this band stays
   * short and does not repeat the Popular grid under it.
   */
  const TOP = 8;
  const ranked = [...cities].sort((a, b) => (b.events || 0) - (a.events || 0));
  // The chosen city FIRST, right after Near me, so its chip is always in view
  // on a phone — at the end of a swipe row it was off screen (2026-11-18).
  const chosen = place?.city ? ranked.find((c) => c.city === place.city && (c.country || '') === (place.country || '')) : null;
  const top = [...(chosen ? [chosen] : []), ...ranked.filter((c) => c !== chosen).slice(0, chosen ? TOP - 1 : TOP)];
  const more = ranked.filter((c) => !top.includes(c));
  // For an empty city: the busiest other city, as a one-tap way on.
  const suggestion = ranked.find((c) => c !== chosen && c.city !== state.nearest?.city) || null;
  const count = state.phase === 'results' ? state.events.length : 0;
  const isActive = (c) => place?.city === c.city && (place.country || '') === (c.country || '');

  const prompting = state.phase === 'offer' || state.phase === 'manual';
  // One quiet line under the chips: what happens to the answer.
  const hint = place?.here
    ? 'Within 100 km, nearest first. Your location is rounded to about 100 m and never stored.'
    : place?.city
      ? `Showing ${place.city}. Remembered on this device only.`
      : canLocate
        ? 'Tap Near me — your location is rounded to about 100 m and never stored — or pick a city.'
        : 'Pick a city to see what is on there.';

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

        <div className="es-near__picker" role="group" aria-label="Where to look for events">
          {canLocate && (
            <button
              type="button"
              className="es-near__chip es-near__chip--here"
              aria-pressed={place?.here ? 'true' : 'false'}
              onClick={locate}
              disabled={loading}
            >
              <NavIcon name="locate" size={16} />
              {place?.here ? 'Near me · refresh' : 'Near me'}
            </button>
          )}
          {top.map((c) => (
            <button
              key={`${c.city}|${c.country}`}
              type="button"
              className="es-near__chip"
              aria-pressed={isActive(c) ? 'true' : 'false'}
              onClick={() => (isActive(c) ? chooseCity('') : chooseCity(`${c.city}|${c.country || ''}`))}
              disabled={loading}
            >
              {c.city}
              {c.events ? <span className="es-near__count">{c.events}</span> : null}
            </button>
          ))}
          {more.length > 0 && (
            <label className="es-near__more">
              <span className="sr-only">More cities</span>
              <select
                value=""
                onChange={(e) => chooseCity(e.target.value)}
                disabled={loading}
              >
                <option value="">More cities</option>
                {more.map((c) => (
                  <option key={`${c.city}|${c.country}`} value={`${c.city}|${c.country || ''}`}>
                    {c.city} ({c.events})
                  </option>
                ))}
              </select>
              <NavIcon name="chevronDown" size={14} />
            </label>
          )}
        </div>
        {/* Not under the prompt, which says the same thing. */}
        {(state.note || !prompting) && <p className="es-near__hint">{state.note || hint}</p>}

        <div className="es-near__results" aria-live="polite" aria-busy={loading}>
          {loading && (
            <ul className="es-near__ghosts" aria-label="Finding events near you">
              {[0, 1, 2, 3].map((n) => <li key={n} className="es-skeleton" />)}
            </ul>
          )}
          {prompting && (
            <div className="es-near__prompt">
              <span aria-hidden className="es-near__prompt-mark"><NavIcon name="pin" size={20} /></span>
              <p>
                <b>See what&apos;s on around you.</b>{' '}
                {canLocate
                  ? 'Tap Near me — your location is rounded to about 100 m and never stored — or choose a city.'
                  : 'Choose a city above.'}
              </p>
            </div>
          )}
          {state.phase === 'results' && (
            /* One or two events fill the width on a phone instead of leaving a
               lone narrow card; a single one is laid out as a row (2026-11-18). */
            <CardRail label="Nearby events" className={`es-near__rail es-near__rail--n${Math.min(count, 3)}`}>
              {state.events.map((event) => (
                <li key={event.id} className="es-near__item">
                  <EventCard event={event} adaptive={count === 1} />
                  {distanceLabel(event) && (
                    <p className="es-near__distance">
                      <NavIcon name="pin" size={14} />
                      {distanceLabel(event)}
                    </p>
                  )}
                </li>
              ))}
            </CardRail>
          )}
          {state.phase === 'empty' && (
            /* Compact, like the prompt: what happened, and one tap to somewhere
               with events (2026-11-18 — the big centred box looked broken). */
            <div className="es-near__none">
              <span aria-hidden className="es-near__prompt-mark"><NavIcon name="pin" size={20} /></span>
              <div className="fx-min0">
                <p className="es-near__none-title">{state.message}</p>
                <p className="es-near__none-sub">New events are added every week. Meanwhile:</p>
                <div className="es-near__none-actions">
                  {state.nearest?.city && (
                    <button type="button" className="es-near__chip" onClick={() => loadCity({ city: state.nearest.city, country: state.nearest.country })}>
                      See events in {state.nearest.city}
                    </button>
                  )}
                  {suggestion && (
                    <button type="button" className="es-near__chip" onClick={() => loadCity({ city: suggestion.city, country: suggestion.country })}>
                      Try {suggestion.city}
                      {suggestion.events ? <span className="es-near__count">{suggestion.events}</span> : null}
                    </button>
                  )}
                  <Link href="/events" className="es-near__chip">Browse all events</Link>
                </div>
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
