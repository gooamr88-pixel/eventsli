'use client';

import { useId, useState } from 'react';
import NavIcon from '../shell/NavIcon';
import NearMeDialog from './NearMeDialog';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero's search: what, where and when.
 *
 * STILL A PLAIN GET FORM. `action="/events"` with named inputs means the
 * browser builds `?q=…&from=…` itself and navigates, so this works with
 * JavaScript disabled, works before hydration, and produces a URL somebody can
 * share. Everything else is added on top of that, never in place of it.
 *
 * THE LOCATION SEGMENT OPENS A DIALOG rather than calling the browser's
 * geolocation prompt directly. The whole flow — why we are asking, what happens
 * to the coordinates, and what to say when the nearest event is four hundred
 * kilometres away — lives in `NearMeDialog`. See the note at the top of that
 * file for why the order matters: a browser permission refusal is permanent,
 * so the explanation has to come before the prompt.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function HeroSearch() {
  const id = useId();
  const [when, setWhen] = useState('');
  const [nearOpen, setNearOpen] = useState(false);

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
          onClick={() => setNearOpen(true)}
          className="es-searchbar__field es-searchbar__field--action"
          aria-haspopup="dialog"
        >
          <span aria-hidden className="es-searchbar__icon"><NavIcon name="locate" size={18} /></span>
          <span className="es-searchbar__value es-searchbar__value--empty">Near me</span>
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
          {/*
            AN EMPTY `type="date"` SHOWS NOTHING on Android Chrome — no
            placeholder, no format hint, just an icon and a blank segment,
            which is what "the date box does not show anything" was. A date
            input ignores `placeholder` by spec, so the label is a real
            element behind it and the input is transparent until it has a
            value.
          */}
          <span className="es-searchbar__date">
            {!when && <span aria-hidden className="es-searchbar__value--empty">Any date</span>}
            <input
              id={`${id}-from`}
              name="from"
              type="date"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={`es-searchbar__input es-searchbar__input--date ${when ? '' : 'es-searchbar__input--blank'}`}
            />
          </span>
        </div>

        <button type="submit" className="es-searchbar__submit">
          <span aria-hidden><NavIcon name="arrow" size={18} /></span>
          <span className="sr-only">Search</span>
        </button>
      </form>

      <NearMeDialog open={nearOpen} onClose={() => setNearOpen(false)} />
    </div>
  );
}
