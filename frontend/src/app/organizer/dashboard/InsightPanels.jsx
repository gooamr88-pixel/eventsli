import NavIcon from '../../components/shell/NavIcon';
import { percent } from '../../components/charts/chartMath';
import { TrendBadge, trendOf } from './DashboardHero';
import { PeriodSelect } from './OverviewPanels';

/**
 * The dashboard's bottom row. Every figure is counted by the API's insights
 * (migration 20261103130000); with no insights yet each panel says so rather
 * than drawing zeros as if they were measured.
 */

const NOT_YET = 'Figures appear here once your events start selling.';

/** Orders ÷ page views, to one decimal. */
function rate(orders, views) {
  const v = Number(views) || 0;
  return v > 0 ? Math.round(((Number(orders) || 0) / v) * 1000) / 10 : null;
}

export function EventPerformance({ performance, days, onDays }) {
  const p = performance || {};
  const cur = rate(p.orders?.current, p.views?.current);
  const prev = rate(p.orders?.previous, p.views?.previous);
  const points = cur !== null && prev !== null ? { kind: 'pct', value: Math.round((cur - prev) * 10) / 10 } : null;

  const metrics = [
    { key: 'views', label: 'Event Views', icon: 'eye', value: p.views?.current, trend: trendOf(p.views) },
    { key: 'checkouts', label: 'Checkouts', icon: 'pointer', value: p.checkouts?.current, trend: trendOf(p.checkouts) },
    { key: 'orders', label: 'Orders', icon: 'users', value: p.orders?.current, trend: trendOf(p.orders) },
    { key: 'conversion', label: 'Conversion', icon: 'trend', value: cur === null ? null : `${cur.toFixed(1)}%`, trend: points, unit: ' pp' },
  ];

  return (
    <section className="es-dcard" aria-labelledby="dash-perf">
      <div className="es-dcard__head">
        <h2 id="dash-perf" className="es-dcard__title">
          Event Performance
          <span className="es-dcard__hint" title="Views of your event pages, checkouts started, paid orders, and orders per view.">
            <NavIcon name="info" size={18} />
            <span className="sr-only">Views of your event pages, checkouts started, paid orders, and orders per view.</span>
          </span>
        </h2>
        <PeriodSelect value={days} onChange={onDays} label="Performance period" />
      </div>
      {!performance ? <p className="es-dcard__empty">{NOT_YET}</p> : (
        <ul className="es-perf">
          {metrics.map((m) => (
            <li key={m.key} className="es-perf__item">
              <NavIcon name={m.icon} size={24} />
              <span className="es-perf__label">{m.label}</span>
              <span className="es-perf__value">{m.value === null || m.value === undefined ? '—' : m.value.toLocaleString()}</span>
              <TrendBadge trend={m.trend} unit={m.unit} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SLICE_TONES = ['1', '2', '3', '4'];

export function TicketsByType({ types }) {
  const list = types || [];
  const total = list.reduce((s, t) => s + Number(t.count || 0), 0);
  // Each slice starts where the ones before it end; 25 puts the first at 12 o'clock.
  const slices = list.reduce((acc, t) => {
    const start = acc.length ? acc[acc.length - 1].start + acc[acc.length - 1].share : 0;
    return [...acc, { label: t.label, share: total ? (Number(t.count) / total) * 100 : 0, start }];
  }, []);

  return (
    <section className="es-dcard" aria-labelledby="dash-types">
      <h2 id="dash-types" className="es-dcard__title">Tickets by Type</h2>
      {total === 0 ? <p className="es-dcard__empty">{NOT_YET}</p> : (
        <div className="es-donut">
          <div className="es-donut__ring">
            <svg viewBox="0 0 42 42" aria-hidden="true" focusable="false">
              <circle className="es-donut__track" cx="21" cy="21" r="15.915" />
              {slices.map((t, i) => (
                <circle
                  key={t.label}
                  className="es-donut__slice"
                  data-tone={SLICE_TONES[i] || '4'}
                  cx="21" cy="21" r="15.915"
                  strokeDasharray={`${t.share} ${100 - t.share}`}
                  strokeDashoffset={25 - t.start}
                />
              ))}
            </svg>
            <span className="es-donut__center">
              <b>{total.toLocaleString()}</b>
              <span>Tickets</span>
            </span>
          </div>
          <ul className="es-donut__legend">
            {list.map((t, i) => (
              <li key={t.label}>
                <span className="es-donut__swatch" data-tone={SLICE_TONES[i] || '4'} aria-hidden="true" />
                <span className="fx-truncate">{t.label}</span>
                <b>{percent(t.count, total)}%</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function AttendeesByLocation({ locations }) {
  const list = locations || [];
  const total = list.reduce((s, l) => s + Number(l.count || 0), 0);
  return (
    <section className="es-dcard" aria-labelledby="dash-places">
      <h2 id="dash-places" className="es-dcard__title">Attendees by Location</h2>
      {total === 0 ? <p className="es-dcard__empty">{NOT_YET}</p> : (
        <ul className="es-places">
          {list.map((l) => {
            const share = percent(l.count, total);
            return (
              <li key={l.label} className="es-places__row">
                <NavIcon name="pin" size={16} />
                <span className="fx-truncate">{l.label}</span>
                <span className="es-places__bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
                <b>{share}%</b>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
