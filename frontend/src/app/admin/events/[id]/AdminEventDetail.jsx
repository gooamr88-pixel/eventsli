'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useApi } from '../../../hooks/useApi';
import InvoiceStatus from '../../../components/ui/InvoiceStatus';
import { formatMoney } from '../../../utils/money';
import { formatEventTime } from '../../../lib/eventTime';
import { Loading, ErrorNotice, Notice } from '../../../components/Feedback';
import { PageHeader, StatCard, Panel } from '../../../components/ui/Page';
import DataTable from '../../../components/ui/DataTable';
import { percent } from '../../../components/charts/chartMath';
import StatusPill from '../../../organizer/StatusPill';
import EventControls from './EventControls';
import EventRules from './EventRules';
import FeeEditor from './FeeEditor';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One event, from the admin's side (BRD §19): where it stands, how it is
 * selling, and every control an admin holds over it — status (including the
 * cancellation only an admin may make, BRD §17), purchase rules, fees, tax and
 * commission, and the scanner.
 *
 * Every time on the page is on the event's own clock, with the zone named.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AdminEventDetail({ eventId }) {
  const { data, error, loading, reload } = useApi(`/admin/events/${eventId}`);

  if (error) {
    return <ErrorNotice error={error} onRetry={reload} action={{ href: '/admin/events', label: 'Back to all events' }} />;
  }
  if (loading && !data) return <Loading variant="stats" rows={4} label="Loading the event" />;

  const { event, organizer, stats, gate, invoices, door, tiers = [], seating } = data;
  const { issued = 0, admitted = 0 } = stats?.admissions || {};
  const checkedIn = percent(admitted, issued);

  return (
    <div className="fx-stack">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/admin/events" className="hover:text-ink">All events</Link>
        <span aria-hidden> / </span>
        <span className="text-ink" aria-current="page">{event.title}</span>
      </nav>

      <PageHeader
        eyebrow={organizer?.name}
        title={event.title}
        lede={`${formatEventTime(event.startsAt, event.timezone)} · ${event.country} · ${event.currency}`}
        actions={(
          <>
            <StatusPill status={event.status} />
            {event.status === 'published' && (
              <a href={`/e/${event.slug}`} target="_blank" rel="noreferrer" className="es-btn es-btn--secondary es-btn--sm">
                Public page <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </>
        )}
      />

      {event.status === 'cancelled' && (
        <Notice title="Cancelled">
          {event.cancelledReason && <p>{event.cancelledReason}</p>}
          <p>Terminal. Sold tickets stay on record and buyers can still see them.</p>
        </Notice>
      )}
      {event.status === 'suspended' && event.suspendedReason && (
        <Notice tone="warning" title="Suspended">
          <p>{event.suspendedReason}</p>
        </Notice>
      )}
      {event.status === 'rejected' && event.review?.rejectionReason && (
        <Notice tone="warning" title="Sent back to the organizer">
          <p>{event.review.rejectionReason}</p>
        </Notice>
      )}

      {stats && (
        <div className="es-statgrid">
          <StatCard label="Sales" value={formatMoney(stats.grossCents, stats.currency)} note={`${stats.orders} orders`} icon="money" />
          <StatCard label="Commission" value={formatMoney(stats.commissionCents, stats.currency)} note="Earned on this event" icon="percent" />
          <StatCard label="Tickets" value={stats.tickets} note={`${stats.byChannel?.manual?.orders ?? 0} door orders`} icon="ticket" />
          <StatCard label="Checked in" value={checkedIn === null ? '—' : `${checkedIn}%`} note={`${admitted} of ${issued}`} icon="scan" />
        </div>
      )}

      <div className="grid gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <EventControls event={event} gate={gate} overrideUntil={data.scannerOverrideUntil} onChanged={reload} />

        <Panel title="Organizer">
          {organizer ? (
            <dl className="fx-stack fx-stack--sm text-sm">
              <Fact term="Name" value={organizer.name} />
              <Fact term="Owner" value={organizer.owner?.email || '—'} />
              <Fact term="Payouts" value={organizer.canReceivePayouts ? 'Can be paid' : 'Payouts not set up'} />
              <Fact term="Standing" value={organizer.isBanned ? 'Banned from selling' : 'Active'} />
              <Fact term="Door team" value={`${door.staff} people · ${door.devices} devices`} />
            </dl>
          ) : <p className="text-sm text-muted">No organizer found.</p>}
          {organizer && (
            <Link href={`/admin/events?organizerId=${organizer.id}`} className="text-sm text-accent">
              Their other events
            </Link>
          )}
        </Panel>
      </div>

      <Preview event={event} tiers={tiers} seating={seating} />

      <div className="grid gap-[var(--fx-gap)] lg:grid-cols-2">
        <EventRules event={event} onSaved={reload} />
        <FeeEditor event={event} onSaved={reload} />
      </div>

      <section className="fx-stack fx-stack--sm">
        <h2 className="text-lg text-ink">Commission invoices</h2>
        {!invoices.length ? (
          <p className="text-sm text-muted">None. Invoices are raised only for door sales.</p>
        ) : (
          <DataTable
            caption="Commission invoices"
            rows={invoices}
            columns={[
              { key: 'number', label: 'Invoice', primary: true, render: (i) => <span className="font-mono">{i.number}</span> },
              { key: 'status', label: 'Status', render: (i) => <InvoiceStatus invoice={i} /> },
              // On the event's clock: the gate locks at that moment at the venue.
              { key: 'due', label: 'Due', render: (i) => formatEventTime(i.dueAt, event.timezone) },
              {
                key: 'amount',
                label: 'Amount',
                align: 'end',
                render: (i) => <span className="es-nums">{formatMoney(i.amountCents, i.currency)}</span>,
              },
            ]}
          />
        )}
        <Link href="/admin/invoices" className="text-sm text-accent">Settle invoices</Link>
      </section>
    </div>
  );
}

/**
 * What is about to go on sale (BRD §16).
 *
 * The queue's only preview was the public page, which 404s for any event that
 * is not yet published — so an admin approved a description, prices and a seat
 * map they had no way to look at. This is the part a reviewer is reviewing.
 */
function Preview({ event, tiers, seating }) {
  const ticketed = event.listingType !== 'display_only';
  return (
    <Panel title="What goes on sale">
      <div className="grid gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="fx-stack fx-stack--sm">
          <dl className="fx-stack fx-stack--sm text-sm">
            <Fact term="Venue" value={[event.venue?.name, event.venue?.address].filter(Boolean).join(', ') || 'Not given'} />
            <Fact term="Ends" value={formatEventTime(event.endsAt, event.timezone)} />
            <Fact term="Type" value={ticketed ? 'Sells tickets' : 'Listing only'} />
          </dl>
          {event.description
            ? <p className="fx-break max-w-[65ch] whitespace-pre-line text-sm text-muted">{event.description}</p>
            : <p className="text-sm text-subtle">No description.</p>}
        </div>
        {event.cover?.url ? (
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg bg-bg-sunken">
            <Image src={event.cover.url} alt="" fill sizes="(max-width: 1024px) 100vw, 420px" className="object-cover" />
          </div>
        ) : (
          <p className="text-sm text-subtle">No cover image.</p>
        )}
      </div>

      {ticketed && (
        <>
          {tiers.length === 0 ? (
            <Notice tone="warning" title="No ticket types.">
              <p>Every seat would resolve to a price of zero.</p>
            </Notice>
          ) : (
            <DataTable
              caption="Ticket types"
              rows={tiers}
              columns={[
                { key: 'name', label: 'Ticket type', primary: true, render: (t) => <span className="fx-break text-ink">{t.name}</span> },
                { key: 'price', label: 'Price', align: 'end', render: (t) => <span className="es-nums">{formatMoney(t.priceCents, event.currency)}</span> },
                { key: 'quantity', label: 'Allocation', align: 'end', render: (t) => (t.quantity === null ? 'Seat map' : <span className="es-nums">{t.soldCount} of {t.quantity}</span>) },
              ]}
            />
          )}

          {seating ? (
            <p className="text-sm text-muted">
              Seat map: <span className="es-nums text-ink">{seating.tables}</span> tables
              {seating.privateTables > 0 && ` (${seating.privateTables} private)`},{' '}
              <span className="es-nums text-ink">{seating.seats}</span> seats.
            </p>
          ) : (
            <p className="text-sm text-subtle">No seat map yet.</p>
          )}
          {seating?.unpricedSeats > 0 && (
            <Notice tone="warning" title={`${seating.unpricedSeats} seats would sell for nothing.`}>
              <p>They have no ticket type with a price and no price of their own. Ask for changes unless the event is meant to be free.</p>
            </Notice>
          )}
        </>
      )}
    </Panel>
  );
}

function Fact({ term, value }) {
  return (
    <div className="fx-row fx-row--between border-t border-border-base pt-2 first:border-0 first:pt-0">
      <dt className="text-muted">{term}</dt>
      <dd className="fx-break text-right text-ink">{value}</dd>
    </div>
  );
}
