'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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

export default function EventsSearch({ q, city, from, category, categories = [], children }) {
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
      router.replace(withZone(typed), { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed, shown, router]);

  /**
   * THE SIDEBAR (owner's reference, 2026-11-19): "Search event name", then
   * "City and address", then the categories as a radio list, then the date and
   * the quick filters. Below lg everything after the city box folds behind a
   * "Filters" toggle, so a phone reaches the first event without scrolling past
   * fifteen categories. From lg up it is always open.
   */
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Named on the toggle only when a real category is picked, not "All".
  const activeLabel = categories.find((c) => c.active && c.slug)?.label;

  return (
    <form action="/events" method="get" role="search" className="es-evx-side" aria-label="Find events">
      {category && <input type="hidden" name="category" value={category} />}

      <label className="es-evx-field" htmlFor="ev-q">
        <NavIcon name="search" size={22} className="es-evx-field__icon" />
        <span className="sr-only">Search event name</span>
        <input
          id="ev-q"
          type="search"
          name={what ? 'q' : undefined}
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="Search event name"
          autoComplete="off"
          className="es-evx-field__input"
        />
      </label>

      <section className="es-evx-side__group">
        <h2 className="es-evx-side__heading"><label htmlFor="ev-city">City and address</label></h2>
        <div className="es-evx-field">
          <NavIcon name="pin" size={20} className="es-evx-field__icon es-evx-field__icon--accent" />
          <input
            id="ev-city"
            type="text"
            name={where ? 'city' : undefined}
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            placeholder="Enter city or address"
            autoComplete="address-level2"
            className="es-evx-field__input"
          />
        </div>
      </section>

      <button
        type="button"
        className="es-evx-side__toggle"
        aria-expanded={filtersOpen}
        aria-controls="ev-filters"
        onClick={() => setFiltersOpen((o) => !o)}
      >
        <NavIcon name="filter" size={18} />
        Filters
        {activeLabel && <span className="es-evx-side__toggle-note">{activeLabel}</span>}
        <NavIcon name="arrow" size={16} className={`es-evx-side__chev ${filtersOpen ? 'is-open' : ''}`} />
      </button>

      <div id="ev-filters" className={`es-evx-side__more ${filtersOpen ? 'is-open' : ''}`}>
        {/* Links, not inputs: every category is a URL, so a filtered view is
            shareable and works before (and without) JavaScript. Drawn as
            radios because only one applies at a time. */}
        <section className="es-evx-side__group">
          <h2 className="es-evx-side__heading">Category</h2>
          <ul className="es-evx-radios">
            {categories.map((c) => (
              <li key={c.slug || 'all'}>
                <Link
                  href={c.href}
                  aria-current={c.active ? 'page' : undefined}
                  className={`es-evx-radio ${c.active ? 'is-checked' : ''}`}
                >
                  <span aria-hidden className="es-evx-radio__dot" />
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="es-evx-side__group">
          <h2 className="es-evx-side__heading"><label htmlFor="ev-from">Date</label></h2>
          <div className="es-evx-field">
            <NavIcon name="calendar" size={20} className="es-evx-field__icon es-evx-field__icon--accent" />
            <span className="es-ev-search__date">
              {!when && <span aria-hidden className="es-ev-search__hint">Any date</span>}
              <input
                id="ev-from"
                type="date"
                name={when ? 'from' : undefined}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className={`es-evx-field__input es-ev-search__input--date ${when ? '' : 'is-blank'}`}
              />
            </span>
          </div>
        </section>

        {children}
      </div>

      {/* Without JavaScript this is the only way to search; with it, Enter
          applies the boxes now instead of after the typing pause. */}
      <button type="submit" className="sr-only">Search</button>
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
/**
 * Smart search reads "this weekend" and "tomorrow" in the READER's time zone
 * (lib/smartSearch.js), so a query carries it. Added only when there is a
 * query, and only here at navigation time — never during render, where the
 * server's zone and the browser's would disagree and break hydration.
 */
function withZone(url) {
  if (!url.includes('q=')) return url;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone ? `${url}&tz=${encodeURIComponent(zone)}` : url;
  } catch {
    return url;
  }
}

function urlFor({ what, where, when, category }) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (what?.trim()) params.set('q', what.trim());
  if (where?.trim()) params.set('city', where.trim());
  if (when) params.set('from', when);
  const qs = params.toString();
  return qs ? `/events?${qs}` : '/events';
}
