'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import NavIcon from '../../components/shell/NavIcon';

/**
 * The top of the organizer's dashboard: a greeting, the way to start another
 * event, and the four figures with how each moved against the window before.
 */

// The hour is read through a store, not `new Date()` in render: the server and
// the browser are in different time zones, and a render must not be impure.
const noSubscribe = () => () => {};
const readHour = () => new Date().getHours();
const serverHour = () => null;

function greetingFor(hour) {
  if (hour === null) return 'Hello,';
  if (hour < 12) return 'Good morning,';
  if (hour < 18) return 'Good afternoon,';
  return 'Good evening,';
}

export function DashboardHero({ name }) {
  const hour = useSyncExternalStore(noSubscribe, readHour, serverHour);
  return (
    <div className="es-dash-hero">
      <section className="es-dash-hero__card" aria-labelledby="dash-greeting">
        <div className="fx-min0">
          <h1 id="dash-greeting" className="es-dash-hero__title">
            <span className="es-dash-hero__greet">{greetingFor(hour)}</span>
            <span className="es-dash-hero__name fx-break">
              {name} <span aria-hidden="true">👋</span>
            </span>
          </h1>
          <p className="es-dash-hero__lede">Here&apos;s a quick overview of your events.</p>
        </div>
        <HeroArt />
      </section>
      <Link href="/organizer/events/new" className="es-btn es-btn--primary es-btn--lg es-dash-hero__create">
        <NavIcon name="plus" size={20} />
        Create event
      </Link>
    </div>
  );
}

/** Rolling hills and a tilted ticket. Decoration only. */
function HeroArt() {
  return (
    <svg className="es-dash-hero__art" viewBox="0 0 360 120" aria-hidden="true" focusable="false" preserveAspectRatio="xMaxYMax slice">
      <path className="es-dash-hero__hill es-dash-hero__hill--back" d="M0 92c50-26 96-34 146-18s88 20 128-6 64-30 86-26v78H0z" />
      <path className="es-dash-hero__hill" d="M40 120c40-30 90-38 140-24s100 10 180-30v54z" />
      <g transform="translate(270 58) rotate(-28)">
        <path
          className="es-dash-hero__ticket"
          d="M-44-24h88a6 6 0 0 1 6 6v8a10 10 0 0 0 0 20v8a6 6 0 0 1-6 6h-88a6 6 0 0 1-6-6v-8a10 10 0 0 0 0-20v-8a6 6 0 0 1 6-6z"
        />
        <path className="es-dash-hero__star" d="M0-11l3.2 6.6 7.3 1-5.3 5.1 1.3 7.2L0 5.5l-6.5 3.4 1.3-7.2-5.3-5.1 7.3-1z" />
      </g>
      <g className="es-dash-hero__burst">
        <path d="M226 22l-6-10" />
        <path d="M240 16l1-12" />
        <path d="M212 34l-11-5" />
      </g>
    </svg>
  );
}

/**
 * Change against the previous window, as a whole percentage. `null` when there
 * is nothing to compare — no trend data, or both windows empty.
 */
export function trendOf(pair) {
  if (!pair) return null;
  const current = Number(pair.current) || 0;
  const previous = Number(pair.previous) || 0;
  if (previous === 0) return current === 0 ? null : { kind: 'new' };
  return { kind: 'pct', value: Math.round(((current - previous) / previous) * 100) };
}

/** The green/red pill. `unit` is '%' for a change, ' pp' for a rate's points. */
export function TrendBadge({ trend, unit = '%' }) {
  if (!trend) return null;
  const tone = trend.kind === 'new' || trend.value >= 0 ? 'up' : 'down';
  return (
    <span className="es-kpi__trend" data-tone={tone}>
      <NavIcon name={tone === 'down' ? 'arrowDown' : 'arrowUp'} size={12} />
      {trend.kind === 'new' ? 'New' : `${trend.value > 0 ? '+' : ''}${trend.value}${unit}`}
    </span>
  );
}

export function TrendStat({ label, value, icon, trend, days, href }) {
  const body = (
    <>
      <span className="es-kpi__icon"><NavIcon name={icon} size={30} /></span>
      <span className="es-kpi__body">
        <span className="es-kpi__label">{label}</span>
        <span className="es-kpi__value">{value}</span>
        {trend && (
          <span className="es-kpi__foot">
            <TrendBadge trend={trend} />
            <span>vs. last {days} days</span>
          </span>
        )}
      </span>
    </>
  );
  if (href) return <Link href={href} className="es-kpi es-kpi--link">{body}</Link>;
  return <div className="es-kpi">{body}</div>;
}
