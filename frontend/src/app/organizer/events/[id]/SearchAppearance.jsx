'use client';

import Link from 'next/link';
import NavIcon from '../../../components/shell/NavIcon';
import { Panel } from '../../../components/ui/Page';
import { useApi } from '../../../hooks/useApi';
import {
  seoTitle, seoDescription, seoChecklist, toPublicShape, whenPhrase, wherePhrase, pricePhrase,
} from '../../../lib/eventSeo';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "How this event looks in Google", and what would make it rank better.
 *
 * The preview is built by the SAME functions the public page uses for its
 * <title> and meta description (`lib/eventSeo.js`), so what the organizer sees
 * here is what a search engine is sent — not an approximation of it.
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

export default function SearchAppearance({ event }) {
  const ticketed = event.listingType !== 'display_only';
  const { data: tiers } = useApi(ticketed ? `/events/${event.id}/tiers` : null);
  const shaped = toPublicShape(event, (tiers || []).map((t) => ({
    name: t.name, priceCents: t.priceCents, hidden: Boolean(t.isHidden), salesStartAt: t.salesStartAt, salesEndAt: t.salesEndAt,
  })));
  const checks = seoChecklist(shaped);
  const done = checks.filter((c) => c.done).length;
  const facts = [whenPhrase(shaped), wherePhrase(shaped), pricePhrase(shaped).replace(/\.$/, '')].filter(Boolean);
  const base = `/organizer/events/${event.id}`;

  return (
    <Panel
      title="Search appearance"
      description="How this event can appear when someone searches for it, and what would help it rank."
    >
      <div className="es-serp" aria-label="Search result preview">
        <p className="es-serp__site">
          <span className="es-serp__fav" aria-hidden="true">E</span>
          <span className="fx-min0">
            <span className="es-serp__name">Eventsli</span>
            <span className="es-serp__url fx-truncate">eventsli.com › e › {event.slug}</span>
          </span>
        </p>
        <p className="es-serp__title fx-break">{seoTitle(shaped)}</p>
        <p className="es-serp__desc fx-break">{seoDescription(shaped)}</p>
        {facts.length > 0 && <p className="es-serp__facts fx-break">{facts.join(' · ')}</p>}
      </div>

      <div className="fx-stack fx-stack--sm">
        <p className="fx-row items-center gap-2 text-sm">
          <span className="es-serp__meter" aria-hidden="true">
            <span style={{ width: `${Math.round((done / checks.length) * 100)}%` }} />
          </span>
          <span className="text-muted">{done} of {checks.length} done</span>
        </p>
        <ul className="es-serp__checks">
          {checks.map((c) => (
            <li key={c.key} data-done={c.done || undefined}>
              <span className="es-serp__mark" aria-hidden="true"><NavIcon name={c.done ? 'check' : 'plus'} size={15} /></span>
              <span className="fx-min0 flex-1">
                <span className="block text-sm text-ink">{c.label}<span className="sr-only">{c.done ? ' — done' : ' — to do'}</span></span>
                {!c.done && <span className="block text-xs text-subtle">{c.why}</span>}
              </span>
              {!c.done && FIX[c.key] && (
                <Link href={`${base}/${FIX[c.key]}`} className="es-btn es-btn--ghost es-btn--sm">Add</Link>
              )}
            </li>
          ))}
        </ul>
        {event.status === 'published' && (
          <p className="text-xs text-subtle">
            Changes reach search engines the next time they visit. Sharing the link helps them find it sooner.
          </p>
        )}
      </div>
    </Panel>
  );
}
