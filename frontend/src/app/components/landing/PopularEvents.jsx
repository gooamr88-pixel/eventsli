'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import EventCard from '../EventCard';
import NavIcon from '../shell/NavIcon';
import { get } from '../../utils/apiClient';
import Accent from './Accent';
import CardRail from './CardRail';

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
 * RESTYLED 2026-11-15 to the homepage concept: the categories are chips with
 * an icon each, the chosen one on the brand yellow; then a heading with the
 * coral bar beside it and "View All Events" opposite. Only the first seven
 * categories are chips — "More" goes to /events, where all of them are.
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
        const rows = await get(`/public/events?limit=24&category=${encodeURIComponent(active)}`, { noRedirect: true });
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
  const chips = [{ slug: '', label: 'All Events' }, ...categories.slice(0, 7)];

  return (
    <section id="events" className="es-band es-popular fx-section fx-section--tight-bottom">
      <div className="fx-container fx-container--xl">
        {categories.length > 0 && (
          <div className="es-catchips" role="group" aria-label="Filter by category">
            {chips.map((c) => (
              <button
                key={c.slug || 'all'}
                type="button"
                aria-pressed={active === c.slug}
                onClick={() => setActive(c.slug)}
                className="es-catchip"
              >
                <NavIcon name={categoryIcon(c.slug)} size={18} />
                {c.label}
              </button>
            ))}
            {categories.length > 7 && (
              <Link href="/events" className="es-catchip">
                <NavIcon name="dots" size={18} />
                More
              </Link>
            )}
          </div>
        )}

        <div className="es-lp-head">
          <div>
            {copy.featuredEyebrow && <p className="es-lp-kicker">{copy.featuredEyebrow}</p>}
            <h2 className="es-lp-title es-lp-title--bar">
              <Accent text={copy.featuredTitle || 'Popular Events Near You'} />
            </h2>
            {copy.featuredBody && <p className="es-lp-lede"><Accent text={copy.featuredBody} /></p>}
          </div>
          <Link
            href={active ? `/events?category=${encodeURIComponent(active)}` : '/events'}
            className="es-lp-link"
          >
            View All Events <NavIcon name="arrow" size={16} />
          </Link>
        </div>

        {!current ? (
          <ul className="es-lp-cards" aria-busy="true">
            {[0, 1, 2].map((n) => <li key={n} className="es-skeleton es-lp-cards__ghost" />)}
          </ul>
        ) : current.rows.length > 0 ? (
          /* Paged with dots from a tablet up (CardRail): every fetched event is
             reachable, not just the first six. */
          <CardRail key={active} label="Events">
            {current.rows.map((event, i) => (
              <li key={event.id}><EventCard event={event} priority={active === '' && i < 2} /></li>
            ))}
          </CardRail>
        ) : (
          <Empty failed={current.failed} label={activeLabel} />
        )}

      </div>
    </section>
  );
}

/**
 * The icon for a category chip. The categories are the admin's, so this is a
 * lookup with a fallback: a category added later still gets the ticket.
 */
const CATEGORY_ICONS = {
  '': 'ticket',
  music: 'music', concert: 'music', concerts: 'music',
  festival: 'tent', festivals: 'tent', outdoors: 'tent',
  boat: 'ship', boat_party: 'ship', boat_parties: 'ship', cruise: 'ship',
  arts: 'masks', theater: 'masks', theatre: 'masks', culture: 'masks',
  comedy: 'mic', nightlife: 'sparkle', dance: 'sparkle', gala: 'star',
  sports: 'ball', food_drink: 'food', film: 'film',
  business: 'briefcase', conference: 'users', conferences: 'users', exhibition: 'building', exhibitions: 'building',
  education: 'bulb', tech: 'laptop', community: 'users', family: 'home',
  charity: 'heart', wellness: 'pulse', fashion: 'sparkle', holiday: 'star', faith: 'star',
  other: 'dots',
};
export function categoryIcon(slug) {
  return CATEGORY_ICONS[slug] || 'ticket';
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
          : 'New events appear here as soon as organizers publish them. Check back soon, or be the first to put something on.'}
      </p>
    </div>
  );
}
