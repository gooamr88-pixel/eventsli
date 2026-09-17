'use client';

import { useState } from 'react';
import NavIcon from '../components/shell/NavIcon';

/**
 * The /events search panel: what, where, when.
 *
 * STILL A PLAIN GET FORM, so a filtered listing is a URL: shareable, walked by
 * the back button, and rendered on the server. The only reason this is a
 * client component is the date field — an empty `type="date"` shows nothing at
 * all on Android Chrome and ignores `placeholder` by spec, so "Any date" is a
 * real label behind a transparent input until there is a value.
 *
 * Empty fields are left out of the URL rather than sent as `?city=`, which the
 * page would read as a filter for nothing.
 */
export default function EventsSearch({ q, city, from, category }) {
  const [what, setWhat] = useState(q);
  const [where, setWhere] = useState(city);
  const [when, setWhen] = useState(from);

  return (
    <form action="/events" method="get" role="search" className="es-ev-search">
      {category && <input type="hidden" name="category" value={category} />}

      <label className="es-ev-search__field es-ev-search__field--q" htmlFor="ev-q">
        <span aria-hidden className="es-ev-search__icon"><NavIcon name="search" size={19} /></span>
        <span className="sr-only">Event, artist or venue</span>
        <input
          id="ev-q"
          type="search"
          name={what ? 'q' : undefined}
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="Event, artist or venue"
          autoComplete="off"
          className="es-ev-search__input"
        />
      </label>

      <label className="es-ev-search__field" htmlFor="ev-city">
        <span aria-hidden className="es-ev-search__icon"><NavIcon name="pin" size={18} /></span>
        <span className="sr-only">City</span>
        <input
          id="ev-city"
          type="text"
          name={where ? 'city' : undefined}
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="Any city"
          autoComplete="address-level2"
          className="es-ev-search__input"
        />
      </label>

      <label className="es-ev-search__field" htmlFor="ev-from">
        <span aria-hidden className="es-ev-search__icon"><NavIcon name="calendar" size={18} /></span>
        <span className="sr-only">On or after</span>
        <span className="es-ev-search__date">
          {!when && <span aria-hidden className="es-ev-search__hint">Any date</span>}
          <input
            id="ev-from"
            type="date"
            name={when ? 'from' : undefined}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className={`es-ev-search__input es-ev-search__input--date ${when ? '' : 'is-blank'}`}
          />
        </span>
      </label>

      <button type="submit" className="es-ev-search__submit">
        <NavIcon name="search" size={18} />
        Search
      </button>
    </form>
  );
}
