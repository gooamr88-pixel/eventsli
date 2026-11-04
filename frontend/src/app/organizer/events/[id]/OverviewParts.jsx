'use client';

import Link from 'next/link';
import NavIcon from '../../../components/shell/NavIcon';
import StatusPill from '../../StatusPill';
import { formatMoneyCompact } from '../../../utils/money';
import { formatEventTime } from '../../../lib/eventTime';
import { isDateOnly, formatDateOnly } from '../../../lib/dateOnly';
import { categoryLabel } from '../../../lib/categories';
import { TrendBadge, trendOf } from '../../dashboard/DashboardHero';

/**
 * The event overview's cards: the cover with what and when, the four figures,
 * the summary of the facts, and the road from created to the night itself.
 * Every value is the event's own or the stats endpoint's; where the stats have
 * not answered (or the trends migration is not applied) a card shows its total
 * with no badge and no line, never an invented one.
 */

function when(event) {
  return isDateOnly(event) ? formatDateOnly(event) : formatEventTime(event.startsAt, event.timezone);
}

export function EventHero({ event }) {
  const editable = !['archived', 'cancelled', 'completed'].includes(event.status);
  return (
    <section className="es-ovhero" aria-labelledby="ov-title" data-cover={event.cover?.url ? '' : undefined}>
      {event.cover?.url && (
        // The organizer's own cover, from our storage.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="es-ovhero__img" src={event.cover.url} alt="" />
      )}
      <div className="es-ovhero__body">
        <StatusPill status={event.status} />
        <h2 id="ov-title" className="es-ovhero__title fx-break">{event.title}</h2>
        <p className="es-ovhero__meta">
          <span><NavIcon name="calendar" size={18} />{when(event)}</span>
          {event.venue?.name && <span><NavIcon name="pin" size={18} />{event.venue.name}</span>}
        </p>
      </div>
      {editable && (
        <Link href={`/organizer/events/${event.id}/content`} className="es-ovhero__cover">
          <NavIcon name="image" size={16} />{event.cover?.url ? 'Change cover' : 'Add a cover'}
        </Link>
      )}
    </section>
  );
}

/** A soft line under the last N days. Decoration: the badge and the figure carry the meaning. */
function Spark({ values }) {
  const v = (values || []).map((x) => Math.max(0, Number(x) || 0));
  if (v.length < 2 || v.every((x) => x === 0)) return null;
  const max = Math.max(...v);
  const pts = v.map((x, i) => [(i / (v.length - 1)) * 100, 28 - (x / max) * 24]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  return (
    <svg className="es-ovstat__spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={`${line} L100 30 L0 30 Z`} className="es-ovstat__fill" />
      <path d={line} className="es-ovstat__line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ icon, value, label, pair, hint }) {
  return (
    <div className="es-ovstat" title={hint}>
      <span className="es-ovstat__icon"><NavIcon name={icon} size={30} /></span>
      <span className="es-ovstat__value">{value}</span>
      <span className="es-ovstat__badge"><TrendBadge trend={trendOf(pair)} /></span>
      <span className="es-ovstat__label">{label}</span>
      <Spark values={pair?.daily} />
    </div>
  );
}

export function OverviewStats({ stats, currency }) {
  const t = stats?.trends || {};
  const cur = stats?.currency || currency;
  const dash = (v) => (v === null || v === undefined ? '—' : v);
  return (
    <div className="es-statgrid">
      <Stat icon="users" label="Attendees" hint="Tickets checked in at the door" value={dash(stats?.admissions?.admitted?.toLocaleString())} pair={t.attendees} />
      <Stat icon="ticket" label="Tickets Sold" value={dash(stats?.tickets?.toLocaleString())} pair={t.tickets} />
      <Stat icon="coins" label="Revenue" value={stats ? formatMoneyCompact(stats.grossCents, cur) : '—'} pair={t.grossCents} />
      <Stat icon="eye" label="Event Views" hint="Views of the public event page" value={dash(t.views?.total?.toLocaleString())} pair={t.views} />
    </div>
  );
}

function timeOnly(iso, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  } catch { return ''; }
}

function duration(startsAt, endsAt) {
  const mins = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60000);
  if (!Number.isFinite(mins) || mins <= 0) return '—';
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const part = (n, w) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : null);
  return [part(d, 'day'), part(h, 'hour'), d ? null : part(m, 'minute')].filter(Boolean).join(' ') || '—';
}

/** Capacity as the stats know it: seats on the map, else the tiers' fixed quantities. */
function capacityOf(stats) {
  if (!stats) return null;
  if (stats.seats?.total) return stats.seats.total;
  const fixed = (stats.tiers || []).filter((t) => t.quantity);
  return fixed.length ? fixed.reduce((s, t) => s + Number(t.quantity), 0) : null;
}

export function EventSummary({ event, stats }) {
  const dateOnly = isDateOnly(event);
  const cap = capacityOf(stats);
  const items = [
    {
      key: 'when', icon: 'calendar', term: 'Date & Time',
      value: dateOnly ? formatDateOnly(event) : (
        <>
          {formatEventTime(event.startsAt, event.timezone, { time: false })}
          <br />
          {timeOnly(event.startsAt, event.timezone)} – {timeOnly(event.endsAt, event.timezone)}
        </>
      ),
    },
    { key: 'where', icon: 'pin', term: 'Location', value: event.venue?.name || event.city || '—' },
    { key: 'type', icon: 'tag', term: 'Event Type', value: event.category ? <span className="es-ovchip">{categoryLabel(event.category)}</span> : '—' },
    { key: 'cap', icon: 'users', term: 'Capacity', value: cap ? cap.toLocaleString() : '—' },
    { key: 'long', icon: 'clock', term: 'Duration', value: duration(event.startsAt, event.endsAt) },
    { key: 'status', icon: 'settings', term: 'Status', value: <StatusPill status={event.status} /> },
  ];
  return (
    <section className="es-dcard" aria-labelledby="ov-summary">
      <div className="es-dcard__head">
        <h2 id="ov-summary" className="es-dcard__title"><NavIcon name="calendar" size={22} />Event Summary</h2>
        <Link href={`/organizer/events/${event.id}/details`} className="es-btn es-btn--secondary es-btn--sm">
          <NavIcon name="pencil" size={16} />Edit
        </Link>
      </div>
      <dl className="es-ovfacts">
        {items.map((it) => (
          <div key={it.key} className="es-ovfacts__item">
            <NavIcon name={it.icon} size={22} />
            <div className="fx-min0">
              <dt>{it.term}</dt>
              <dd className="fx-break">{it.value}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

const SHOWN = ['published', 'completed', 'suspended', 'cancelled'];

function stamp(iso, timeZone) {
  if (!iso) return null;
  return (
    <>
      {formatEventTime(iso, timeZone, { time: false })}
      <br />
      {timeOnly(iso, timeZone)}
    </>
  );
}

export function EventTimeline({ event, stats, now }) {
  const tz = event.timezone;
  const wentLive = SHOWN.includes(event.status) || (event.status === 'archived' && event.archivedFrom === 'published');
  const firstSale = stats?.trends?.firstSaleAt || null;
  const started = now !== null && Date.parse(event.startsAt) <= now;
  const steps = [
    { key: 'created', label: 'Event created', at: event.createdAt, done: true },
    event.status === 'pending_review'
      ? { key: 'review', label: 'In review', at: null, done: false, note: 'With Eventsli' }
      : { key: 'published', label: 'Published', at: wentLive ? event.review?.reviewedAt : null, done: wentLive },
    ...(event.listingType === 'display_only' ? [] : [
      { key: 'sales', label: 'Ticket sales started', at: firstSale, done: Boolean(firstSale) },
    ]),
    { key: 'date', label: 'Event date', at: event.startsAt, done: started },
  ];
  return (
    <section className="es-dcard" aria-labelledby="ov-timeline">
      <h2 id="ov-timeline" className="es-dcard__title"><NavIcon name="flag" size={22} />Event Timeline</h2>
      <ol className="es-ovline">
        {steps.map((s) => (
          <li key={s.key} data-done={s.done || undefined}>
            <span className="es-ovline__dot" aria-hidden="true">{s.done && <NavIcon name="tick" size={14} />}</span>
            <span className="es-ovline__label">
              {s.label}
              <span className="sr-only">{s.done ? ' — done' : ' — not yet'}</span>
            </span>
            <span className="es-ovline__at">{stamp(s.at, tz) || s.note || (s.done ? '—' : 'Not yet')}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
