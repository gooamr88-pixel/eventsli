import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverFetch } from '../../../utils/apiClient';
import { formatMoney } from '../../../utils/money';
import { formatEventTime } from '../../../lib/eventTime';
import { safeExternalUrl } from '../../../utils/safeUrl';
import NavIcon from '../../../components/shell/NavIcon';
import FloorPlanViewer from '../../../components/vendors/floorPlan/FloorPlanViewer';
import VendorShowcase from '../../../components/vendors/booking/VendorShowcase';
import BoothCard from '../../../components/vendors/booking/BoothCard';
import StartBooking from './StartBooking';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EVENT'S VENDOR PAGE (2026-11-20; rebuilt to the owner's reference
 * 2026-11-21).
 *
 *   the invitation   headline, photos, the organizer's numbers, two buttons
 *   booths           a card per booth type, each opening its booth page —
 *                    where add-ons are chosen and the booking starts
 *   floor plan       who is where, and what is still free
 *   vendors          the businesses already booked
 *
 * How a booking ends is the organizer's choice (program.bookingMode):
 * "instant" reserves and pays, "apply" sends an application to review. The
 * steps before that are the same, so this page only changes its words.
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
    description: page.intro?.slice(0, 160) || `Booths, add-ons and vendors at ${page.event.title}.`,
  };
}

/** What we know for certain, for the numbers card when the organizer set none. */
function facts(booths, currency) {
  const open = booths.filter((b) => !b.soldOut);
  const out = [];
  if (booths.length) out.push({ value: String(booths.length), label: booths.length === 1 ? 'kind of booth to choose from.' : 'kinds of booth to choose from.' });
  const left = open.every((b) => b.remaining !== null) ? open.reduce((s, b) => s + b.remaining, 0) : null;
  if (left !== null && booths.length) out.push({ value: String(left), label: left === 1 ? 'space still available.' : 'spaces still available.' });
  const prices = open.map((b) => b.priceCents);
  if (prices.length) {
    const low = Math.min(...prices);
    out.push({ value: low === 0 ? 'Free' : formatMoney(low, currency), label: low === 0 ? 'spaces are available.' : 'is where booths start.' });
  }
  return out.slice(0, 2);
}

export default async function VendorPage({ params }) {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) notFound();
  const { event, booths, vendors } = page;
  const instant = page.bookingMode === 'instant';
  const where = [event.venueName, event.city].filter(Boolean).join(', ');
  const photos = page.photos?.length ? page.photos : [event.coverUrl, ...booths.map((b) => b.imageUrl)].filter(Boolean).slice(0, 3);
  const open = page.acceptingApplications;

  return (
    <main className="es-vb-page fx-container fx-container--lg">
      <nav aria-label="Breadcrumb" className="es-co__crumbs">
        <Link href="/events">Events</Link>
        <span aria-hidden>/</span>
        <Link href={`/e/${event.slug}`} className="fx-truncate">{event.title}</Link>
        <span aria-hidden>/</span>
        <span aria-current="page" className="es-co__crumbs-here">Vendors</span>
      </nav>

      <VendorShowcase
        as="h1"
        id="vb-title"
        headline={page.headline}
        intro={page.intro}
        photos={photos}
        highlights={page.highlights || []}
        facts={facts(booths, event.currency)}
        secondary={vendors.length ? { href: '#vendor-list', label: 'Meet the vendors' } : open ? { href: '#booths', label: 'Become a vendor' } : null}
        primary={open && booths.length ? { href: '#booths', label: instant ? 'Reserve your booth' : 'Apply for a booth' } : null}
      />

      <p className="es-vb-eventline">
        <span><NavIcon name="calendar" size={16} />{formatEventTime(event.startsAt, event.timezone)}</span>
        {where && <span><NavIcon name="pin" size={16} />{where}</span>}
        {event.organizerName && <span><NavIcon name="tag" size={16} />By {event.organizerName}</span>}
        {open && page.applicationsCloseAt && (
          <span><NavIcon name="clock" size={16} />{instant ? 'Booking' : 'Applications'} close {formatEventTime(page.applicationsCloseAt, event.timezone, { time: false })}</span>
        )}
        {!open && <span className="es-pill">{instant ? 'Booking closed' : 'Applications closed'}</span>}
      </p>

      {open && booths.length > 0 && (
        <section id="booths" aria-labelledby="vb-booths" className="es-vb-section">
          <div className="es-vb-section__head">
            <h2 id="vb-booths" className="es-vb-h2">Booths</h2>
            <p className="es-vb-sub">
              {instant
                ? `Choose a booth, add what you need, and reserve it — it is held for you for ${page.holdMinutes || 20} minutes while you finish.`
                : 'Choose a booth and add what you need, then send your application. The organizer reviews it and replies by email.'}
            </p>
          </div>
          <ul className="es-vb-booths">
            {booths.map((b) => <BoothCard key={b.id} booth={b} slug={event.slug} currency={event.currency} />)}
          </ul>
        </section>
      )}

      {open && !instant && (
        <div className="es-vb-nobooth">
          <p><b>Not sure which booth?</b> Apply without choosing one — the organizer will offer the right space.</p>
          <StartBooking slug={event.slug} label="Apply without a booth" className="es-btn es-btn--secondary" />
        </div>
      )}

      {page.floorPlan && (
        <section id="floor-plan" aria-labelledby="vd-plan" className="es-vb-section">
          <div className="es-vb-section__head">
            <h2 id="vd-plan" className="es-vb-h2">Floor plan</h2>
            <p className="es-vb-sub">Tap a booth to see who is there{open ? ', or what is still free' : ''}.</p>
          </div>
          <FloorPlanViewer floorPlan={page.floorPlan} currency={event.currency} title={`${event.title} floor plan`} />
        </section>
      )}

      {vendors.length > 0 && (
        <section id="vendor-list" aria-labelledby="vd-list" className="es-vb-section">
          <div className="es-vb-section__head">
            <h2 id="vd-list" className="es-vb-h2">Vendors at this event</h2>
          </div>
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
    </main>
  );
}
