'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useOrganizer } from '../../hooks/useOrganizer';
import { useApi } from '../../hooks/useApi';
import { formatMoney } from '../../utils/money';
import { Loading, ErrorNotice } from '../../components/Feedback';
import { PageHeader, StatCard, Panel } from '../../components/ui/Page';
import { Segmented } from '../../components/ui/Filters';
import BarChart from '../../components/charts/BarChart';
import { percent } from '../../components/charts/chartMath';
import CreateProfile from '../CreateProfile';
import OrganizerNotices from '../OrganizerNotices';
import { Attention, Upcoming, RecentOrders } from './DashboardPanels';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The organizer's home: how everything is selling, and what needs them.
 *
 * It opened on a flat list of event titles before, so "how is it selling" — the
 * question anyone opens a dashboard to ask — was a click per event away. Now it
 * is one request (`/organizer/dashboard`), aggregated in SQL, and every figure
 * on the page is the API's.
 *
 * Money is shown ONE CURRENCY AT A TIME. An organizer with a Toronto event and a
 * Denver event has CAD and USD, and a single "revenue" number adding the two is
 * wrong in both. When there are two, a switch picks which one the page shows.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const WINDOWS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

export default function Dashboard() {
  const { loading, organizer, error, refresh } = useOrganizer();
  const [days, setDays] = useState(30);
  const [picked, setPicked] = useState(null);
  const stats = useApi(organizer ? `/organizer/dashboard?days=${days}` : null);

  if (loading) return <Loading variant="stats" rows={4} label="Loading your dashboard" />;
  if (error) return <ErrorNotice error={error} />;
  if (!organizer) return <CreateProfile onCreated={refresh} />;

  const data = stats.data;
  const currencies = Object.keys(data?.sales || {});
  const fallback = organizer.country === 'US' ? 'USD' : 'CAD';
  const currency = picked && currencies.includes(picked) ? picked : (currencies[0] || fallback);
  const sales = data?.sales?.[currency] || { orders: 0, tickets: 0, grossCents: 0, netCents: 0 };
  const { issued = 0, admitted = 0 } = data?.admissions || {};
  const checkedIn = percent(admitted, issued);

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow={organizer.displayName}
        title="Dashboard"
        lede="How your events are selling, and what needs you next."
        actions={(
          <Link href="/organizer/events/new" className="es-btn es-btn--primary">Create event</Link>
        )}
      />

      <OrganizerNotices organizer={organizer} />

      {stats.error ? (
        <ErrorNotice error={stats.error} />
      ) : !data ? (
        <Loading variant="stats" rows={4} label="Loading your numbers" />
      ) : (
        <>
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
              label="Revenue"
              value={formatMoney(sales.grossCents, currency)}
              note={`${formatMoney(sales.netCents, currency)} to you after commission`}
              icon="money"
            />
            <StatCard
              label="Tickets sold"
              value={sales.tickets}
              note={`${sales.orders} ${sales.orders === 1 ? 'order' : 'orders'} in ${currency}`}
              icon="ticket"
            />
            <StatCard
              label="On sale"
              value={data.events.published}
              note={`${data.events.total} events in all`}
              icon="calendar"
              href="/organizer/events?status=published"
            />
            <StatCard
              label="Checked in"
              value={checkedIn === null ? '—' : `${checkedIn}%`}
              note={`${admitted} of ${issued} tickets`}
              icon="scan"
            />
          </div>

          <div className="grid gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel
              title="Revenue"
              action={(
                <Segmented label="Period" value={days} onChange={setDays} options={WINDOWS} />
              )}
            >
              <BarChart
                ariaLabel={`Revenue per day in ${currency}, last ${days} days`}
                format={(v) => formatMoney(v, currency)}
                data={(data.timeline || []).map((d) => {
                  const day = d.byCurrency?.[currency];
                  return {
                    label: shortDate(d.date),
                    value: Number(day?.grossCents || 0),
                    detail: day
                      ? `${formatMoney(day.grossCents, currency)} · ${day.tickets} tickets`
                      : 'No sales',
                  };
                })}
              />
            </Panel>

            <Attention data={data} organizer={organizer} />
          </div>

          <div className="grid gap-[var(--fx-gap)] lg:grid-cols-2">
            <Upcoming events={data.upcoming} />
            <RecentOrders orders={data.recentOrders} />
          </div>
        </>
      )}
    </div>
  );
}

function shortDate(iso) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`));
}
