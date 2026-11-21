import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventForViewer, privateMetadata } from '../../../lib/eventAccess';
import PrivateEventGate from '../PrivateEventGate';
import { formatMoney } from '../../../utils/money';
import { formatEventTime } from '../../../lib/eventTime';
import NavIcon from '../../../components/shell/NavIcon';
import { levelLabel } from '../../../components/sponsors/sponsorUi';
import SponsorInquiry from './SponsorInquiry';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "BECOME A SPONSOR" (2026-11-20) — an event's public sponsorship page.
 *
 * Exists only while the organizer has it switched on (the API answers 404
 * otherwise). Shows who comes, the packages with what each includes and what
 * is left, the sponsors already on board, and a short inquiry form that lands
 * in the organizer's Leads. No price is a checkout here: a sponsorship is
 * agreed by proposal and signature, then paid from the sponsor portal.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const revalidate = 60;

/**
 * The page's data, or `{ locked }` for a private event this visitor has not
 * unlocked (2026-11-22; lib/eventAccess.js) — the password gate stands here.
 */
async function load(slug) {
  const { data, locked } = await loadEventForViewer(slug, { path: '/sponsorship' });
  return { page: data, locked };
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const { page, locked } = await load(slug);
  if (locked) return privateMetadata(locked.title);
  if (!page) return { title: 'Sponsorship', robots: { index: false, follow: false } };
  return {
    title: `Sponsor ${page.event.title}`,
    description: page.intro?.slice(0, 160) || `Sponsorship packages for ${page.event.title}.`,
  };
}

export default async function SponsorPage({ params }) {
  const { slug } = await params;
  const { page, locked } = await load(slug);
  if (locked) return <PrivateEventGate event={locked} />;
  if (!page) notFound();
  const { event, packages, sponsors } = page;
  const currency = event.currency;
  const where = [event.venueName, event.city].filter(Boolean).join(', ');

  return (
    <main className="es-sppub fx-container fx-container--lg">
      <Link href={`/e/${event.slug}`} className="es-sp-back"><NavIcon name="arrow" size={16} />Back to the event</Link>

      <header className="es-sppub__hero">
        {event.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- the event's poster, from storage
          <img src={event.coverUrl} alt="" className="es-sppub__cover" />
        )}
        <div className="fx-min0">
          <p className="es-sppub__eyebrow"><NavIcon name="handshake" size={16} />Sponsorship</p>
          <h1 className="es-sppub__title">{page.headline || `Sponsor ${event.title}`}</h1>
          <p className="es-sppub__event">
            <b>{event.title}</b>
            <span>{formatEventTime(event.startsAt, event.timezone)}</span>
            {where && <span>{where}</span>}
            {event.organizerName && <span>By {event.organizerName}</span>}
          </p>
          {page.intro && <p className="es-sppub__intro">{page.intro}</p>}
          <a href="#sponsor-inquiry" className="es-btn es-btn--primary es-btn--lg">Ask about sponsoring</a>
        </div>
      </header>

      {packages.length > 0 && (
        <section aria-labelledby="sp-packages" className="fx-stack">
          <h2 id="sp-packages" className="es-lp-title es-lp-title--bar">Packages</h2>
          <ul className="es-sp-packages es-sp-packages--public">
            {packages.map((p) => (
              <li key={p.id} className={`es-sp-package ${p.soldOut ? 'is-off' : ''}`} data-level={p.level}>
                <div className="es-sp-package__head">
                  <span className="es-sp-level" data-level={p.level}>{levelLabel(p.level)}</span>
                  {p.soldOut
                    ? <span className="es-pill">Taken</span>
                    : p.remaining !== null && p.remaining <= 3 && <span className="es-pill es-pill--warning">{p.remaining} left</span>}
                </div>
                <h3 className="es-sp-package__name">{p.name}</h3>
                <p className="es-sp-package__price es-nums">{p.priceCents === 0 ? 'In kind' : formatMoney(p.priceCents, currency)}</p>
                {p.description && <p className="text-sm text-muted">{p.description}</p>}
                {p.benefits.length > 0 && (
                  <ul className="es-sp-benefits">
                    {p.benefits.map((b) => <li key={b}><NavIcon name="check" size={16} />{b}</li>)}
                  </ul>
                )}
                {!p.soldOut && (
                  <a href={`?package=${p.id}#sponsor-inquiry`} className="es-btn es-btn--secondary mt-auto">Ask about {p.name}</a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sponsors.length > 0 && (
        <section aria-labelledby="sp-onboard" className="fx-stack fx-stack--sm">
          <h2 id="sp-onboard" className="es-lp-title es-lp-title--bar">Already on board</h2>
          <ul className="es-sppub__logos">
            {sponsors.map((s) => (
              <li key={`${s.level}-${s.name}`} title={s.name}>
                {s.logoUrl
                  // eslint-disable-next-line @next/next/no-img-element -- a sponsor's logo, from storage
                  ? <img src={s.logoUrl} alt={s.name} />
                  : <span>{s.name}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="sponsor-inquiry" aria-labelledby="sp-inquiry" className="es-sppub__inquiry">
        <div className="fx-min0">
          <h2 id="sp-inquiry" className="es-lp-title es-lp-title--bar">Ask about sponsoring</h2>
          <p className="text-muted">
            Tell {event.organizerName || 'the organizer'} who you are and what you have in mind. They reply directly,
            and if you agree on a sponsorship you receive a proposal to read, sign and pay on Eventsli.
          </p>
        </div>
        {/* Suspense: the form reads ?package= from the address, and this page is cached. */}
        <Suspense fallback={null}>
          <SponsorInquiry slug={event.slug} packages={packages.filter((p) => !p.soldOut).map((p) => ({ id: p.id, name: p.name }))} />
        </Suspense>
      </section>
    </main>
  );
}
