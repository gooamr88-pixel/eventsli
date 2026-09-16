'use client';

import { useId, useState } from 'react';
import NavIcon from '../shell/NavIcon';
import NearMeDialog from './NearMeDialog';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero's filter bar: what kind, where and when, then the blue button.
 *
 * STILL A PLAIN GET FORM. `action="/events"` with named inputs means the
 * browser builds `?category=…&from=…` itself and navigates, so this works with
 * JavaScript disabled, works before hydration, and produces a URL somebody can
 * share. /events already validates both parameters.
 *
 * THE LOCATION SEGMENT OPENS A DIALOG rather than being a city picker. The
 * brief was that a visitor should not type their own address; the whole flow
 * — why we ask, what happens to the coordinates — lives in `NearMeDialog`. It
 * is `type="button"`, because inside a form a bare <button> submits.
 *
 * THE DATE IS NATIVE. An empty `type="date"` shows nothing at all on Android
 * Chrome and ignores `placeholder` by spec, so the "Any date" label is a real
 * element behind a transparent input until there is a value.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function HeroSearch({ categories = [] }) {
  const id = useId();
  const [category, setCategory] = useState('');
  const [when, setWhen] = useState('');
  const [nearOpen, setNearOpen] = useState(false);

  return (
    <>
      <form action="/events" method="get" role="search" className="es-lp-filter">
        <label className="es-lp-filter__field" htmlFor={`${id}-cat`}>
          <span aria-hidden className="es-lp-filter__icon"><NavIcon name="tag" size={17} /></span>
          <span className="sr-only">Event type</span>
          <select
            id={`${id}-cat`}
            // Omitted from the URL when empty, rather than sending `category=`,
            // which /events would read as a filter for nothing.
            name={category ? 'category' : undefined}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="es-lp-filter__control"
          >
            <option value="">Event type</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.label}</option>
            ))}
          </select>
          <span aria-hidden className="es-lp-filter__chev" />
        </label>

        <button
          type="button"
          onClick={() => setNearOpen(true)}
          className="es-lp-filter__field"
          aria-haspopup="dialog"
        >
          <span aria-hidden className="es-lp-filter__icon"><NavIcon name="pin" size={17} /></span>
          <span className="es-lp-filter__control">Near me</span>
        </button>

        <label className="es-lp-filter__field" htmlFor={`${id}-from`}>
          <span aria-hidden className="es-lp-filter__icon"><NavIcon name="calendar" size={17} /></span>
          <span className="sr-only">On or after</span>
          <span className="es-lp-filter__date">
            {!when && <span aria-hidden className="es-lp-filter__control">Any date</span>}
            <input
              id={`${id}-from`}
              name={when ? 'from' : undefined}
              type="date"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={`es-lp-filter__control es-lp-filter__control--date ${when ? '' : 'es-lp-filter__control--blank'}`}
            />
          </span>
          <span aria-hidden className="es-lp-filter__chev" />
        </label>

        {/* aria-label, because the visible word is display:none on a phone
            and a hidden label names nothing. */}
        <button type="submit" className="es-lp-filter__submit" aria-label="Search events">
          <NavIcon name="search" size={20} />
          <span aria-hidden className="es-lp-filter__submit-label">Search</span>
        </button>
      </form>

      <NearMeDialog open={nearOpen} onClose={() => setNearOpen(false)} />
    </>
  );
}
