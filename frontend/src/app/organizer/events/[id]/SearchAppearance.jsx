'use client';

import Link from 'next/link';
import NavIcon from '../../../components/shell/NavIcon';
import { LogoMark } from '../../../components/brand/Logo';
import { useApi } from '../../../hooks/useApi';
import {
  seoTitle, seoDescription, seoChecklist, toPublicShape, whenPhrase, wherePhrase, pricePhrase, eventUrl,
} from '../../../lib/eventSeo';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "How this event looks in Google", and what would make it rank better — as
 * two cards on the overview: the preview, and Setup progress beside it.
 *
 * The preview is built by the SAME functions the public page uses for its
 * <title> and meta description (`lib/eventSeo.js`), so what the organizer sees
 * here is what a search engine is sent — not an approximation of it. The site
 * line carries the real Eventsli mark, as the result itself will.
 *
 * The checklist is the listing-quality work an organizer can actually do:
 * every item is a field they own, linked to the screen that sets it. It is a
 * guide, never a gate — none of it blocks submitting, and nothing here
 * promises a ranking.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const FIX = {
  cover: 'content', highlights: 'content', description: 'details', venue: 'details',
  city: 'details', pin: 'details', title: 'details', tickets: 'tiers',
};

/** The event as its public page will read, and the checklist over it. One hook, so both cards agree. */
export function useSeo(event) {
  const ticketed = event.listingType !== 'display_only';
  const { data: tiers } = useApi(ticketed ? `/events/${event.id}/tiers` : null);
  const shaped = toPublicShape(event, (tiers || []).map((t) => ({
    name: t.name, priceCents: t.priceCents, hidden: Boolean(t.isHidden), salesStartAt: t.salesStartAt, salesEndAt: t.salesEndAt,
  })));
  return { shaped, checks: seoChecklist(shaped) };
}

export function SearchPreview({ event, seo }) {
  const { shaped } = seo;
  const facts = [whenPhrase(shaped), wherePhrase(shaped)].filter(Boolean).join(' · ');
  const price = pricePhrase(shaped).replace(/\.$/, '');
  const url = eventUrl(event.slug).replace(/^https?:\/\//, '').replace('/e/', ' › e › ');

  return (
    <section className="es-dcard" aria-labelledby="ov-search">
      <div className="es-ovcard__head">
        <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="search" size={22} /></span>
        <div className="fx-min0">
          <h2 id="ov-search" className="es-dcard__title">Search Appearance</h2>
          <p className="es-ovcard__desc">How your event can appear in Google search results.</p>
        </div>
      </div>
      <div className="es-serp2" aria-label="Search result preview">
        <p className="es-serp2__site">
          <span className="es-serp2__fav" aria-hidden="true"><LogoMark /></span>
          <span className="fx-min0">
            <span className="es-serp2__name">Eventsli</span>
            <span className="es-serp2__url fx-truncate">{url}</span>
          </span>
        </p>
        <p className="es-serp2__title fx-break">{seoTitle(shaped)}</p>
        {facts && <p className="es-serp2__facts fx-break">{facts}{price ? ` · ${price}` : ''}</p>}
        <p className="es-serp2__desc fx-break">{seoDescription(shaped)}</p>
      </div>
      {event.status === 'published' && (
        <p className="es-ovcard__note">Changes reach search engines the next time they visit. Sharing the link helps them find it sooner.</p>
      )}
    </section>
  );
}

export function SetupProgress({ event, seo }) {
  const { checks } = seo;
  const done = checks.filter((c) => c.done).length;
  const pct = checks.length ? Math.round((done / checks.length) * 100) : 0;
  const base = `/organizer/events/${event.id}`;

  return (
    <section className="es-dcard" aria-labelledby="ov-setup">
      <div className="es-dcard__head">
        <h2 id="ov-setup" className="es-dcard__title"><NavIcon name="layers" size={22} />Setup Progress</h2>
        <span className="es-setup__count">{done} of {checks.length} completed</span>
      </div>
      <div className="es-setup__meter">
        <span className="es-setup__bar" role="img" aria-label={`${pct}% complete`}><span style={{ width: `${pct}%` }} /></span>
        <b>{pct}%</b>
      </div>
      <ul className="es-setup">
        {checks.map((c) => (
          <li key={c.key} data-done={c.done || undefined} title={c.done ? undefined : c.why}>
            <span className="es-setup__mark" aria-hidden="true">{c.done && <NavIcon name="tick" size={14} />}</span>
            <span className="fx-min0 flex-1">
              {c.label}
              <span className="sr-only">{c.done ? ' — done' : ` — to do. ${c.why}`}</span>
            </span>
            {!c.done && FIX[c.key] && (
              <Link href={`${base}/${FIX[c.key]}`} className="es-setup__add">
                <NavIcon name="plus" size={14} />Add
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
