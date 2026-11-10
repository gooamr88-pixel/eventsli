import Link from 'next/link';
import RelatedCarousel from './RelatedCarousel';
import { serverFetch } from '../../utils/apiClient';
import { breadcrumbs, quickAnswers } from '../../lib/eventSeo';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The parts of the event page that exist so it can be FOUND — and that earn
 * their place for a reader too.
 *
 *   · the breadcrumb: where this event sits (Events › Toronto › …), the same
 *     path the BreadcrumbList structured data gives Google, and one tap to
 *     every other event in the city;
 *   · quick answers: when, where, how much, how to get in — the questions
 *     people type into a search box about one event, answered in a sentence;
 *   · more events nearby: real links to other published events, so a crawler
 *     that lands on one event reaches the rest, and a buyer whose date does
 *     not work has somewhere to go that is not back to Google.
 *
 * All three are server-rendered and in the HTML before any JavaScript runs,
 * like everything else on this page (see the note at the top of page.jsx).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export function EventBreadcrumbs({ event }) {
  const trail = breadcrumbs(event);
  return (
    <nav aria-label="Breadcrumb" className="es-ev-crumbs">
      <ol>
        {trail.map((c, i) => (
          <li key={c.href}>
            {i === trail.length - 1
              ? <span aria-current="page" className="fx-truncate">{c.name}</span>
              : <Link href={c.href}>{c.name}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function EventQuickAnswers({ event }) {
  const answers = quickAnswers(event);
  if (answers.length === 0) return null;
  return (
    <section className="fx-stack" aria-labelledby="event-answers">
      <h2 id="event-answers" className="text-lg">Quick answers</h2>
      <dl className="es-ev-answers">
        {answers.map(({ q, a }) => (
          <div key={q} className="es-ev-answers__row">
            <dt className="fx-break">{q}</dt>
            <dd className="fx-break">{a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Other published events, in the same city first, then the same category.
 *
 * Its own fetch, cached for five minutes under the listings' tag, so a
 * publish or a cancellation drops it like every other listing. A failure
 * removes the section and nothing else: this is the least important thing on
 * the page and must never be the reason it does not render.
 */
const WANT = 4;

async function upcoming(params) {
  try {
    const rows = await serverFetch(`/public/events?${new URLSearchParams({ limit: '8', ...params })}`, {
      tags: ['events:published'], revalidate: 300,
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function RelatedEvents({ event }) {
  const seen = new Set([event.id]);
  const pick = (rows) => rows.filter((e) => e && !seen.has(e.id) && seen.add(e.id));

  let list = event.city ? pick(await upcoming({ city: event.city })) : [];
  if (list.length < WANT && event.category) list = list.concat(pick(await upcoming({ category: event.category })));
  list = list.slice(0, WANT);
  if (list.length === 0) return null;

  const cityOnly = event.city && list.every((e) => e.city === event.city);
  const title = cityOnly ? `More events in ${event.city}` : 'You might also like';
  const more = event.city ? `/events?city=${encodeURIComponent(event.city)}` : '/events';

  // The owner's design (2026-11-10): a carousel of wide cards, RelatedCarousel.jsx.
  return <RelatedCarousel events={list} title={title} city={event.city} moreHref={more} />;
}
