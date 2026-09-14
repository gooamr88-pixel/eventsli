'use client';

import Link from 'next/link';
import { useApi } from '../../../hooks/useApi';
import { formatMoney } from '../../../utils/money';
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
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AdminEventDetail({ eventId }) {
  const { data, error, loading, reload } = useApi(`/admin/events/${eventId}`);

  if (error) {
    return <ErrorNotice error={error} action={{ href: '/admin/events', label: 'Back to all events' }} />;
  }
  if (loading && !data) return <Loading variant="stats" rows={4} label="Loading the event" />;

  const { event, organizer, stats, gate, invoices, door } = data;
  const { issued = 0, admitted = 0 } = stats?.admissions || {};
  const checkedIn = percent(admitted, issued);

  return (
    <div className="fx-stack">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/admin/events" className="hover:text-ink">All events</Link>
        <span aria-hidden> / </span>
        <span className="text-ink">{event.title}</span>
      </nav>

      <PageHeader
        eyebrow={organizer?.name}
        title={event.title}
        lede={`${new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: event.timezone })
          .format(new Date(event.startsAt))} · ${event.country} · ${event.currency}`}
        actions={(
          <>
            <StatusPill status={event.status} />
            {event.status === 'published' && (
              <a href={`/e/${event.slug}`} target="_blank" rel="noreferrer" className="es-btn es-btn--secondary es-btn--sm">
                Public page
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
        <div className="fx-grid fx-grid--4">
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
              <Fact term="Payouts" value={organizer.canReceivePayouts ? 'Ready' : 'Not set up'} />
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
              { key: 'status', label: 'Status', render: (i) => <span className="es-pill">{i.status}</span> },
              {
                key: 'due',
                label: 'Due',
                render: (i) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(i.dueAt)),
              },
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

function Fact({ term, value }) {
  return (
    <div className="fx-row fx-row--between border-t border-border-base pt-2 first:border-0 first:pt-0">
      <dt className="text-muted">{term}</dt>
      <dd className="fx-break text-right text-ink">{value}</dd>
    </div>
  );
}
