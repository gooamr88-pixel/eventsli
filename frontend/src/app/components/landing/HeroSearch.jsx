'use client';

import { useId } from 'react';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero's search: what, where, when.
 *
 * A PLAIN GET FORM, and that is the whole design. `action="/events"` with named
 * inputs means the browser builds `?q=…&city=…&from=…` itself and navigates —
 * so this works with JavaScript disabled, before hydration, and the result is a
 * URL somebody can share or bookmark. `/events` already reads all three
 * parameters; nothing new was needed on the listing to make this work.
 *
 * WHY IT IS A CLIENT COMPONENT AT ALL. Only for `useId`. The labels are visually
 * hidden and have to point at their inputs, and two of these could appear on one
 * page. There is no state, no effect, and no handler — the file carries
 * `'use client'` so the hook is legal, not because anything here is
 * interactive.
 *
 * THE CITY FIELD IS A DATALIST, NOT A SELECT.
 * A <select> can only offer what we know about, and the honest set is "cities
 * that have a published event" — which on a young platform is very short. A
 * datalist suggests those and still accepts anything typed, so somebody looking
 * for a city we have nothing in gets an empty listing that says so, rather than
 * a picker that silently cannot express what they wanted.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function HeroSearch({ cities = [] }) {
  const id = useId();

  return (
    <form action="/events" method="get" role="search" className="es-searchbar">
      <div className="es-searchbar__field es-searchbar__field--wide">
        <span aria-hidden className="es-searchbar__icon"><NavIcon name="search" size={18} /></span>
        <label htmlFor={`${id}-q`} className="sr-only">Search events, artists or venues</label>
        <input
          id={`${id}-q`}
          name="q"
          type="search"
          autoComplete="off"
          placeholder="Search events, artists, venues"
          className="es-searchbar__input"
        />
      </div>

      <div className="es-searchbar__field">
        <span aria-hidden className="es-searchbar__icon"><NavIcon name="pin" size={18} /></span>
        <label htmlFor={`${id}-city`} className="sr-only">City</label>
        <input
          id={`${id}-city`}
          name="city"
          type="text"
          autoComplete="off"
          list={cities.length ? `${id}-cities` : undefined}
          placeholder="Anywhere"
          className="es-searchbar__input"
        />
        {cities.length > 0 && (
          <datalist id={`${id}-cities`}>
            {cities.map((city) => (
              <option key={`${city.city}-${city.country}`} value={city.city}>
                {`${city.city}, ${city.country} — ${city.events} event${city.events === 1 ? '' : 's'}`}
              </option>
            ))}
          </datalist>
        )}
      </div>

      <div className="es-searchbar__field">
        <span aria-hidden className="es-searchbar__icon"><NavIcon name="calendar" size={18} /></span>
        <label htmlFor={`${id}-from`} className="sr-only">On or after</label>
        {/*
          `type="date"` rather than a hand-built calendar. The native control is
          localised, keyboard-operable and works with a screen reader on every
          platform, and the alternative is several hundred lines that will be
          worse at all three. It submits `yyyy-mm-dd`, which is exactly what
          /events validates `from` as.
        */}
        <input
          id={`${id}-from`}
          name="from"
          type="date"
          className="es-searchbar__input"
        />
      </div>

      <button type="submit" className="es-btn es-btn--primary es-searchbar__submit">
        <span aria-hidden className="md:hidden">Search</span>
        <span aria-hidden className="hidden md:inline"><NavIcon name="arrow" size={18} /></span>
        <span className="sr-only">Search</span>
      </button>
    </form>
  );
}
