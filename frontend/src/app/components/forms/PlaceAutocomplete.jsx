'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { get } from '../../utils/apiClient';
import NavIcon from '../shell/NavIcon';
import { FieldLabel } from './Field';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENUE SEARCH — type three characters, pick a place, get all five fields.
 *
 * WHAT THIS REPLACES. A plain text box. The organizer typed the venue name, then
 * the address, then the city, and then — on a different screen, after the event
 * existed — was told to "right-click the venue in Google Maps and copy the two
 * numbers" into a latitude and a longitude field. Four of those five values
 * disagreed with each other regularly, and `events.city` is what "events near
 * me" filters on, so a typo there made the event invisible to the one search
 * most likely to find it.
 *
 * Choosing a suggestion writes the name, the address, the city, the coordinates
 * and the place id at once, from one source that agrees with itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS STILL A TEXT INPUT, and that is the most important property here.
 *
 * Not a picker that demands a selection. An organizer booking a school gym, a
 * field, a marquee or a venue Google has never heard of types the name and
 * moves on, exactly as before — `onChange` fires on every keystroke and the
 * parent's state is the input's value, suggestion or no suggestion.
 *
 * The same is true when venue search is switched off. `GOOGLE_PLACES_API_KEY`
 * is optional; without it the API answers `PLACES_DISABLED`, this component
 * records that once and stops asking for the rest of the page's life, and what
 * is left is the ordinary field. Nothing is disabled, nothing errors, and there
 * is no empty dropdown — the difference is invisible to somebody who never had
 * suggestions to begin with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A COMBOBOX, BUILT ON NATIVE SEMANTICS AND NOT ON GOOGLE'S WIDGET.
 *
 * `PlaceAutocompleteElement` is a custom element that draws its own dropdown in
 * its own styles, needs the Maps JS bundle, and needs `script-src` and
 * `connect-src` opened to Google on every page of the site to serve one field on
 * one screen. This renders our own list from our own API — see
 * `backend/services/placesService.js` for why the request is proxied — so it
 * inherits the design system, the focus ring and the touch targets, and the CSP
 * does not move.
 *
 * The ARIA is the WAI-ARIA 1.2 combobox pattern, which is one of the cases where
 * roles are genuinely required: there is no native element that is "a text input
 * that owns a list of suggestions". `aria-activedescendant` keeps real focus in
 * the input while the highlight moves, which is what lets someone keep typing
 * after arrowing into the list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Below this, every query returns half the country and costs the same. */
const MIN_CHARS = 3;

/**
 * Long enough that a typed word is one request, short enough to feel live.
 *
 * At 250ms a venue name typed at a normal speed produces two or three requests
 * rather than one per character — which is the difference between a session
 * that costs one autocomplete and one that costs fifteen.
 */
const DEBOUNCE_MS = 250;

/** "No suggestions, for nothing in particular" — where this field starts.
 *  `query: null` rather than `''` so it can never equal a real field value, and
 *  at module scope so every render with nothing to show hands back the SAME
 *  empty array rather than a new identity. */
const EMPTY_RESULT = Object.freeze({ query: null, items: Object.freeze([]) });

/**
 * ONE FLAG FOR THE WHOLE PAGE LOAD, deliberately at module scope.
 *
 * When the deployment has no Places key, every instance of this component would
 * otherwise discover that separately, and discover it again on every debounce.
 * The answer cannot change without a redeploy, so it is remembered once. It is
 * NOT persisted: a module variable dies with the page, so turning the key on
 * needs a reload and not a cache purge.
 */
let placesDisabled = false;

/**
 * A billing session: every keystroke's suggestions plus the one details call
 * that resolves the chosen place.
 *
 * Google groups requests sharing a token and bills the group once. The token has
 * to live from the first keystroke to the selection and then be REPLACED —
 * reusing it afterwards silently merges the next search into the previous
 * session, which is both wrong and, eventually, free in a way Google notices.
 *
 * `randomUUID` is unavailable on http origins in some browsers, so there is a
 * fallback: a missing token costs money, it does not break anything.
 */
function newSession() {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * @param {object}   props
 * @param {string}   props.value        the venue name, owned by the parent
 * @param {Function} props.onChange     every keystroke — this is a text input
 * @param {Function} props.onPlace      a suggestion was chosen: `{ placeId,
 *                                      name, address, city, lat, lng }`
 * @param {string}   [props.country]    two-letter code, biases results only
 * @param {string}   [props.label]
 * @param {string}   [props.hint]
 * @param {string}   [props.error]
 */
export default function PlaceAutocomplete({
  value,
  onChange,
  onPlace,
  country,
  label = 'Venue name',
  hint,
  error,
  name = 'venueName',
  placeholder = 'Search for a venue, or type it yourself',
  maxLength = 200,
  required = false,
  optional = false,
}) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const statusId = `${id}-status`;

  /**
   * THE SUGGESTIONS, AND THE QUERY THEY ANSWER — stored as one fact.
   *
   * This was a bare `items` array that the effect below cleared whenever the
   * field dropped under `MIN_CHARS` — three `setState` calls in an effect body,
   * which `react-hooks/set-state-in-effect` refuses and was failing the lint.
   * Correctly: that is a render React paints and throws away, and for one frame
   * the old query's list hung under a field somebody had just emptied. Keeping
   * the query beside its results makes the clearing unnecessary rather than
   * moving it — "may this list show" is now answered during the render below.
   *
   * It also fixes a quieter bug: deleting a venue to one character and typing a
   * different one put the field back over `MIN_CHARS` with the OLD results in
   * state, so the previous venue's suggestions reappeared under the new text
   * for the length of the debounce. A stale `query` cannot equal the live one.
   */
  const [result, setResult] = useState(EMPTY_RESULT);
  /** What the list WOULD do given something fresh to show. Escape and a tap
   *  outside lower this directly; `open` below is it and the results agreeing. */
  const [openState, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busyState, setBusy] = useState(false);
  /**
   * WHETHER THIS FIELD CAN ACTUALLY SEARCH — which decides what it PROMISES.
   *
   * `placesDisabled` is a module flag and changing it re-renders nothing, so the
   * hint under the field went on saying "start typing and pick your venue — the
   * address, city and map pin fill themselves in" on a deployment with no
   * Places key. That is a promise the field cannot keep, under an input that
   * behaves like a plain text box, and it is worse than saying nothing: the
   * organizer waits for a list that is never coming and concludes the form is
   * broken.
   *
   * Seeded from the module flag so a second instance on the same page starts
   * out already knowing, and lowered the moment the API answers
   * `PLACES_DISABLED`. Optimistic until then, because a deployment WITH a key
   * is the configured case and a hint that only appears after the first search
   * helps nobody.
   */
  const [searchLive, setSearchLive] = useState(!placesDisabled);

  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const session = useRef(null);
  /**
   * The text this component itself just wrote into the field.
   *
   * Choosing a suggestion calls `onChange` with the place's name, which comes
   * straight back in as a new `value` — and the search effect cannot tell that
   * from typing. Without this it would immediately search for the name it just
   * filled in and reopen the list under the field somebody has finished with.
   */
  const filled = useRef(null);

  /**
   * WHAT THE LIST IS DOING, WORKED OUT DURING THE RENDER THAT DECIDES IT.
   *
   * None of these is stored, and that is the point: each is a function of the
   * field's text plus the last answer we got, so holding one in state means
   * holding a copy that can disagree with the field — the bug the effect below
   * was written to keep repairing.
   *
   *   searchable  long enough to ask about, and there is a key
   *   fresh       the results in hand answer THIS text, not a previous one
   *   items/open  therefore what may be shown, and whether it is on screen
   *
   * `open` is the conjunction, not `openState` alone: that is only the user's
   * half of the answer and cannot describe a list that has gone stale. Reading
   * it directly is how `aria-expanded` announces a listbox that is not there.
   */
  const query = String(value || '').trim();
  const searchable = !placesDisabled && query.length >= MIN_CHARS;
  const fresh = searchable && result.query === query;
  const items = fresh ? result.items : EMPTY_RESULT.items;
  const open = openState && items.length > 0;
  // An aborted request still runs its `finally` — but not before this render,
  // so the spinner is masked rather than left to clear itself.
  const busy = busyState && searchable;

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * THE SEARCH, DEBOUNCED AND CANCELLABLE.
   *
   * Two independent mechanisms, and both are needed:
   *
   *   the timer   collapses a burst of keystrokes into one request
   *   the abort   cancels a request that is already in flight when the next
   *               one starts
   *
   * The timer alone still races: type "danfo", pause 250ms, keep typing, and two
   * requests are live at once. They can answer out of order, so the list ends up
   * showing suggestions for "danfo" under an input reading "danforth music".
   * `apiFetch` forwards a caller's `signal` and rethrows a deliberate abort
   * unchanged, which is what makes the stale answer discardable.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    // Nothing to search for. This used to clear `items`, `open` and `busy`
    // here; it no longer needs to, because `searchable` was false during the
    // render above and the derived values are already empty and shut.
    if (!searchable) return undefined;

    // The value we wrote ourselves on selection. Not a search.
    if (filled.current !== null && filled.current === query) return undefined;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      if (!session.current) session.current = newSession();

      const params = new URLSearchParams({ q: query, session: session.current });
      if (country) params.set('country', country);

      try {
        const found = await get(`/places/suggest?${params}`, {
          noRedirect: true,
          cache: 'no-store',
          signal: controller.signal,
        });
        // Stamped with the query they answer, so a render can tell whether
        // they still describe the field.
        setResult({ query, items: Array.isArray(found) ? found : [] });
        // Open only when there is something to show. An empty box that says
        // "no results" for a venue Google does not list is a box telling the
        // organizer their real venue is wrong.
        setOpen(Array.isArray(found) && found.length > 0);
        setActive(-1);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        /**
         * NO KEY ON THIS DEPLOYMENT — not a failure, and not shown.
         *
         * Remembered at module scope so this is asked once rather than on every
         * debounce of every instance, and the field quietly becomes the plain
         * text input it was before venue search existed.
         */
        if (err?.code === 'PLACES_DISABLED') {
          placesDisabled = true;
          // Drops the "pick your venue" hint, so the field stops promising a
          // list it cannot show.
          setSearchLive(false);
        }
        // Every other failure is also silent, and that is deliberate: this is a
        // suggestion list on an optional field. Google being unreachable must
        // not put a red error under a venue name the organizer typed correctly.
        setResult(EMPTY_RESULT);
        setOpen(false);
      } finally {
        setBusy(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    /* `query`, not `value`: the trimmed text is what gets sent, so a trailing
       space used to abort the request in flight and start an identical one. */
  }, [query, searchable, country]);

  /**
   * A tap outside closes the list.
   *
   * `pointerdown` rather than `click`, and the same reasoning the site header's
   * mobile menu records: it fires before focus moves and before a scroll can
   * start, so the list is gone by the time the finger lifts. On a phone this is
   * the usual way out — there is no Escape key.
   */
  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open]);

  /** Resolve a chosen suggestion into the five fields and hand them up. */
  async function choose(item) {
    setOpen(false);
    setActive(-1);
    // The name lands immediately, so the field never sits empty while the
    // details request is in flight — and `filled` stops that write re-searching.
    filled.current = item.primary;
    onChange(item.primary);

    const token = session.current;
    // The session ENDS here: the details call is its last billable request, and
    // the next keystroke has to start a new one.
    session.current = null;

    try {
      const place = await get(
        `/places/${encodeURIComponent(item.placeId)}?session=${encodeURIComponent(token || '')}`,
        { noRedirect: true, cache: 'no-store' },
      );
      // `name` can come back empty for an address with no business on it; the
      // suggestion's own text is the better label in that case.
      const resolved = { ...place, name: place.name || item.primary };
      filled.current = resolved.name;
      onChange(resolved.name);
      onPlace?.(resolved);
    } catch {
      /**
       * The name is already in the field and that is a usable outcome.
       *
       * Failing here means no address, no city and no pin — so `onPlace` is not
       * called, and whatever the organizer had typed into those fields stays.
       * Silently keeping the name beats an error on a field that now contains
       * exactly what they picked.
       */
      onPlace?.(null);
    } finally {
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e) {
    // Let the browser's own behaviour stand when there is no list: Enter
    // submits the step, Escape does whatever the form says.
    if (!open || items.length === 0) {
      if (e.key === 'ArrowDown' && items.length > 0) { setOpen(true); e.preventDefault(); }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      // ONLY when something is highlighted. Otherwise Enter belongs to the
      // form — an organizer who typed a venue Google does not know and pressed
      // Enter must advance the wizard, not select a suggestion they never
      // looked at.
      if (active >= 0 && items[active]) {
        e.preventDefault();
        choose(items[active]);
      }
    } else if (e.key === 'Escape') {
      // Closes the list and nothing else. `stopPropagation` because this field
      // can sit inside a dialog, and Escape there would otherwise close the
      // whole thing out from under a list the reader was only dismissing.
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  }

  const describedBy = [hint && hintId, error && errorId, statusId].filter(Boolean).join(' ');

  return (
    /* The same wrapper, label and hint/error markup `Field` renders, reusing
       its exported `FieldLabel` — so this field sits in a form beside ordinary
       ones without being a second, slightly different field component. Only the
       input and the list below it are this component's own. */
    <div className="fx-stack fx-stack--sm es-place gap-1.5" ref={rootRef}>
      {/**
        * NO BADGE UNLESS THE CALLER ASKS FOR ONE.
        *
        * This read `<FieldLabel optional>` — hardcoded — so the venue field
        * started announcing itself as "Optional", which the plain `Field` it
        * replaced never did. The wizard's own rule is subtler than that word:
        * venue is in `SUBMIT_ONLY_FIELDS`, meaning it does not block a DRAFT but
        * IS required before the event can be submitted for review. Stamping
        * "Optional" on it tells an organizer they can skip something that will
        * stop them going on sale, and the `pending()` hint right below it says
        * the opposite on the same screen.
        *
        * Both props pass through now, so this field labels itself exactly the
        * way every other field in the form does — by what the caller says.
        */}
      <FieldLabel htmlFor={id} required={required} optional={optional}>{label}</FieldLabel>

      {/*
        `role="combobox"` on the INPUT, which is where ARIA 1.2 puts it — 1.0
        wrapped the pair in a combobox div, and screen readers shipped since
        disagree about that shape. The input keeps real focus the whole time;
        only `aria-activedescendant` moves.
      */}
      <div className="es-place__box">
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="text"
          className="es-input es-place__input"
          autoComplete="off"
          maxLength={maxLength}
          placeholder={placeholder}
          value={value}
          onChange={(e) => { filled.current = null; onChange(e.target.value); }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy || undefined}
        />
        {/* Busy is shown, never announced as an alert: it is a suggestion list
            loading under an optional field. `aria-hidden` because the live
            region below is what speaks. */}
        {busy && <span className="es-place__busy" aria-hidden="true" />}
      </div>

      {/*
        THE LIVE REGION IS SEPARATE FROM THE LIST, and it has to be: a listbox
        appearing is a visual event, and a screen reader is told about it here
        rather than by the list announcing itself. `polite` so it waits for a
        gap in typing instead of interrupting every keystroke.
      */}
      <span id={statusId} role="status" aria-live="polite" className="sr-only">
        {open && items.length > 0
          ? `${items.length} venue ${items.length === 1 ? 'suggestion' : 'suggestions'}. Use the arrow keys to choose one.`
          : ''}
      </span>

      {open && items.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Venue suggestions" className="es-place__list">
          {items.map((item, i) => (
            /*
              `onPointerDown` with `preventDefault`, not `onClick`. A click fires
              after the input has already lost focus, and the blur closes the
              list — so on some browsers the option is unmounted before its own
              handler runs and the tap does nothing. Preventing the default keeps
              focus in the input, which is where the combobox pattern wants it.
            */
            <li
              key={item.placeId}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className="es-place__option"
              data-active={i === active ? 'true' : undefined}
              onPointerDown={(e) => { e.preventDefault(); choose(item); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="es-place__mark" aria-hidden="true">
                <NavIcon name="pin" size={16} />
              </span>
              <span className="es-place__text">
                <span className="es-place__name">{item.primary}</span>
                {item.secondary && <span className="es-place__addr">{item.secondary}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The caller's hint wins — it carries validation state. The search promise
          is this component's own, and only while it is true. */}
      {(hint || searchLive) && !error && (
        <p id={hintId} className="text-xs text-subtle">
          {hint || 'Start typing and pick your venue — the address, city and map pin fill themselves in.'}
        </p>
      )}
      {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
    </div>
  );
}
