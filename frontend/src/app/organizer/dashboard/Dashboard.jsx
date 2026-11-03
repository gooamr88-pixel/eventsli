'use client';

import { useState } from 'react';
import { useOrganizer } from '../../hooks/useOrganizer';
import { useAuth } from '../../hooks/useAuth';
import { useApi } from '../../hooks/useApi';
import { formatMoney } from '../../utils/money';
import { Loading, ErrorNotice } from '../../components/Feedback';
import { Segmented } from '../../components/ui/Filters';
import AdminEntry from '../AdminEntry';
import { DashboardHero, TrendStat, trendOf } from './DashboardHero';
import Drafts from './Drafts';
import CreateProfile from '../CreateProfile';
import OrganizerNotices from '../OrganizerNotices';
import { GettingStarted } from './DashboardPanels';
import { RevenueOverview, NeedsYou, QuickActions } from './OverviewPanels';
import YourEvents from './YourEvents';
import { EventPerformance, TicketsByType, AttendeesByLocation } from './InsightPanels';
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
 * THE LAYOUT FOLLOWS THE 2026-11 DESIGN: greeting and Create, four figures,
 * revenue beside Needs you and Quick Actions, Your events, then performance,
 * ticket types and cities. Below 1280px the band is one column, and Needs you
 * moves ABOVE the chart there (CSS `order`) — it is the only panel with
 * anything to act on, and "beside" would otherwise mean "after a chart".
 * ─────────────────────────────────────────────────────────────────────────────
 */
const firstName = (fullName) => String(fullName || '').trim().split(/\s+/)[0] || null;

export default function Dashboard() {
  const { loading, organizer, error, refresh } = useOrganizer();
  const { user } = useAuth();
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
  const { admitted = 0 } = data?.admissions || {};
  const trends = data?.trends || null;
  const insights = data?.insights || null;

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
      {/* CREATE lives here and on Your events only — the dashboard is where
          somebody sees all their events at once, so it is where starting
          another belongs. `EventBar` records the other half. */}
      <DashboardHero name={firstName(user?.fullName) || organizer.displayName} />

      {/* The four figures, each with how it moved against the window before.
          `trends` is absent until its migration is applied: no badges then.
          THE CURRENCY SWITCH SITS WITH THE FIGURES IT CHANGES, and never
          beside Create event, where it read as a second primary button. */}
      {data && currencies.length > 1 && (
        <Segmented
          label="Figures in"
          showLabel
          value={currency}
          onChange={setPicked}
          options={currencies.map((c) => ({ value: c, label: c }))}
        />
      )}
      {data && (
        <div className="es-statgrid">
          <TrendStat
            label="Total Events"
            value={data.events.total}
            icon="calendarPlus"
            href="/organizer/events"
            trend={trendOf(trends?.events)}
            days={days}
          />
          <TrendStat
            label="Tickets Sold"
            value={sales.tickets.toLocaleString()}
            icon="ticket"
            trend={trendOf(trends?.sales?.[currency]?.tickets)}
            days={days}
          />
          <TrendStat
            label="Revenue"
            value={formatMoney(sales.grossCents, currency)}
            icon="coins"
            trend={trendOf(trends?.sales?.[currency]?.grossCents)}
            days={days}
          />
          <TrendStat
            label="Total Attendees"
            value={admitted.toLocaleString()}
            icon="users"
            trend={trendOf(trends?.attendees)}
            days={days}
          />
        </div>
      )}

      {/* Renders nothing for an ordinary organizer. */}
      <AdminEntry />
      <OrganizerNotices organizer={organizer} payouts={false} />

      {stats.error ? (
        <ErrorNotice error={stats.error} onRetry={stats.reload} />
      ) : (
        <>
          {/* Revenue beside what needs doing; one column below xl, where
              Needs you comes first because it is the only panel to act on. */}
          <div className="es-dash-band">
            <RevenueOverview
              timeline={data.timeline}
              currency={currency}
              trend={trends?.sales?.[currency]?.grossCents}
              days={days}
              onDays={setDays}
            />
            <div className="es-dash-side">
              <NeedsYou data={data} organizer={organizer} />
              <QuickActions focus={data.upcoming?.[0] || insights?.eventList?.[0] || null} />
            </div>
          </div>

          <YourEvents events={insights?.eventList} />

          <div className="es-dash-trio">
            <EventPerformance performance={insights?.performance} days={days} onDays={setDays} />
            <TicketsByType types={insights?.ticketTypes} />
            <AttendeesByLocation locations={insights?.locations} />
          </div>

          {/* Unfinished wizard drafts in this browser. Renders nothing when
              there are none. */}
          <Drafts />
        </>
      )}
    </div>
  );
}
