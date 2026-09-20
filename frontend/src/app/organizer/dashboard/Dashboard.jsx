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
import { currencyFor } from '../../lib/markets';

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
 *
 * THE ORDER IS WHAT TO DO, THEN WHAT HAPPENED, and it was the other way
 * round. `.es-split` is one column below 1280px — every phone, every tablet
 * and most laptops — so the real reading order was: four figures, a 30-bar
 * chart, and THEN "Needs you", the only panel on the page with anything to
 * act on. The lede promises "what needs you next" and it arrived third,
 * under a chart. Now: what needs you, what is unfinished, then the numbers.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Dashboard() {
  const { loading, organizer, error, refresh } = useOrganizer();
  const [days, setDays] = useState(30);
  const [picked, setPicked] = useState(null);
  /**
   * BOTH REQUESTS AT ONCE, not one after the other.
   *
   * This was `useApi(organizer ? … : null)`, so the numbers could not even be
   * ASKED for until `/organizer/me` had come back — two round trips stacked
   * end to end before the first figure appeared, on every visit to the page an
   * organizer opens most. They are independent questions, so they go together
   * and the page is ready after one trip instead of two.
   *
   * The endpoint answers 404 when there is no organizer profile, which is the
   * same thing `/organizer/me` says and is handled below by `organizer` being
   * null — so the extra request costs a 404 in the one case where the page was
   * never going to show numbers anyway.
   */
  const stats = useApi(`/organizer/dashboard?days=${days}`);

  if (loading) return <Loading variant="stats" rows={4} label="Loading your dashboard" />;
  if (error) return <ErrorNotice error={error} onRetry={refresh} />;
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
  // The country→currency table, not a ternary that has to be found and
  // edited the day a third market opens.
  const fallback = currencyFor(organizer.country);
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
        /**
         * NO CREATE BUTTON HERE ANY MORE.
         *
         * It was shown between 768px and 1024px only, to cover the tablet rail
         * that renders Create as a bare icon. The event bar directly above now
         * carries "Create event" spelled out at EVERY width, so this was a
         * second primary button roughly 60px below the first one, on exactly
         * the widths where there was already room for it.
         */
        actions={currencies.length > 1 && (
          <Segmented
            label="Currency"
            value={currency}
            onChange={setPicked}
            options={currencies.map((c) => ({ value: c, label: c }))}
          />
        )}
      />

      {/* Renders nothing for an ordinary organizer. Above the notices because
          somebody with approvals waiting came here to get to them. */}
      <AdminEntry />

      {/* Payouts are the first line of Needs you and a step of Getting started. */}
      <OrganizerNotices organizer={organizer} payouts={false} />

      {/* `!data` cannot reach here — the early return above already held the
          page on a skeleton until the numbers arrived — so the branch that
          used to render a second identical skeleton is gone. */}
      {stats.error ? (
        <ErrorNotice error={stats.error} onRetry={stats.reload} />
      ) : (
        <>
          {/* ── What needs you, first and full width ───────────────────────
              Not in the split beside the chart: below 1280px that split is one
              column, so "beside" meant "after a 30-bar chart" on every phone,
              every tablet and most laptops. */}
          <Attention data={data} organizer={organizer} />

          {/* Unfinished work, before the finished. Renders nothing when there
              are no drafts. */}
          <Drafts />

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

          <div className="es-split es-split--even">
            <Upcoming events={data.upcoming} />
            <RecentOrders orders={data.recentOrders} />
          </div>
        </>
      )}
    </div>
  );
}
