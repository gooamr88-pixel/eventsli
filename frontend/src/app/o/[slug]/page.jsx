import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverFetch } from '../../utils/apiClient';
import { jsonLdScript } from '../../utils/jsonLd';
import { siteOrigin } from '../../lib/eventSeo';
import EventCard from '../../components/EventCard';
import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * An organizer's public page — /o/<slug> (owner, 2026-11-18: "creating profile
 * for each organizer showing all his events in Eventsli professionally").
 *
 * Who they are, how to reach them (only what they chose to publish — never
 * their account email), and every published event: what is coming, soonest
 * first, then what they have already put on. The cards are the same cards as
 * the listing, so a sold-out or past event says so here too.
 *
 * Linked from the event page ("Organized by") and from every ticket. An
 * unknown address and a banned organizer are the same 404.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const revalidate = 60;

async function loadProfile(slug) {
  try {
    return await serverFetch(`/public/organizers/${encodeURIComponent(slug)}`, {
      tags: [`organizer:${slug}`, 'events:published'],
      revalidate: 60,
    });
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

const firstSentence = (text) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > 158 ? `${t.slice(0, 155).replace(/\s+\S*$/, '')}…` : t;
};

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const page = await loadProfile(slug);
  if (!page) return { title: 'Organizer not found' };
  const { organizer, stats } = page;
  const url = `${siteOrigin()}/o/${organizer.slug}`;
  const description = firstSentence(organizer.description)
    || `${organizer.name} on Eventsli — ${stats.upcoming} upcoming ${stats.upcoming === 1 ? 'event' : 'events'}. Tickets and seats in minutes.`;
  return {
    title: { absolute: `${organizer.name} — events and tickets | Eventsli` },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      url,
      title: `${organizer.name} on Eventsli`,
      description,
      images: [organizer.logoUrl
        ? { url: organizer.logoUrl, alt: `${organizer.name} logo` }
        : { url: '/og-default.png', width: 1200, height: 630, alt: 'Eventsli' }],
    },
  };
}

function organizationJsonLd(organizer) {
  const sameAs = [organizer.contact.website, ...organizer.social.map((s) => s.url)].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: organizer.name,
    url: `${siteOrigin()}/o/${organizer.slug}`,
    ...(organizer.description ? { description: organizer.description } : {}),
    ...(organizer.logoUrl ? { logo: organizer.logoUrl } : {}),
    ...(organizer.contact.email ? { email: organizer.contact.email } : {}),
    ...(organizer.contact.phone ? { telephone: organizer.contact.phone } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

function regionName(code) {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code); } catch { return code; }
}

export default async function OrganizerPage({ params }) {
  const { slug } = await params;
  const page = await loadProfile(slug);
  if (!page) notFound();

  const { organizer, stats, upcoming, past } = page;
  const { contact, social } = organizer;
  const since = organizer.memberSince ? new Date(organizer.memberSince).getFullYear() : null;
  const site = contact.website ? contact.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;

  return (
    <main className="es-orgpage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(organizationJsonLd(organizer)) }} />

      <section className="es-orgpage__hero">
        <div className="fx-gutter">
          <div className="fx-container fx-container--xl es-orgpage__head">
            <span className="es-orgpage__logo" aria-hidden="true">
              {organizer.logoUrl
                // eslint-disable-next-line @next/next/no-img-element -- the organizer's own logo, from our storage
                ? <img src={organizer.logoUrl} alt="" />
                : <span>{organizer.name.slice(0, 1).toUpperCase()}</span>}
            </span>

            <div className="es-orgpage__intro fx-min0">
              <p className="es-orgpage__kicker">
                <NavIcon name="building" size={14} /> Event organizer
                {organizer.country && <> · {regionName(organizer.country)}</>}
              </p>
              <h1 className="es-orgpage__name fx-break">{organizer.name}</h1>
              <ul className="es-orgpage__stats" aria-label="At a glance">
                <li><b>{stats.upcoming}</b> upcoming</li>
                <li><b>{stats.past}</b> past {stats.past === 1 ? 'event' : 'events'}</li>
                {since && <li>On Eventsli since <b>{since}</b></li>}
              </ul>
            </div>

            {(contact.email || contact.phone || site || social.length > 0) && (
              <div className="es-orgpage__contact">
                <div className="es-orgpage__actions">
                  {contact.email && (
                    <a className="es-btn es-btn--primary" href={`mailto:${contact.email}`}>
                      <NavIcon name="mail" size={16} /> Email
                    </a>
                  )}
                  {contact.phone && (
                    <a className="es-btn es-btn--secondary" href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}>
                      <NavIcon name="chat" size={16} /> Call
                    </a>
                  )}
                  {site && (
                    <a className="es-btn es-btn--secondary" href={contact.website} target="_blank" rel="noopener noreferrer">
                      <NavIcon name="globe" size={16} /> Website
                    </a>
                  )}
                </div>
                {social.length > 0 && (
                  <ul className="es-orgpage__social" aria-label="Social media">
                    {social.map((s) => (
                      <li key={s.key}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {organizer.description && (
            <div className="fx-container fx-container--xl">
              <p className="es-orgpage__about">{organizer.description}</p>
            </div>
          )}
        </div>
      </section>

      <section className="fx-section fx-section--sm" aria-labelledby="org-upcoming">
        <div className="fx-gutter">
          <div className="fx-container fx-container--xl fx-stack">
            <h2 id="org-upcoming" className="es-orgpage__h2">Upcoming events</h2>
            {upcoming.length ? (
              <ul className="fx-grid es-orgpage__grid" style={{ '--fx-col': '260px' }}>
                {upcoming.map((event, i) => (
                  <li key={event.id}><EventCard event={event} priority={i < 3} headingLevel={3} adaptive /></li>
                ))}
              </ul>
            ) : (
              <div className="es-orgpage__empty">
                <NavIcon name="calendar" size={22} />
                <p>No upcoming events right now. Check back soon — or <Link href="/events">browse what else is on</Link>.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {past.length > 0 && (
        <section className="fx-section fx-section--sm fx-section--flush-top" aria-labelledby="org-past">
          <div className="fx-gutter">
            <div className="fx-container fx-container--xl fx-stack">
              <h2 id="org-past" className="es-orgpage__h2">Past events</h2>
              <ul className="fx-grid es-orgpage__grid" style={{ '--fx-col': '260px' }}>
                {past.map((event) => (
                  <li key={event.id}><EventCard event={event} headingLevel={3} adaptive /></li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
