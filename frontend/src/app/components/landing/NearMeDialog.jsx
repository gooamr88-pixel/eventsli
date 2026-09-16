'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { get } from '../../utils/apiClient';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Events near me", as a conversation rather than a browser prompt.
 *
 * ── WHY THERE IS A DIALOG AT ALL ───────────────────────────────────────────
 * Pressing the button used to call `getCurrentPosition` directly, which hands
 * the visitor straight to the browser's own permission prompt — a grey bar that
 * says "eventsli.com wants to know your location" and offers Allow or Block,
 * with no explanation of why or what happens to it.
 *
 * That is the wrong order, and it is expensive to get wrong: a refusal is
 * REMEMBERED BY THE BROWSER. Someone who blocks because they were asked out of
 * nowhere has not declined once, they have disabled the feature permanently,
 * and no amount of explaining afterwards can re-open the prompt. So the
 * explanation comes first, in our own words, in a dialog they can dismiss with
 * no consequence at all — and the browser is only asked once somebody has said
 * yes to us.
 *
 * ── WHAT IT PROMISES, AND WHY EACH PROMISE IS TRUE ─────────────────────────
 *   "It is not shared with anyone"      the coordinates go to the Eventsli API
 *                                       and nowhere else. There is no geocoder
 *                                       in the path — see cityCoordinates.js.
 *   "It is not stored"                  the endpoint holds them for the length
 *                                       of one function and writes nothing.
 *   "Rounded to about a kilometre"      three decimal places leave the street
 *                                       out of it, and the question is which
 *                                       city, which a street does not refine.
 *
 * ── THE ANSWER IS NEVER JUST "NOTHING" ─────────────────────────────────────
 * The interesting failure is a young platform with events four hundred
 * kilometres away. "No events near you" is true and useless; "nothing within
 * 100km — the nearest are in Toronto, 420km away" is the same fact with
 * somewhere to go. `/public/events/near` returns the closest place whether or
 * not it is inside the radius, precisely so this can be said.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** How far out "near you" reaches before it stops being near. */
const RADIUS_KM = 100;

/* The mount gate, as an external store. Hoisted to module scope so the three
   functions are stable identities and the hook never re-subscribes. */
const NO_SUBSCRIBE = () => () => {};
const ON_CLIENT = () => true;
const ON_SERVER = () => false;

export default function NearMeDialog({ open, onClose }) {
  const id = useId();
  /**
   * RENDERED INTO <body>, NOT WHERE IT IS WRITTEN.
   *
   * The dialog is used from the hero, which is `.es-band--photo` — a scope
   * that inverts every text role to white for the photograph behind it. A
   * modal rendered inside it inherits that and comes out white-on-white, which
   * is exactly what shipped once. The panel names its own roles as well, but
   * the portal is the structural fix: a modal is a sibling of the page, not a
   * descendant of whatever opened it.
   *
   * It also removes the stacking-context risk. A `position: fixed` element is
   * positioned against the viewport UNLESS an ancestor has a transform, filter
   * or containment — any of which would silently anchor this to a hero section
   * instead of the screen.
   *
   * `mounted` gates it because `document` does not exist during the server
   * render; without it the first client render would not match the server's.
   *
   * `useSyncExternalStore` rather than a `useState` + `useEffect` mount flag:
   * the flag version calls setState inside an effect, which produces a render
   * React immediately discards and which `react-hooks/set-state-in-effect`
   * refuses. The subscribe function never fires because the answer never
   * changes after mount — the two snapshots ARE the whole hook here: `false`
   * on the server, `true` on the client.
   */
  const mounted = useSyncExternalStore(NO_SUBSCRIBE, ON_CLIENT, ON_SERVER);
  const panel = useRef(null);
  const closeRef = useRef(null);
  const [phase, setPhase] = useState('ask');   // ask | locating | result | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  /** Every close path funnels here so the state resets — a dialog reopened on
   *  its old result is a dialog showing yesterday's answer. */
  const close = useCallback(() => {
    onClose();
    setPhase('ask');
    setResult(null);
    setError(null);
  }, [onClose]);

  // Escape, and focus into the panel when it opens. A dialog that does not take
  // focus leaves the keyboard behind on the page underneath it.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  /**
   * The page behind a modal must not scroll under it.
   *
   * The scrollbar's width is compensated, because removing it without that
   * shifts the whole page sideways by ~15px on a desktop — which on a hero
   * with a full-bleed photograph is a visible jump at the moment the dialog
   * appears.
   */
  useEffect(() => {
    if (!open) return undefined;
    const { body } = document;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const prev = { overflow: body.style.overflow, pad: body.style.paddingInlineEnd };
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingInlineEnd = `${gap}px`;
    return () => { body.style.overflow = prev.overflow; body.style.paddingInlineEnd = prev.pad; };
  }, [open]);

  function locate() {
    if (!('geolocation' in navigator)) {
      setPhase('error');
      setError('This browser cannot share a location.');
      return;
    }
    /**
     * Geolocation is refused outright on an insecure origin — every browser
     * treats it as a powerful feature. Over plain http the call fails instantly
     * with PERMISSION_DENIED and shows no prompt, which from the outside is a
     * button that does nothing. `isSecureContext` is the browser's own answer,
     * and it is true on https and on localhost.
     */
    if (!window.isSecureContext) {
      setPhase('error');
      setError('Finding you needs a secure (https) connection. You can still search by city name.');
      return;
    }

    setPhase('locating');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          // Three decimals — about 110 metres. Full precision is a building,
          // and "which city" is not answered any better by knowing the street.
          const lat = position.coords.latitude.toFixed(3);
          const lng = position.coords.longitude.toFixed(3);
          const data = await get(`/public/events/near?lat=${lat}&lng=${lng}&radiusKm=${RADIUS_KM}`);
          setResult(data);
          setPhase('result');
        } catch {
          setPhase('error');
          setError('We could not look that up just now. Please try again in a moment.');
        }
      },
      (err) => {
        setPhase('error');
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location is switched off for this site. You can turn it back on in your browser settings, or search by city name.'
            : err.code === err.TIMEOUT
              ? 'That took longer than expected. Try again, or search by city name.'
              : 'Your location is not available right now. You can search by city name instead.',
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="es-modal"
      // A click on the backdrop closes; a click inside the panel must not.
      // Checking the target rather than stopping propagation in the panel keeps
      // the panel free of a handler that would swallow real clicks.
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="es-modal__panel"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          className="es-modal__close"
          aria-label="Close"
        >
          <span aria-hidden><NavIcon name="close" size={18} /></span>
        </button>

        {phase === 'ask' && <Ask id={id} onAllow={locate} onClose={close} />}
        {phase === 'locating' && <Locating id={id} />}
        {phase === 'result' && <Result id={id} data={result} onClose={close} />}
        {phase === 'error' && <Failed id={id} message={error} onRetry={() => setPhase('ask')} onClose={close} />}
      </div>
    </div>,
    document.body,
  );
}

// ─── The primer ─────────────────────────────────────────────────────────────
function Ask({ id, onAllow, onClose }) {
  return (
    <>
      <span aria-hidden className="es-modal__mark"><NavIcon name="locate" size={26} /></span>
      <h2 id={`${id}-title`} className="es-modal__title">Find events near you</h2>
      <p className="es-modal__lede">
        Eventsli can use your location to show what is on closest to you first.
      </p>

      <ul className="es-modal__points">
        {[
          ['shield', 'It is never shared', 'Your location goes to Eventsli and nowhere else. No maps provider, no advertiser, no third party.'],
          ['clock', 'It is never stored', 'We use it to work out the nearest city and then forget it. Nothing is written down.'],
          ['pin', 'City-level only', 'Rounded to about a kilometre — enough to find your city, not your street.'],
        ].map(([icon, title, body]) => (
          <li key={title} className="es-modal__point">
            <span aria-hidden className="es-modal__point-mark"><NavIcon name={icon} size={16} /></span>
            <span>
              <span className="es-modal__point-title">{title}</span>
              <span className="es-modal__point-body">{body}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="es-modal__actions">
        <button type="button" onClick={onAllow} className="es-btn es-btn--primary">
          Use my location
        </button>
        <button type="button" onClick={onClose} className="es-btn es-btn--ghost">
          Not now
        </button>
      </div>

      <p className="es-modal__foot">
        Your browser will ask you to confirm. You can change your mind at any time.
      </p>
    </>
  );
}

// ─── Waiting ────────────────────────────────────────────────────────────────
function Locating({ id }) {
  return (
    <>
      <span aria-hidden className="es-modal__mark es-modal__mark--busy"><NavIcon name="locate" size={26} /></span>
      <h2 id={`${id}-title`} className="es-modal__title">Finding you…</h2>
      {/* The prompt is the browser's and it can sit there indefinitely, so the
          copy says what is being waited for rather than implying a network
          delay we control. */}
      <p className="es-modal__lede">
        Your browser is asking for permission. Choose <strong>Allow</strong> to carry on.
      </p>
    </>
  );
}

// ─── The answer ─────────────────────────────────────────────────────────────
function Result({ id, data, onClose }) {
  const within = data?.within || [];
  const nearest = data?.nearest || null;
  const radius = data?.radiusKm || RADIUS_KM;

  // Nothing anywhere: no city on the platform has an event on. Honest, and the
  // normal state of a young platform.
  if (!nearest) {
    return (
      <>
        <span aria-hidden className="es-modal__mark"><NavIcon name="calendar" size={26} /></span>
        <h2 id={`${id}-title`} className="es-modal__title">Nothing on sale yet</h2>
        <p className="es-modal__lede">
          There are no published events anywhere on Eventsli right now. New ones are
          reviewed and published every week.
        </p>
        <div className="es-modal__actions">
          <Link href="/events" className="es-btn es-btn--primary" onClick={onClose}>
            Browse anyway
          </Link>
          <Link href="/register" className="es-btn es-btn--ghost" onClick={onClose}>
            Put something on
          </Link>
        </div>
      </>
    );
  }

  // Something close.
  if (within.length > 0) {
    const total = within.reduce((sum, place) => sum + place.events, 0);
    const top = within[0];
    return (
      <>
        <span aria-hidden className="es-modal__mark"><NavIcon name="check" size={26} /></span>
        <h2 id={`${id}-title`} className="es-modal__title">
          {`${total} event${total === 1 ? '' : 's'} near you`}
        </h2>
        <p className="es-modal__lede">
          {`The closest are in ${top.city}, about ${top.distanceKm} km away.`}
        </p>

        <ul className="es-modal__places">
          {within.slice(0, 4).map((place) => (
            <li key={`${place.city}-${place.country}`}>
              <Link
                href={`/events?city=${encodeURIComponent(place.city)}`}
                className="es-modal__place"
                onClick={onClose}
              >
                <span aria-hidden className="es-modal__place-mark"><NavIcon name="pin" size={16} /></span>
                <span className="fx-min0">
                  <span className="es-modal__place-city">{place.city}</span>
                  <span className="es-modal__place-note">
                    {`${place.events} event${place.events === 1 ? '' : 's'} · ${place.distanceKm} km`}
                  </span>
                </span>
                <span aria-hidden className="es-modal__place-go"><NavIcon name="arrow" size={16} /></span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="es-modal__actions">
          <Link
            href={`/events?city=${encodeURIComponent(top.city)}`}
            className="es-btn es-btn--primary"
            onClick={onClose}
          >
            {`Show events in ${top.city}`}
          </Link>
        </div>
      </>
    );
  }

  // Nothing close, but something SOMEWHERE — the case the whole endpoint shape
  // exists for. Saying only "nothing near you" here would be true and useless.
  return (
    <>
      <span aria-hidden className="es-modal__mark"><NavIcon name="pin" size={26} /></span>
      <h2 id={`${id}-title`} className="es-modal__title">
        {`Nothing within ${radius} km`}
      </h2>
      <p className="es-modal__lede">
        {`The nearest events are in ${nearest.city}, about ${nearest.distanceKm} km away — `}
        {`${nearest.events} on sale there now.`}
      </p>

      <div className="es-modal__actions">
        <Link
          href={`/events?city=${encodeURIComponent(nearest.city)}`}
          className="es-btn es-btn--primary"
          onClick={onClose}
        >
          {`Show events in ${nearest.city}`}
        </Link>
        <Link href="/events" className="es-btn es-btn--ghost" onClick={onClose}>
          Browse everything
        </Link>
      </div>

      {data.unmapped > 0 && (
        /* Honest about a partial answer. Some organizers type a city this
           build holds no coordinates for, and those events cannot be measured
           — saying so beats quietly leaving them out. */
        <p className="es-modal__foot">
          {`${data.unmapped} other ${data.unmapped === 1 ? 'city has' : 'cities have'} events we could not place on a map. Browse everything to see them.`}
        </p>
      )}
    </>
  );
}

// ─── When it does not work ──────────────────────────────────────────────────
function Failed({ id, message, onRetry, onClose }) {
  return (
    <>
      <span aria-hidden className="es-modal__mark es-modal__mark--muted"><NavIcon name="info" size={26} /></span>
      <h2 id={`${id}-title`} className="es-modal__title">We could not find you</h2>
      <p className="es-modal__lede">{message}</p>

      {/* A way forward, not just an apology. The city field on /events is the
          same filter the location would have set. */}
      <div className="es-modal__actions">
        <Link href="/events" className="es-btn es-btn--primary" onClick={onClose}>
          Search by city
        </Link>
        <button type="button" onClick={onRetry} className="es-btn es-btn--ghost">
          Try again
        </button>
      </div>
    </>
  );
}
