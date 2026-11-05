import Link from 'next/link';
import NavIcon from '../../../../components/shell/NavIcon';
import { TicketsArt } from '../../../../components/ui/Illustrations';
import { StackedEmpty } from '../../../../components/ui/SplitEmpty';
import { formatMoney } from '../../../../utils/money';

/**
 * The two cards of Door sales that are not the map: what has been recorded so
 * far with the two things to do next, and the empty state under it.
 *
 * THE NUMBERS ARE THE DATABASE'S, for every door sale — `event_order_totals`
 * through `/orders?channel=manual`, the same sum the Orders page shows — not a
 * count of the 25 rows on screen.
 *
 * "Commission owed", not "Your commission": on a door sale the organizer took
 * the money, and the commission is what they now owe Eventsli. A label that
 * reads like income would be the most expensive misunderstanding on the page.
 */

/**
 * `canRecord` is false while the event is unpublished or has no map. The
 * button is then disabled rather than hidden — the notices above say why, and
 * a button that appears later is one nobody learns is there.
 */
export function DoorSummary({ eventId, totals, currency, canRecord, onRecord }) {
  const t = totals || {};
  const stats = [
    { key: 'tickets', icon: 'ticket', value: Number(t.tickets || 0).toLocaleString(), label: 'Tickets sold' },
    { key: 'gross', icon: 'coins', value: formatMoney(t.grossCents || 0, currency), label: 'Total revenue' },
    { key: 'owed', icon: 'percent', value: formatMoney(t.commissionCents || 0, currency), label: 'Commission owed' },
  ];

  return (
    <section className="es-dcard es-door-summary" aria-labelledby="door-sofar">
      <div className="es-door-summary__main">
        <div className="es-ovcard__head">
          <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="chart" size={24} /></span>
          <div className="fx-min0">
            <h2 id="door-sofar" className="es-dcard__title">Recorded so far</h2>
            <p className="es-ovcard__desc">Every sale you took yourself, with the commission it adds.</p>
          </div>
        </div>
        <ul className="es-door-stats">
          {stats.map((s) => (
            <li key={s.key} className="es-door-stat">
              <span className="es-door-stat__icon" aria-hidden="true"><NavIcon name={s.icon} size={22} /></span>
              <span className="fx-min0">
                <b className="es-door-stat__value es-nums">{s.value}</b>
                <small className="es-door-stat__label">{s.label}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="es-door-summary__actions">
        <h2 className="es-dcard__title">
          <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="sparkle" size={22} /></span>
          Quick actions
        </h2>
        <div className="es-door-actions">
          <RecordButton canRecord={canRecord} onRecord={onRecord} />
          <Link href={`/organizer/events/${eventId}/map`} className="es-btn es-btn--secondary">
            <NavIcon name="map" size={18} />
            View seat map
          </Link>
        </div>
        <Link href={`/organizer/events/${eventId}/commission`} className="es-door-owe">
          What I owe <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

export function DoorEmpty({ canRecord, onRecord }) {
  return (
    <StackedEmpty
      art={<TicketsArt />}
      title="No door sales yet."
      action={<RecordButton canRecord={canRecord} onRecord={onRecord} />}
    >
      {canRecord
        ? 'Pick seats on the map above to record your first ticket.'
        : 'Record your first ticket when the event is live and a seat map is ready.'}
    </StackedEmpty>
  );
}

function RecordButton({ canRecord, onRecord }) {
  return (
    <button type="button" className="es-btn es-btn--primary" onClick={onRecord} disabled={!canRecord}>
      <NavIcon name="plus" size={18} />
      Record a sale
    </button>
  );
}
