'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../hooks/useApi';
import { formatMoney } from '../../utils/money';
import { formatDay } from '../../lib/eventTime';
import { PERIODS } from '../../lib/periods';
import { Loading, ErrorNotice } from '../../components/Feedback';
import { PageHeader, StatCard, Panel } from '../../components/ui/Page';
import { Segmented } from '../../components/ui/Filters';
import DataTable from '../../components/ui/DataTable';
import BarChart from '../../components/charts/BarChart';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The platform at a glance (BRD §20): what sold, what Eventsli earned, what
 * organizers owe on the manual channel, and what is waiting on an admin.
 *
 * One request (`/admin/overview`), aggregated in SQL. Money is shown one
 * currency at a time — USD and CAD are never added together. The money cards
 * follow the period switch; the all-time total sits in their notes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Overview() {
  const [days, setDays] = useState(30);
  const [picked, setPicked] = useState(null);
  const { data, error, loading } = useApi(`/admin/overview?days=${days}`);

  if (error) return <ErrorNotice error={error} />;
  if (loading && !data) return <Loading variant="stats" rows={4} label="Loading the overview" />;

  const currencies = [...new Set([
    ...Object.keys(data.sales || {}), ...Object.keys(data.salesInWindow || {}), ...Object.keys(data.receivables || {}),
  ])];
  const currency = picked && currencies.includes(picked) ? picked : (currencies[0] || 'CAD');
  const none = { orders: 0, tickets: 0, grossCents: 0, commissionCents: 0, platformNetCents: 0 };
  const sales = data.sales?.[currency] || none;
  const recent = data.salesInWindow?.[currency] || none;
  const owed = data.receivables?.[currency] || { openCents: 0, overdueCents: 0, overdueCount: 0, uninvoicedCents: 0 };
  const { events = {}, organizers = {}, people = {} } = data;

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Platform"
        title="Overview"
        lede="Sales, commission, and everything waiting on an admin."
        actions={<Segmented label="Period" value={days} onChange={setDays} options={PERIODS} />}
      />

      {currencies.length > 1 && (
        <Segmented
          label="Currency"
          value={currency}
          onChange={setPicked}
          options={currencies.map((c) => ({ value: c, label: c }))}
        />
      )}

      <div className="fx-grid fx-grid--4">
        <StatCard
          label={`Ticket sales, last ${days} days`}
          value={formatMoney(recent.grossCents, currency)}
          note={`${recent.orders} orders · ${formatMoney(sales.grossCents, currency)} all time`}
          icon="money"
        />
        <StatCard
          label={`Commission, last ${days} days`}
          value={formatMoney(recent.commissionCents, currency)}
          note={`${formatMoney(recent.platformNetCents, currency)} kept after card costs, door sales included`}
          icon="percent"
        />
        <StatCard
          label="Waiting for review"
          value={events.pendingReview ?? 0}
          note={events.pendingReview ? 'Nothing sells until approved' : 'The queue is empty'}
          icon="check"
          href="/admin"
        />
        <StatCard
          label="Owed by organizers"
          value={formatMoney(owed.openCents, currency)}
          note={owed.overdueCount
            ? `${owed.overdueCount} overdue — those gates are shut`
            : owed.uninvoicedCents
              ? `${formatMoney(owed.uninvoicedCents, currency)} more on door sales, not invoiced yet`
              : 'Nothing overdue'}
          icon="receipt"
          href="/admin/invoices"
        />
      </div>

      <div className="grid gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title={`Sales per day, last ${days} days (UTC)`}>
          <BarChart
            ariaLabel={`Ticket sales per day in ${currency}`}
            format={(v) => formatMoney(v, currency)}
            data={(data.timeline || []).map((d) => {
              const day = d.byCurrency?.[currency];
              return {
                label: formatDay(d.date),
                value: Number(day?.grossCents || 0),
                detail: day ? `${formatMoney(day.grossCents, currency)} · ${day.orders} orders` : 'No sales',
              };
            })}
          />
        </Panel>

        <Panel title="The platform">
          <dl className="fx-stack fx-stack--sm text-sm">
            <Fact term="Events on sale" value={events.published ?? 0} href="/admin/events?status=published" />
            <Fact term="Suspended" value={events.suspended ?? 0} href="/admin/events?status=suspended" />
            <Fact term="Organizers" value={`${organizers.payoutReady ?? 0} of ${organizers.total ?? 0} can be paid`} href="/admin/organizers" />
            <Fact term="Banned organizers" value={organizers.banned ?? 0} href="/admin/organizers?banned=true" />
            <Fact term="Accounts" value={`${people.total ?? 0} · ${people.newInWindow ?? 0} new`} href="/admin/users" />
            <Fact term="Blocked accounts" value={people.blocked ?? 0} href="/admin/users?blocked=true" />
          </dl>
        </Panel>
      </div>

      <section className="fx-stack fx-stack--sm">
        <h2 className="text-lg text-ink">Top events, last {days} days</h2>
        {!data.topEvents?.length ? (
          <p className="text-sm text-muted">No sales in this period.</p>
        ) : (
          <DataTable
            caption="Top events by sales"
            rowKey={(r) => `${r.id}-${r.currency}`}
            rows={data.topEvents}
            columns={[
              {
                key: 'event',
                label: 'Event',
                primary: true,
                render: (r) => (
                  <Link href={`/admin/events/${r.id}`} className="fx-stack fx-stack--sm gap-0.5 hover:text-accent">
                    <span className="fx-break text-ink">{r.title}</span>
                    <span className="text-sm text-muted">{r.organizer}</span>
                  </Link>
                ),
              },
              { key: 'tickets', label: 'Tickets', align: 'end', render: (r) => <span className="es-nums">{r.tickets}</span> },
              {
                key: 'gross',
                label: 'Sales',
                align: 'end',
                render: (r) => <span className="es-nums">{formatMoney(r.grossCents, r.currency)}</span>,
              },
            ]}
          />
        )}
      </section>
    </div>
  );
}

function Fact({ term, value, href }) {
  return (
    <div className="fx-row fx-row--between border-t border-border-base pt-2 first:border-0 first:pt-0">
      <dt className="text-muted">{term}</dt>
      <dd className="es-nums text-ink">
        {href ? <Link href={href} className="hover:text-accent">{value}</Link> : value}
      </dd>
    </div>
  );
}
