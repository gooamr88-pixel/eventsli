'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { get } from '../../utils/apiClient';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero's search: what, when, and — by one tap — where.
 *
 * STILL A PLAIN GET FORM. `action="/events"` with named inputs means the
 * browser builds `?q=…&city=…&from=…` itself and navigates, so this works with
 * JavaScript disabled, works before hydration, and produces a URL somebody can
 * share. Everything below is added ON TOP of that, never in place of it.
 *
 * ── The city field became a button ─────────────────────────────────────────
 * It was a text input with a datalist: the visitor typed where they were. That
 * is the wrong way round — the browser already knows, and asking someone to
 * spell their own city to be shown what is near them is work the software
 * should be doing.
 *
 * So: one control that asks for location and resolves it to the nearest city
 * that actually has events on. The coordinates go to our own API and nowhere
 * else, are compared against a table we ship, and are never stored — see
 * `backend/utils/cityCoordinates.js` for why there is no geocoder in the path.
 *
 * ── Why permission is only ever asked on a TAP ─────────────────────────────
 * `getCurrentPosition` is never called on mount. A location prompt that appears
 * because a page loaded is the most disliked interaction on the web, and a
 * refusal is remembered by the browser — so an unprompted ask does not annoy
 * somebody once, it permanently disables the feature for them.
 *
 * ── Every failure gets its own sentence ────────────────────────────────────
 * Denied, unavailable, timed out, nothing on sale anywhere, and "we have events
 * but cannot place them on a map" are five different situations. Collapsing
 * them into "something went wrong" is how a working feature reads as broken.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function HeroSearch() {
  const id = useId();
  const router = useRouter();
  const [city, setCity] = useState('');
  const [state, setState] = useState('idle');   // idle | locating | done | error
  const [message, setMessage] = useState(null);

  function findNearby() {
    if (!('geolocation' in navigator)) {
      setState('error');
      setMessage('This browser cannot share a location. Search by name instead.');
      return;
    }

    setState('locating');
    setMessage(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          /* Three decimal places — about 110 metres.
             Full precision is several metres, which is a person's building.
             The question being asked is "which city", and a city is not
             resolved any better by knowing the street. */
          const lat = latitude.toFixed(3);
          const lng = longitude.toFixed(3);

          const result = await get(`/public/cities/nearest?lat=${lat}&lng=${lng}`);

          if (result?.city) {
            setCity(result.city);
            setState('done');
            setMessage(
              result.distanceKm <= 60
                ? `Showing events in ${result.city}.`
                : `Nearest events are in ${result.city}, about ${result.distanceKm} km away.`,
            );
            // Go straight there. Somebody who pressed "near me" asked a
            // question; they did not ask for a field to be filled in.
            router.push(`/events?city=${encodeURIComponent(result.city)}`);
            return;
          }

          setState('error');
          setMessage(
            result?.reason === 'none'
              ? 'Nothing is on sale anywhere just yet. Check back soon.'
              : 'We could not match your area to a city with events on. Try searching by name.',
          );
        } catch {
          setState('error');
          setMessage('We could not look that up just now. Try again in a moment.');
        }
      },
      (error) => {
        setState('error');
        setMessage(
          error.code === error.PERMISSION_DENIED
            ? 'Location is switched off for this site. Search by city name instead.'
            : error.code === error.TIMEOUT
              ? 'That took too long. Try again, or search by city name.'
              : 'Your location is not available. Search by city name instead.',
        );
      },
      // 10s, and a cached fix up to 5 minutes old is fine: a person has not
      // changed city in that time, and reusing it avoids waking the GPS.
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  const locating = state === 'locating';

  return (
    <div className="fx-stack fx-stack--sm">
      <form action="/events" method="get" role="search" className="es-searchbar">
        <div className="es-searchbar__field">
          <span aria-hidden className="es-searchbar__icon"><NavIcon name="search" size={18} /></span>
          <label htmlFor={`${id}-q`} className="sr-only">Search events, artists or venues</label>
          <input
            id={`${id}-q`}
            name="q"
            type="search"
            autoComplete="off"
            placeholder="Search for events, artists, or venues"
            className="es-searchbar__input"
          />
        </div>

        {/*
          THE LOCATION SEGMENT IS A BUTTON, not an input.

          The design puts a city picker here and the brief was explicit that a
          visitor should not have to type their own address. So the segment
          keeps the picker's shape and does the work instead: one tap asks the
          browser for a position and resolves it to the nearest city that has
          events on.

          It is `type="button"` — inside a form, a bare <button> submits, which
          would navigate away the instant somebody asked for their location.
        */}
        <button
          type="button"
          onClick={findNearby}
          disabled={locating}
          className="es-searchbar__field es-searchbar__field--action"
          aria-describedby={message ? `${id}-locate-msg` : undefined}
        >
          <span aria-hidden className={`es-searchbar__icon ${locating ? 'es-searchbar__icon--busy' : ''}`}>
            <NavIcon name={city ? 'pin' : 'locate'} size={18} />
          </span>
          <span className={`es-searchbar__value ${city ? '' : 'es-searchbar__value--empty'}`}>
            {locating ? 'Finding you…' : (city || 'Near me')}
          </span>
        </button>

        <div className="es-searchbar__field es-searchbar__field--short">
          <span aria-hidden className="es-searchbar__icon"><NavIcon name="calendar" size={18} /></span>
          <label htmlFor={`${id}-from`} className="sr-only">On or after</label>
          {/*
            `type="date"`, not a hand-built calendar. The native control is
            localised, keyboard-operable and works with a screen reader on
            every platform; the alternative is several hundred lines that will
            be worse at all three. It submits `yyyy-mm-dd`, which is what
            /events validates `from` as.
          */}
          <input id={`${id}-from`} name="from" type="date" className="es-searchbar__input" />
        </div>

        {/* The resolved city travels with the form, so pressing Search after
            using the location segment keeps it. */}
        <input type="hidden" name="city" value={city} />

        <button type="submit" className="es-searchbar__submit">
          <span aria-hidden><NavIcon name="arrow" size={18} /></span>
          <span className="sr-only">Search</span>
        </button>
      </form>

      {message && (
        /* `role="status"` rather than `alert`: this is the result of something
           the reader asked for, and an assertive live region interrupts
           whatever a screen reader was already saying. */
        <p id={`${id}-locate-msg`} role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
