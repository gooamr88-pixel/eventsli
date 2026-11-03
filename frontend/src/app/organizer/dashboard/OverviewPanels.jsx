'use client';

import { useId } from 'react';
import Link from 'next/link';
import { formatMoney } from '../../utils/money';
import { formatDay } from '../../lib/eventTime';
import { PERIODS } from '../../lib/periods';
import NavIcon from '../../components/shell/NavIcon';
import AreaChart from '../../components/charts/AreaChart';
import { TrendBadge, trendOf } from './DashboardHero';

/**
 * The dashboard's middle band: revenue over the window on the left, and on the
 * right what needs the organizer and the four things they start most often.
 */

/** "Last 30 Days" as a select. Every period control on the page drives one value. */
export function PeriodSelect({ value, onChange, label = 'Period' }) {
  const id = useId();
  return (
    <span className="es-period">
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {PERIODS.map((p) => <option key={p.value} value={p.value}>Last {p.value} Days</option>)}
      </select>
      <NavIcon name="chevronDown" size={16} />
    </span>
  );
}

// Axis labels: "300K", "50K", "0" — the currency is in the headline above.
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function RevenueOverview({ timeline, currency, trend, days, onDays }) {
  const series = (timeline || []).map((d) => {
    const day = d.byCurrency?.[currency];
    return {
      label: formatDay(d.date),
      value: Number(day?.grossCents || 0),
      detail: day ? `${formatMoney(day.grossCents, currency)} · ${day.tickets} tickets` : 'No sales',
    };
  });
  const total = series.reduce((sum, d) => sum + d.value, 0);

  return (
    <section className="es-dcard es-revenue" aria-labelledby="dash-revenue">
      <div className="es-dcard__head">
        <div className="fx-min0">
          <h2 id="dash-revenue" className="es-dcard__title">Revenue Overview</h2>
          <p className="es-revenue__total">
            <span className="es-revenue__amount">{formatMoney(total, currency)}</span>
            <TrendBadge trend={trendOf(trend)} />
          </p>
        </div>
        <PeriodSelect value={days} onChange={onDays} label="Revenue period" />
      </div>
      <AreaChart
        data={series}
        ariaLabel={`Revenue per day in ${currency}, last ${days} days: ${formatMoney(total, currency)} in all`}
        formatAxis={(cents) => compact.format(cents / 100)}
      />
    </section>
  );
}

/**
 * "Needs you". Each line is a thing to do and the place to do it — a number
 * with nowhere to go is a worry, not a task. Drafts are not listed: the Drafts
 * panel names them one by one, with the step each stopped on.
 */
export function NeedsYou({ data, organizer }) {
  const items = [];
  const { pendingReview = 0 } = data.events || {};
  const overdue = data.invoices?.overdue || 0;

  if (overdue > 0) {
    items.push({
      key: 'overdue',
      text: `${overdue} commission ${overdue === 1 ? 'invoice is' : 'invoices are'} overdue — scanning is off for ${overdue === 1 ? 'that event' : 'those events'}.`,
      href: '/organizer/events?status=published',
      cta: 'Find it',
    });
  }
  if ((organizer.payments?.choices?.length ?? 0) === 0) {
    items.push({
      key: 'payments',
      text: organizer.stripeConnected
        ? 'Finish Stripe or add a manual method so ticketed events can go on sale.'
        : 'Add a payment method so ticketed events can go on sale.',
      href: '/organizer/payments',
      cta: 'Set up',
    });
  }

  return (
    <section className="es-dcard" aria-labelledby="dash-needs">
      <div className="es-dcard__head">
        <h2 id="dash-needs" className="es-dcard__title">Needs you</h2>
        {items.length > 0 && (
          <span className="es-needs__count">
            {items.length}
            <span className="sr-only"> {items.length === 1 ? 'thing' : 'things'} to do</span>
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="es-needs__none">
          <NavIcon name="check" size={18} />
          Nothing to settle, and your account can take payments.
        </p>
      ) : (
        <ul className="es-needs">
          {items.map((item) => (
            <li key={item.key} className="es-needs__row">
              <span className="es-needs__dot" aria-hidden="true" />
              <span className="es-needs__text">{item.text}</span>
              <Link href={item.href} className="es-btn es-btn--secondary es-btn--sm">{item.cta}</Link>
            </li>
          ))}
        </ul>
      )}
      {pendingReview > 0 && (
        <p className="es-needs__note">
          {pendingReview} {pendingReview === 1 ? 'event is' : 'events are'} with Eventsli for review.
        </p>
      )}
    </section>
  );
}

/**
 * Four shortcuts. The two about one event go to `focus` — the next event on
 * sale, or the latest one — and to the events list when there is none yet.
 */
export function QuickActions({ focus }) {
  const actions = [
    { key: 'create', label: 'Create Event', icon: 'calendarPlus', href: '/organizer/events/new', primary: true },
    { key: 'ai', label: 'AI Creator', icon: 'layers', href: '/organizer/events/new?mode=ai' },
    { key: 'invite', label: 'Send Invites', icon: 'send', href: focus ? `/organizer/events/${focus.id}/share` : '/organizer/events' },
    { key: 'stats', label: 'View Analytics', icon: 'chart', href: focus ? `/organizer/events/${focus.id}` : '/organizer/events' },
  ];
  return (
    <section className="es-dcard" aria-labelledby="dash-quick">
      <h2 id="dash-quick" className="es-dcard__title">Quick Actions</h2>
      <ul className="es-quick">
        {actions.map((a) => (
          <li key={a.key}>
            <Link href={a.href} className="es-quick__tile" data-primary={a.primary ? '' : undefined}>
              <NavIcon name={a.icon} size={24} />
              <span>{a.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
