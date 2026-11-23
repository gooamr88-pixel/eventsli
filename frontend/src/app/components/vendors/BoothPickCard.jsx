'use client';

import Link from 'next/link';
import NavIcon from '../shell/NavIcon';
import { formatMoney } from '../../utils/money';
import { boothStatus } from '../seating/boothZones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A BOOTH TAPPED ON THE BUYERS' MAP (2026-11-23). The owner: "booth — I can't
 * click on it and cannot buy it as a vendor". Booths on the event map were
 * scenery; now a tap says what the booth is and, while the event is taking
 * vendors and its type is open, offers to book that very spot — the booth's
 * page with the spot already chosen (`?spot=`), where the vendor signs in,
 * adds extras and pays or applies.
 *
 * `book` comes with the public map (seatMapController, vendorService
 * .bookingInfo): { open, mode: 'instant' | 'apply', types: [open type ids] }.
 * The booking is checked again on the server when it starts.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STATUS_TEXT = { sold: 'Booked', held: 'Reserved', blocked: 'Not available' };

export default function BoothPickCard({ zone, boothTypes = [], book = null, slug, currency = 'USD', onClose }) {
  const type = boothTypes.find((t) => t.id === zone.boothTypeId) || null;
  const status = boothStatus(zone, zone.state);
  const free = status === 'available';
  const bookable = free && book?.open && type && book.types?.includes(type.id);
  const code = String(zone.label || '').trim();
  const price = type && type.priceCents !== undefined ? (type.priceCents ? formatMoney(type.priceCents, currency) : 'Free') : null;

  return (
    <section className="es-boothpick" role="status" aria-live="polite" aria-label={`Booth ${code}`}>
      <div className="es-boothpick__head">
        <span className="es-boothpick__icon" aria-hidden="true"><NavIcon name="store" size={20} /></span>
        <div className="fx-min0">
          <p className="es-boothpick__title">{code ? `Booth ${code}` : 'Vendor booth'}</p>
          <p className="text-sm text-muted">
            {[type?.name, type?.sizeLabel, price].filter(Boolean).join(' · ') || 'Vendor booth'}
          </p>
        </div>
        <button type="button" className="es-boothpick__close" onClick={onClose} aria-label="Close">
          <NavIcon name="close" size={16} />
        </button>
      </div>

      <p className="text-sm">
        {zone.state?.vendor
          ? <><b>{zone.state.vendor.name}</b>{zone.state.vendor.category ? ` · ${zone.state.vendor.category}` : ''}</>
          : STATUS_TEXT[status] || 'Available'}
      </p>

      {bookable ? (
        <Link
          href={`/e/${slug}/vendors/booths/${type.id}?spot=${encodeURIComponent(zone.id)}`}
          className="es-btn es-btn--primary es-btn--sm es-boothpick__go"
        >
          <NavIcon name={book.mode === 'instant' ? 'card' : 'send'} size={16} />
          {book.mode === 'instant' ? 'Reserve this booth' : 'Apply for this booth'}
        </Link>
      ) : free && book?.open ? (
        <p className="text-xs text-muted">
          This spot is not open for booking yet.{' '}
          <Link href={`/e/${slug}/vendors`} className="text-accent">See the booths for vendors</Link>
        </p>
      ) : free ? (
        <p className="text-xs text-muted">This event is not taking vendors right now.</p>
      ) : null}
    </section>
  );
}
