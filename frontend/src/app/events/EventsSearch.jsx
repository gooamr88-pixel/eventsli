'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import NavIcon from '../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The /events search panel: what, where, when.
 *
 * STILL A PLAIN GET FORM, and that has not changed even though it now searches
 * as you type. `action="/events"` with named inputs means the browser builds
 * `?q=…&city=…` itself and navigates — so this works with JavaScript disabled,
 * works before hydration, and produces a URL somebody can share. The live
 * behaviour below is an ENHANCEMENT layered on top of a form that already
 * worked; the Search button is still there and still submits.
 *
 * ── SEARCHING AS YOU TYPE ────────────────────────────────────────────────────
 *
 * Pressing a button to see results is a step this page did not need: the
 * listing is already a URL and the server already re-renders on a param
 * change, so the button was only ever deciding WHEN to ask.
 *
 * Three things make that safe rather than chatty:
 *
 *   · DEBOUNCED at 350ms, so "waterfront" is one request and not eleven. The
 *     delay is long enough to cover ordinary typing and short enough that a
 *     person who has stopped does not notice waiting.
 *   · `router.replace`, NOT `push`. Every keystroke as a history entry means
 *     the back button walks backwards through a half-typed word, one letter at
 *     a time, before it leaves the page.
 *   · ONE delay for all three fields, including the date. A date pick is a
 *     single discrete act and could fire at once, but exempting it would mean
 *     two timing rules and a second code path for four tenths of a second
 *     nobody is waiting on — the picker's own closing animation covers it.
 *
 * Empty fields are left out of the URL rather than sent as `?city=`, which the
 * page would read as a filter for nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const DEBOUNCE_MS = 350;

export default function EventsSearch({ q, city, from, category }) {
  const router = useRouter();

  const [what, setWhat] = useState(q);
  const [where, setWhere] = useState(city);
  const [when, setWhen] = useState(from);

  /** What the boxes hold, and what the page is actually showing. */
  const typed = urlFor({ what, where, when, category });
  const shown = urlFor({ what: q, where: city, when: from, category });

  /**
   * The last URL our own typing navigated to.
   *
   * STATE, not a ref, and that is not a style choice — React 19 refuses a ref
   * read during render, because a render that depends on a ref is one the
   * compiler cannot know needs redoing. This value IS read during render, by
   * the block below, so it has to be state.
   */
  const [applied, setApplied] = useState(null);

  /**
   * THE URL CHANGED UNDER US, so the boxes follow it.
   *
   * A category link, "Clear all", or the Back button re-render this component
   * with new props while the boxes still hold what was typed — leaving a word
   * in the search box that the listing is no longer filtered by.
   *
   * `propsUrl !== applied` is what separates somebody ELSE's navigation from
   * our own echoing back. Without it, this races the reader: we `replace` to
   * `?q=waterfr`, they type "o", and the reply for "waterfr" arrives and
   * overwrites the "o" out of the box. Comparing against what we sent means
   * our own answer is recognised and ignored, however far ahead the typing is.
   *
   * Adjusted DURING render, which is what React asks for when state follows a
   * prop: the component re-runs before it paints, so the stale value is never
   * seen.
   */
  const [lastShown, setLastShown] = useState(shown);
  if (shown !== lastShown) {
    setLastShown(shown);
    if (shown !== applied) {
      setWhat(q);
      setWhere(city);
      setWhen(from);
    }
  }

  /**
   * Typing settles, then the listing moves.
   *
   * Nothing happens while `typed === shown`, which covers the first render and
   * every moment the page already agrees with the boxes — so mounting never
   * navigates. The timer is cleared on every keystroke and on unmount, so only
   * a pause sends a request and a pending one cannot navigate a page the
   * reader has left.
   *
   * `setApplied` sits INSIDE the timeout rather than in the effect body: a
   * synchronous setState in an effect is a render React paints and throws
   * away, and the linter refuses it.
   */
  useEffect(() => {
    if (typed === shown) return undefined;
    const timer = setTimeout(() => {
      setApplied(typed);
      router.replace(typed, { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed, shown, router]);

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

      {/* Kept. Without JavaScript it is the only way to search, and with it
          somebody who has typed and wants the answer NOW should not have to
          wait out a debounce they cannot see. */}
      <button type="submit" className="es-ev-search__submit">
        <NavIcon name="search" size={18} />
        Search
      </button>
    </form>
  );
}

/**
 * The URL a set of fields means — the same one the form itself would build.
 *
 * Empty values are omitted rather than sent blank, matching `name={x ? … :
 * undefined}` on each input above. The two have to agree: if they did not, the
 * button and the typing would produce different listings from the same boxes.
 */
function urlFor({ what, where, when, category }) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (what?.trim()) params.set('q', what.trim());
  if (where?.trim()) params.set('city', where.trim());
  if (when) params.set('from', when);
  const qs = params.toString();
  return qs ? `/events?${qs}` : '/events';
}
