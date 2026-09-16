'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import EventCard from '../EventCard';
import NavIcon from '../shell/NavIcon';
import { get } from '../../utils/apiClient';
import Accent from './Accent';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Popular events": a heading, a strip of tabs, the cards and "View more".
 *
 * THE FIRST TAB IS SERVER-RENDERED. "All events" arrives with the page, so a
 * crawler and a visitor without JavaScript see the same eight cards as
 * everyone else. Only a DIFFERENT tab fetches, from the same public endpoint
 * /events uses, and each answer is kept so switching back costs nothing.
 *
 * The tabs are the admin's categories — the design's "Tickets / Sponsors /
 * Vendors" are kinds of listing this product does not have, and a tab that
 * leads nowhere is worse than no tab.
 *
 * Toggle buttons with `aria-pressed`, not an ARIA tablist: a tablist promises
 * arrow-key navigation and a tabpanel relationship, and a filter that
 * re-renders one list is neither.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PopularEvents({ copy, categories, events, failed }) {
  const [active, setActive] = useState('');
  const [results, setResults] = useState(() => ({ '': { rows: events, failed } }));

  useEffect(() => {
    if (results[active]) return undefined;
    let cancelled = false;
    (async () => {
      let entry;
      try {
        const rows = await get(`/public/events?limit=8&category=${encodeURIComponent(active)}`, { noRedirect: true });
        entry = { rows: Array.isArray(rows) ? rows : [], failed: false };
      } catch {
        entry = { rows: [], failed: true };
      }
      if (!cancelled) setResults((prev) => ({ ...prev, [active]: entry }));
    })();
    return () => { cancelled = true; };
  }, [active, results]);

  const current = results[active];
  const activeLabel = categories.find((c) => c.slug === active)?.label;

  return (
    <section id="events" className="es-band fx-section">
      <div className="fx-container fx-container--xl">
        <div className="es-lp-head">
          <div>
            {copy.featuredEyebrow && <p className="es-lp-kicker">{copy.featuredEyebrow}</p>}
            <h2 className="es-lp-title"><Accent text={copy.featuredTitle || 'Popular events'} lastWord /></h2>
            {copy.featuredBody && <p className="es-lp-lede"><Accent text={copy.featuredBody} /></p>}
          </div>
          <Link href="/events" className="es-lp-link">
            Browse all events <NavIcon name="arrow" size={16} />
          </Link>
        </div>

        {categories.length > 0 && (
          <div className="es-lp-tabs" role="group" aria-label="Filter by category">
            {[{ slug: '', label: 'All events' }, ...categories].map((c) => (
              <button
                key={c.slug || 'all'}
                type="button"
                aria-pressed={active === c.slug}
                onClick={() => setActive(c.slug)}
                className="es-lp-tabs__tab"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {!current ? (
          <ul className="es-lp-cards" aria-busy="true">
            {[0, 1, 2].map((n) => <li key={n} className="es-skeleton es-lp-cards__ghost" />)}
          </ul>
        ) : current.rows.length > 0 ? (
          <ul className="es-lp-cards">
            {current.rows.map((event, i) => (
              <li key={event.id}><EventCard event={event} priority={active === '' && i < 2} /></li>
            ))}
          </ul>
        ) : (
          <Empty failed={current.failed} label={activeLabel} />
        )}

        <div className="es-lp-center mt-9">
          <Link
            href={active ? `/events?category=${encodeURIComponent(active)}` : '/events'}
            className="es-lp-btn es-lp-btn--ghost"
          >
            View all events <NavIcon name="arrow" size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Says WHO failed: "we could not load" is about us, "nothing on sale" is a
 *  claim about the business, and the two must never be confused. */
function Empty({ failed, label }) {
  return (
    <div className="es-empty es-empty--rich">
      <span aria-hidden className="es-empty__mark">
        <NavIcon name={failed ? 'alert' : 'calendar'} size={22} />
      </span>
      <p className="text-md font-medium text-ink">
        {failed
          ? 'We could not load events just now.'
          : label ? `Nothing in ${label} on sale just yet.` : 'Nothing is on sale just yet.'}
      </p>
      <p className="max-w-[44ch] text-center text-sm text-muted">
        {failed
          ? 'This one is on us — please try again in a moment.'
          : 'Every event is reviewed before it goes on sale. Check back soon, or be the first to put something on.'}
      </p>
    </div>
  );
}
