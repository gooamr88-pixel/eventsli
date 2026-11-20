import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverFetch } from '../../../utils/apiClient';
import { formatMoney } from '../../../utils/money';
import { formatEventTime } from '../../../lib/eventTime';
import { safeExternalUrl } from '../../../utils/safeUrl';
import NavIcon from '../../../components/shell/NavIcon';
import VendorApply from './VendorApply';
import FloorPlanViewer from '../../../components/vendors/floorPlan/FloorPlanViewer';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EVENT'S VENDOR PAGE (2026-11-20) — "Become a vendor", and the list of
 * vendors who will be there.
 *
 * Exists while the organizer has it switched on. Before the deadline it shows
 * the spaces and the application form; after it, the form closes and the page
 * stays up as the vendor directory. Applying is not booking: the organizer
 * reviews, offers a space, and the vendor accepts and pays from their account.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const revalidate = 60;

async function load(slug) {
  try {
    return await serverFetch(`/public/events/${encodeURIComponent(slug)}/vendors`, { tags: [`event:${slug}`], revalidate: 60 });
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) return { title: 'Vendors', robots: { index: false, follow: false } };
  return {
    title: `Vendors at ${page.event.title}`,
    description: page.intro?.slice(0, 160) || `Vendor spaces and vendors at ${page.event.title}.`,
  };
}

export default async function VendorPage({ params }) {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) notFound();
  const { event, booths, vendors } = page;
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
          <p className="es-sppub__eyebrow"><NavIcon name="store" size={16} />Vendors</p>
          <h1 className="es-sppub__title">{page.headline || `Be a vendor at ${event.title}`}</h1>
          <p className="es-sppub__event">
            <b>{event.title}</b>
            <span>{formatEventTime(event.startsAt, event.timezone)}</span>
            {where && <span>{where}</span>}
            {event.organizerName && <span>By {event.organizerName}</span>}
          </p>
          {page.intro && <p className="es-sppub__intro">{page.intro}</p>}
          <div className="fx-row gap-2">
            {page.acceptingApplications
              ? <a href="#vendor-apply" className="es-btn es-btn--primary es-btn--lg">Apply for a space</a>
              : <span className="es-pill">Applications closed</span>}
            {vendors.length > 0 && <a href="#vendor-list" className="es-btn es-btn--secondary es-btn--lg">See the vendors</a>}
          </div>
          {page.acceptingApplications && page.applicationsCloseAt && (
            <p className="text-sm text-muted mt-2">Applications close {formatEventTime(page.applicationsCloseAt, event.timezone, { time: false })}.</p>
          )}
        </div>
      </header>

      {page.acceptingApplications && booths.length > 0 && (
        <section aria-labelledby="vd-spaces" className="fx-stack">
          <h2 id="vd-spaces" className="es-lp-title es-lp-title--bar">Spaces</h2>
          <ul className="es-sp-packages es-sp-packages--public">
            {booths.map((b) => (
              <li key={b.id} className={`es-sp-package ${b.soldOut ? 'is-off' : ''}`}>
                <div className="es-sp-package__head">
                  {b.sizeLabel && <span className="es-pill">{b.sizeLabel}</span>}
                  {b.soldOut
                    ? <span className="es-pill">Fully booked</span>
                    : b.remaining !== null && b.remaining <= 3 && <span className="es-pill es-pill--warning">{b.remaining} left</span>}
                </div>
                <h3 className="es-sp-package__name">{b.name}</h3>
                <p className="es-sp-package__price es-nums">{b.priceCents === 0 ? 'Free' : formatMoney(b.priceCents, event.currency)}</p>
                {b.description && <p className="text-sm text-muted">{b.description}</p>}
                <ul className="es-sp-benefits">
                  <li><NavIcon name="users" size={16} />{b.staffPasses} staff {b.staffPasses === 1 ? 'pass' : 'passes'}</li>
                  {b.includes.map((x) => <li key={x}><NavIcon name="check" size={16} />{x}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {page.floorPlan && (
        <section id="floor-plan" aria-labelledby="vd-plan" className="fx-stack">
          <h2 id="vd-plan" className="es-lp-title es-lp-title--bar">Floor plan</h2>
          <p className="text-muted">Tap a booth to see who is there{page.acceptingApplications ? ', or what is still free' : ''}.</p>
          <FloorPlanViewer floorPlan={page.floorPlan} currency={event.currency} title={`${event.title} floor plan`} />
        </section>
      )}

      {vendors.length > 0 && (
        <section id="vendor-list" aria-labelledby="vd-list" className="fx-stack">
          <h2 id="vd-list" className="es-lp-title es-lp-title--bar">Vendors at this event</h2>
          <ul className="es-vd-directory">
            {vendors.map((v) => {
              const link = safeExternalUrl(v.website);
              return (
                <li key={v.id} className="es-vd-card">
                  {v.logoUrl
                    // eslint-disable-next-line @next/next/no-img-element -- a vendor's logo, from storage
                    ? <img src={v.logoUrl} alt="" className="es-vd-card__logo" />
                    : <span className="es-vd-card__initial" aria-hidden="true">{v.name.slice(0, 1).toUpperCase()}</span>}
                  <div className="fx-min0">
                    <p className="es-vd-card__name fx-break">{v.name}</p>
                    <p className="es-vd-card__meta">{[v.category, v.booth ? `Booth ${v.booth}` : null].filter(Boolean).join(' · ')}</p>
                    {v.description && <p className="text-sm text-muted fx-break">{v.description}</p>}
                    {link && <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="es-vd-card__link">Website<NavIcon name="external" size={14} /></a>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {page.acceptingApplications && (
        <section id="vendor-apply" aria-labelledby="vd-apply" className="es-sppub__inquiry">
          <div className="fx-min0">
            <h2 id="vd-apply" className="es-lp-title es-lp-title--bar">Apply for a space</h2>
            <p className="text-muted">
              Tell {event.organizerName || 'the organizer'} about your business. If they offer you a space you will get an
              email to accept it and pay the booth fee on Eventsli.
            </p>
          </div>
          <Suspense fallback={null}>
            <VendorApply
              slug={event.slug}
              categories={page.categories}
              questions={page.questions}
              booths={booths.filter((b) => !b.soldOut).map((b) => ({ id: b.id, name: b.name }))}
            />
          </Suspense>
        </section>
      )}
    </main>
  );
}
