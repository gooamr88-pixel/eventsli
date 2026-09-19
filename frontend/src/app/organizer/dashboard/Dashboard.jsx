'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useOrganizer } from '../../hooks/useOrganizer';
import { useApi } from '../../hooks/useApi';
import { formatMoney } from '../../utils/money';
import { formatDay } from '../../lib/eventTime';
import { PERIODS } from '../../lib/periods';
import { Loading, ErrorNotice } from '../../components/Feedback';
import { PageHeader, StatCard, Panel } from '../../components/ui/Page';
import { Segmented } from '../../components/ui/Filters';
import NavIcon from '../../components/shell/NavIcon';
import BarChart from '../../components/charts/BarChart';
import { percent } from '../../components/charts/chartMath';
import AdminEntry from '../AdminEntry';
import Drafts from './Drafts';
import CreateProfile from '../CreateProfile';
import OrganizerNotices from '../OrganizerNotices';
import { Attention, Upcoming, RecentOrders, GettingStarted } from './DashboardPanels';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The organizer's home: how everything is selling, and what needs them.
 *
 * One request (`/organizer/dashboard`), aggregated in SQL; every figure on the
 * page is the API's.
 *
 * A NEW ORGANIZER GETS A PLAN, NOT FOUR ZEROS. With no events the page used to
 * render "Revenue $0.00", an empty 30-day chart, "Nothing right now" under
 * Needs you and two empty lists — a dashboard for a business that does not
 * exist yet, with the one useful action in a corner. It now leads with the
 * steps to the first event on sale, and the numbers arrive with the first event.
 *
 * Money is shown ONE CURRENCY AT A TIME. A Toronto event and a Denver event are
 * CAD and USD, and one "revenue" adding the two is wrong in both.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Dashboard() {
  const { loading, organizer, error, refresh } = useOrganizer();
  const [days, setDays] = useState(30);
  const [picked, setPicked] = useState(null);
  const stats = useApi(organizer ? `/organizer/dashboard?days=${days}` : null);

  if (loading) return <Loading variant="stats" rows={4} label="Loading your dashboard" />;
  if (error) return <ErrorNotice error={error} />;
  // Step 1 of the road to a first event. An organizer who already has events
  // from before this step existed is not blocked here — they get a notice, and
  // the details are required before their NEXT new event.
  if (!organizer) return <CreateProfile onCreated={refresh} />;

  const data = stats.data;
  // Until the numbers arrive nobody knows whether this is a new organizer, and
  // guessing drew the full dashboard for a moment before the welcome replaced it.
  if (!data && !stats.error) return <Loading variant="stats" rows={4} label="Loading your dashboard" />;
  const isNew = Boolean(data) && (data.events?.total ?? 0) === 0;
  if (isNew && !organizer.setupComplete) return <CreateProfile organizer={organizer} onCreated={refresh} />;
  const currencies = Object.keys(data?.sales || {});
  const fallback = organizer.country === 'US' ? 'USD' : 'CAD';
  const currency = picked && currencies.includes(picked) ? picked : (currencies[0] || fallback);
  const sales = data?.sales?.[currency] || { orders: 0, tickets: 0, grossCents: 0, netCents: 0 };
  const { issued = 0, admitted = 0 } = data?.admissions || {};
  const checkedIn = percent(admitted, issued);

  // A new organizer gets the welcome and its steps, and nothing above it: a
  // "Dashboard" title and a second Create button over a page that is entirely
  // about creating the first event only pushed the next step below the fold.
  if (isNew) {
    return (
      <div className="fx-stack">
        <h1 className="sr-only">Dashboard</h1>
        <AdminEntry />
        {/* Nothing to list yet in most cases — but an organizer who opened the
            wizard and left has work in this tab, and this is the only thing
            that knows about it. */}
        <Drafts />
        <OrganizerNotices organizer={organizer} payouts={false} />
        <GettingStarted organizer={organizer} />
      </div>
    );
  }

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow={organizer.displayName}
        title="Dashboard"
        lede="How your events are selling, and what needs you next."
        actions={(
          <>
            {currencies.length > 1 && (
              <Segmented
                label="Currency"
                value={currency}
                onChange={setPicked}
                options={currencies.map((c) => ({ value: c, label: c }))}
              />
            )}
            {/* The phone's app bar and the desktop sidebar each carry Create;
                only the tablet rail shows it as a bare icon, so here it is
                spelled out between those two widths and nowhere else. */}
            <Link href="/organizer/events/new" className="es-btn es-btn--primary max-md:hidden lg:hidden">
              <NavIcon name="plus" size={18} />
              Create event
            </Link>
          </>
        )}
      />

      {/* Renders nothing for an ordinary organizer. Above the notices because
          somebody with approvals waiting came here to get to them. */}
      <AdminEntry />

      {/* Payouts are the first line of Needs you and a step of Getting started. */}
      <OrganizerNotices organizer={organizer} payouts={false} />

      {stats.error ? (
        <ErrorNotice error={stats.error} />
      ) : !data ? (
        <Loading variant="stats" rows={4} label="Loading your numbers" />
      ) : (
        <>
          <div className="es-statgrid">
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
              note={`${data.events.total} ${data.events.total === 1 ? 'event' : 'events'} in all`}
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

          <div className="es-split">
            <Panel
              title="Revenue"
              description={`Per day, in ${currency}.`}
              action={<Segmented label="Period" value={days} onChange={setDays} options={PERIODS} />}
            >
              <BarChart
                ariaLabel={`Revenue per day in ${currency}, last ${days} days`}
                format={(v) => formatMoney(v, currency)}
                data={(data.timeline || []).map((d) => {
                  const day = d.byCurrency?.[currency];
                  return {
                    label: formatDay(d.date),
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

          {/* Unfinished work, above the finished. Renders nothing when there
              are no drafts. */}
          <Drafts />

          <div className="es-split es-split--even">
            <Upcoming events={data.upcoming} />
            <RecentOrders orders={data.recentOrders} />
          </div>
        </>
      )}
    </div>
  );
}
