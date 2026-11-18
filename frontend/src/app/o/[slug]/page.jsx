import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverFetch } from '../../utils/apiClient';
import { jsonLdScript } from '../../utils/jsonLd';
import { siteOrigin } from '../../lib/eventSeo';
import EventCard from '../../components/EventCard';
import NavIcon from '../../components/shell/NavIcon';
import ShareProfile from './ShareProfile';

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


/** A few words for a stat tile: "1 event" / "3 events". */
const events = (n) => `${n} ${n === 1 ? 'event' : 'events'}`;

export default async function OrganizerPage({ params }) {
  const { slug } = await params;
  const page = await loadProfile(slug);
  if (!page) notFound();

  const { organizer, stats, upcoming, past } = page;
  const { contact, social } = organizer;
  const url = `${siteOrigin()}/o/${organizer.slug}`;
  const since = organizer.memberSince ? new Date(organizer.memberSince).getFullYear() : null;
  const site = contact.website ? contact.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
  const where = organizer.country ? regionName(organizer.country) : null;
  // The cover band: their soonest event's poster, blurred — the page opens on
  // their own artwork. With none, the brand gradient.
  const backdrop = upcoming.find((e) => e.coverUrl)?.coverUrl || past.find((e) => e.coverUrl)?.coverUrl || null;
  const hasContact = Boolean(contact.email || contact.phone || site);

  return (
    <main className="es-orgp">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(organizationJsonLd(organizer)) }} />

      <div className="es-orgp__cover" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- decoration, from our storage */}
        {backdrop && <img src={backdrop} alt="" className="es-orgp__cover-img" />}
      </div>

      <div className="fx-gutter">
        <div className="fx-container fx-container--xl">
          {/* ── Who they are ─────────────────────────────────────────────── */}
          <header className="es-orgp__head">
            <span className="es-orgp__logo" aria-hidden="true">
              {organizer.logoUrl
                // eslint-disable-next-line @next/next/no-img-element -- the organizer's own logo, from our storage
                ? <img src={organizer.logoUrl} alt="" />
                : <span>{organizer.name.slice(0, 1).toUpperCase()}</span>}
            </span>

            <div className="es-orgp__id fx-min0">
              <p className="es-orgp__kicker">Event organizer</p>
              <h1 className="es-orgp__name fx-break">{organizer.name}</h1>
              <p className="es-orgp__meta">
                {where && <span><NavIcon name="pin" size={15} /> {where}</span>}
                {since && <span><NavIcon name="calendar" size={15} /> On Eventsli since {since}</span>}
              </p>
            </div>

            <div className="es-orgp__actions">
              {contact.email && (
                <a className="es-btn es-btn--primary" href={`mailto:${contact.email}`}>
                  <NavIcon name="mail" size={16} /> Contact
                </a>
              )}
              {site && (
                <a className="es-btn es-btn--secondary" href={contact.website} target="_blank" rel="noopener noreferrer">
                  <NavIcon name="globe" size={16} /> Website
                </a>
              )}
              <ShareProfile name={organizer.name} url={url} />
            </div>
          </header>

          <ul className="es-orgp__stats" aria-label="At a glance">
            <li><b>{stats.upcoming}</b><span>Upcoming</span></li>
            <li><b>{stats.past}</b><span>Past {stats.past === 1 ? 'event' : 'events'}</span></li>
            <li><b>{stats.upcoming + stats.past}</b><span>Hosted on Eventsli</span></li>
          </ul>

          {/* ── Their events, and about them ─────────────────────────────── */}
          <div className="es-orgp__body">
            <div className="es-orgp__main">
              <section aria-labelledby="org-upcoming" className="es-orgp__section">
                <div className="es-orgp__sechead">
                  <h2 id="org-upcoming" className="es-orgp__h2">Upcoming events</h2>
                  <span className="es-orgp__count">{events(stats.upcoming)}</span>
                </div>
                {upcoming.length ? (
                  <ul className="es-ev-results">
                    {upcoming.map((event, i) => (
                      <li key={event.id}><EventCard event={event} priority={i < 2} headingLevel={3} adaptive /></li>
                    ))}
                  </ul>
                ) : (
                  <div className="es-orgp__empty">
                    <span className="es-orgp__empty-icon"><NavIcon name="calendar" size={22} /></span>
                    <div>
                      <p className="es-orgp__empty-title">Nothing on sale right now</p>
                      <p>New dates are announced here first. <Link href="/events">Browse what else is on</Link>.</p>
                    </div>
                  </div>
                )}
              </section>

              {past.length > 0 && (
                <section aria-labelledby="org-past" className="es-orgp__section">
                  <div className="es-orgp__sechead">
                    <h2 id="org-past" className="es-orgp__h2">Past events</h2>
                    <span className="es-orgp__count">{events(stats.past)}</span>
                  </div>
                  <ul className="es-ev-results">
                    {past.map((event) => (
                      <li key={event.id}><EventCard event={event} headingLevel={3} adaptive /></li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <aside className="es-orgp__side" aria-label={`About ${organizer.name}`}>
              {organizer.description && (
                <section className="es-orgp__card">
                  <h2 className="es-orgp__cardtitle">About</h2>
                  <p className="es-orgp__about">{organizer.description}</p>
                </section>
              )}

              {hasContact && (
                <section className="es-orgp__card">
                  <h2 className="es-orgp__cardtitle">Contact</h2>
                  <ul className="es-orgp__rows">
                    {contact.email && (
                      <li><NavIcon name="mail" size={18} /><a href={`mailto:${contact.email}`} className="fx-break">{contact.email}</a></li>
                    )}
                    {contact.phone && (
                      <li><NavIcon name="chat" size={18} /><a href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}>{contact.phone}</a></li>
                    )}
                    {site && (
                      <li><NavIcon name="globe" size={18} /><a href={contact.website} target="_blank" rel="noopener noreferrer" className="fx-break">{site}</a></li>
                    )}
                  </ul>
                </section>
              )}

              {social.length > 0 && (
                <section className="es-orgp__card">
                  <h2 className="es-orgp__cardtitle">Follow</h2>
                  <ul className="es-orgp__social">
                    {social.map((s) => (
                      <li key={s.key}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer">
                          {s.label} <NavIcon name="external" size={13} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="es-orgp__note">
                <NavIcon name="shield" size={15} /> Tickets are sold through Eventsli. {organizer.name} runs the events
                and is who you deal with at the door.
              </p>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
