'use client';

import Link from 'next/link';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import { useApi } from '../../hooks/useApi';
import { SectionHeader } from '../../components/ui/Page';
import NavIcon from '../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../components/Feedback';
import { VendorStatus } from '../../components/vendors/vendorUi';

/**
 * THE VENDOR'S SIDE (2026-11-20): every vendor application made with this
 * account's address (or for a company it belongs to). Each opens on its own
 * page to accept an offer, pay the booth fee and name staff for the door.
 */
export default function MyVendorBookings() {
  const { data, error, reload } = useApi('/partner/vendors');
  return (
    <div className="fx-stack">
      <SectionHeader icon="store" title="Vendor bookings" lede="Your applications to sell at events, and the spaces you have booked." />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : !data ? <Loading variant="card" label="Loading your vendor bookings" /> : data.length === 0 ? (
        <div className="es-sp-empty">
          <NavIcon name="store" size={36} />
          <p className="es-sp-empty__title">No vendor bookings yet</p>
          <p className="text-sm text-muted">When you apply to be a vendor at an event, or an organizer offers you a space, it appears here.</p>
        </div>
      ) : (
        <ul className="es-sp-mine">
          {data.map((a) => {
            // A draft or a booth being reserved is finished on the event's booking page (2026-11-21).
            const unfinished = ['draft', 'held'].includes(a.stage) && a.event?.slug;
            const action = unfinished ? (a.stage === 'held' ? 'Finish booking' : 'Finish application')
              : a.status === 'offered' && !a.expired ? 'Review and accept'
              : a.status === 'confirmed' && a.amountCents > 0 ? 'Pay booth fee' : 'Open';
            return (
              <li key={a.id}>
                <Link href={unfinished ? `/e/${a.event.slug}/vendors/book/${a.id}` : `/account/vendors/${a.id}`} className="es-sp-mine__item">
                  {a.event?.coverUrl
                    // eslint-disable-next-line @next/next/no-img-element -- the event's poster
                    ? <img src={a.event.coverUrl} alt="" className="es-sp-mine__cover" />
                    : <span className="es-sp-mine__cover es-sp-mine__cover--blank" aria-hidden="true"><NavIcon name="calendar" size={24} /></span>}
                  <span className="fx-min0 fx-stack fx-stack--sm gap-1">
                    <span className="es-sp-mine__title fx-break">{a.event?.title || 'Event'}</span>
                    <span className="text-sm text-muted">
                      {a.businessName}
                      {a.event?.startsAt ? ` · ${formatEventTime(a.event.startsAt, a.event.timezone, { time: false })}` : ''}
                    </span>
                    <span className="fx-row gap-2 items-center">
                      <VendorStatus status={a.status} self expired={a.expired} />
                      {a.boothName && <span className="text-sm">{a.boothName}{a.boothLabel ? ` · Booth ${a.boothLabel}` : ''}</span>}
                      {['offered', 'confirmed', 'paid'].includes(a.status) && <b className="es-nums text-sm">{a.amountCents > 0 ? formatMoney(a.amountCents, a.currency) : 'Free'}</b>}
                    </span>
                  </span>
                  <span className="es-sp-mine__go">{action}<NavIcon name="arrow" size={16} /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
