'use client';

import { useEffect, useId, useRef, useState } from 'react';
import NavIcon from '../shell/NavIcon';
import NearMeDialog from './NearMeDialog';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero's search bar: what, where and when, then the teal button.
 *
 * REBUILT 2026-10-17 to the owner's mockup — "Search events · Location · Any
 * date · Search" in one white bar on a desktop, three stacked rows beside a
 * round arrow button on a phone. The event-type select it replaced is not in
 * the mockup; the categories are still one scroll away in the search band.
 *
 * STILL A PLAIN GET FORM. `action="/events"` with named inputs means the
 * browser builds `?q=…&from=…` itself and navigates, so this works with
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
export default function HeroSearch() {
  const id = useId();
  const [q, setQ] = useState('');
  const [when, setWhen] = useState('');
  const [nearOpen, setNearOpen] = useState(false);

  const formRef = useRef(null);
  /**
   * Set by the date control the moment it is CHANGED, and read by the effect
   * after React has committed that change to the DOM.
   *
   * The timing is why this is a ref and an effect rather than a `submit()`
   * inside `onChange`: the input's `name` is conditional, so at the instant
   * the handler runs it still has NO name, and submitting there would drop
   * the chosen date. By effect time the attribute is on the element.
   */
  const autoSubmit = useRef(false);

  /**
   * CHOOSING A DATE IS THE SEARCH — "changed" and "finished choosing" are the
   * same moment for a date. The text box is deliberately NOT auto-submitted:
   * somebody typing has not finished until they press Enter or the button.
   */
  useEffect(() => {
    if (!autoSubmit.current) return;
    autoSubmit.current = false;
    formRef.current?.requestSubmit();
  }, [when]);

  return (
    <>
      <form ref={formRef} action="/events" method="get" role="search" className="es-lp-filter">
        <div className="es-lp-filter__fields">
          <label className="es-lp-filter__field" htmlFor={`${id}-q`}>
            <span aria-hidden className="es-lp-filter__icon"><NavIcon name="search" size={19} /></span>
            <span className="sr-only">Search events</span>
            <input
              id={`${id}-q`}
              // Omitted from the URL when empty, rather than sending `q=`.
              name={q.trim() ? 'q' : undefined}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search events"
              autoComplete="off"
              enterKeyHint="search"
              maxLength={100}
              className="es-lp-filter__control"
            />
          </label>

          <button
            type="button"
            onClick={() => setNearOpen(true)}
            className="es-lp-filter__field"
            aria-haspopup="dialog"
          >
            <span aria-hidden className="es-lp-filter__icon"><NavIcon name="pin" size={19} /></span>
            <span className="es-lp-filter__control">Location</span>
          </button>

          <label className="es-lp-filter__field" htmlFor={`${id}-from`}>
            <span aria-hidden className="es-lp-filter__icon"><NavIcon name="calendar" size={19} /></span>
            <span className="sr-only">On or after</span>
            <span className="es-lp-filter__date">
              {!when && <span aria-hidden className="es-lp-filter__control">Any date</span>}
              <input
                id={`${id}-from`}
                name={when ? 'from' : undefined}
                type="date"
                value={when}
                onChange={(e) => { autoSubmit.current = true; setWhen(e.target.value); }}
                className={`es-lp-filter__control es-lp-filter__control--date ${when ? '' : 'es-lp-filter__control--blank'}`}
              />
            </span>
          </label>
        </div>

        {/* The word on a desktop, a round arrow on a phone — the aria-label
            names it either way. */}
        <button type="submit" className="es-lp-filter__submit" aria-label="Search events">
          <span aria-hidden className="es-lp-filter__submit-label">Search</span>
          <span aria-hidden className="es-lp-filter__submit-icon"><NavIcon name="arrow" size={20} /></span>
        </button>
      </form>

      <NearMeDialog open={nearOpen} onClose={() => setNearOpen(false)} />
    </>
  );
}
