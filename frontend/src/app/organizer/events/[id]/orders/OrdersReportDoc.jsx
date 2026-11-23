import Logo from '../../../../components/brand/Logo';
import { formatMoney } from '../../../../utils/money';
import { addonsText, channelText, describeFilters, eventLine, orderRef, orderWhen } from './ordersExport';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The sales report as a document (2026-11-23) — what OrdersReport.jsx shows on
 * screen and sends to the printer. Pure: everything it says comes in as props,
 * so the test renders it with fixed orders and a fixed clock.
 *
 *   1. The brand band and the event, with the filters it was cut under — a
 *      printout of "door sales only" must say so on its face.
 *   2. Per currency: four KPI tiles, the money from ticket sales down to what
 *      the organizer keeps, and the card/door split (with hosts, when the
 *      event asks whose guest a buyer is).
 *   3. Every order, header repeated on each page, totals at the foot.
 *
 * Names carry `dir="auto"`: an Arabic name lays out right to left inside its
 * cell instead of having its letters reordered by the surrounding English.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OrdersReportDoc({ event, rows, summary, filters, generated }) {
  const timezone = event?.timezone;
  const hasGuests = rows.some((o) => o.guestOf);
  const total = rows.length;

  return (
    <article className="es-orep-sheet" aria-label="Sales report">
      <header className="es-orep-band">
        <Logo size="md" />
        <div className="es-orep-band__tag">
          <p className="es-orep-band__eyebrow">SALES REPORT</p>
          <p className="es-orep-band__date">Generated {generated}</p>
        </div>
      </header>

      <section className="es-orep-event">
        <h1 className="es-orep-event__title" dir="auto">{event?.title || 'Event'}</h1>
        {eventLine(event) && <p className="es-orep-event__line">{eventLine(event)}</p>}
        <div className="es-orep-chips">
          {describeFilters(filters).map((f) => <span key={f} className="es-orep-chip">{f}</span>)}
          <span className="es-orep-chip es-orep-chip--accent">{total} {total === 1 ? 'order' : 'orders'}</span>
          {timezone && <span className="es-orep-chip">Times in {timezone}</span>}
        </div>
      </section>

      {summary.map((s) => <CurrencySummary key={s.currency} s={s} rows={rows} single={summary.length === 1} />)}

      <div className="es-orep-h2">
        <h2>Orders</h2>
        <span>{total} {total === 1 ? 'order' : 'orders'} · newest first</span>
      </div>

      {total === 0 ? (
        <p className="es-orep-empty">No orders match these filters.</p>
      ) : (
        <table className="es-orep-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Order</th>
              <th scope="col">Date</th>
              <th scope="col">Buyer</th>
              <th scope="col">Channel</th>
              {hasGuests && <th scope="col">Guest of</th>}
              <th scope="col" className="is-end">Tickets</th>
              <th scope="col" className="is-end">Paid</th>
              <th scope="col" className="is-end">To you</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, i) => (
              <tr key={o.id || i}>
                <td className="is-muted es-orep-num">{i + 1}</td>
                <td className="is-ref">{orderRef(o)}</td>
                <td className="es-orep-num">{orderWhen(o, timezone)}</td>
                <td>
                  <span className="es-orep-buyer" dir="auto">{o.buyer?.name || 'No name given'}</span>
                  {o.buyer?.email && <span className="es-orep-email">{o.buyer.email}</span>}
                  {o.addons?.length > 0 && <span className="es-orep-addons" dir="auto">+ {addonsText(o)}</span>}
                </td>
                <td><span className={`es-orep-pill ${o.channel === 'manual' ? 'is-door' : ''}`}>{channelText(o)}</span></td>
                {hasGuests && (
                  <td>{o.guestOf ? <span className="es-orep-pill is-guest" dir="auto">{o.guestOf.name}</span> : <span className="is-muted">—</span>}</td>
                )}
                <td className="is-end es-orep-num">{o.tickets}</td>
                <td className="is-end es-orep-num">{formatMoney(o.buyerPaidCents, o.currency)}</td>
                <td className="is-end es-orep-num is-net">{formatMoney(o.organizerNetCents, o.currency)}</td>
              </tr>
            ))}
            {summary.map((s) => (
              <tr key={`total-${s.currency}`} className="is-total">
                <td colSpan={hasGuests ? 6 : 5}>Total{summary.length > 1 ? ` · ${s.currency}` : ''} · {s.orders} {s.orders === 1 ? 'order' : 'orders'}</td>
                <td className="is-end es-orep-num">{s.tickets}</td>
                <td className="is-end es-orep-num">{formatMoney(s.grossCents, s.currency)}</td>
                <td className="is-end es-orep-num is-net">{formatMoney(s.netCents, s.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="es-orep-foot">
        <p>
          Totals cover every order under the filters above. “To you” is what you keep: card sales arrive with
          Eventsli’s commission already taken off; door sales were collected in full and owe it.
        </p>
        <p>eventsli.com</p>
      </footer>
    </article>
  );
}

function CurrencySummary({ s, rows, single }) {
  const m = (cents) => formatMoney(cents, s.currency);
  // Share of the money; of the orders when there is no money (a free event).
  const channelCents = s.cardCents + s.doorCents;
  const cardShare = channelCents > 0
    ? Math.round((s.cardCents / channelCents) * 100)
    : (s.orders ? Math.round((s.card / s.orders) * 100) : 0);
  const hosts = hostTally(rows.filter((o) => o.currency === s.currency));

  return (
    <section aria-label={`Sales in ${s.currency}`}>
      <div className="es-orep-h2">
        <h2>{single ? 'Summary' : `Sales in ${s.currency}`}</h2>
        <span>{s.currency}</span>
      </div>

      <div className="es-orep-kpis">
        <Kpi label="Sales" value={m(s.grossCents)} note="What buyers paid" />
        <Kpi label="To you" value={m(s.netCents)} note="After commission" accent />
        <Kpi label="Orders" value={s.orders.toLocaleString('en')} note={`${s.card} card · ${s.door} door`} />
        <Kpi label="Tickets" value={s.tickets.toLocaleString('en')} note={s.orders ? `${(s.tickets / s.orders).toFixed(1)} per order` : '—'} />
      </div>

      <div className="es-orep-split">
        <div>
          <p className="es-orep-sub">Where the money went</p>
          <table className="es-orep-ledger es-orep-num">
            <tbody>
              <tr><td>Ticket sales</td><td>{m(s.subtotalCents)}</td></tr>
              {s.discountCents > 0 && <tr className="is-minus"><td>Discounts</td><td>−{m(s.discountCents)}</td></tr>}
              {s.taxCents > 0 && <tr><td>Tax collected</td><td>{m(s.taxCents)}</td></tr>}
              <tr className="is-total"><td>Buyers paid</td><td>{m(s.grossCents)}</td></tr>
              <tr className="is-minus"><td>Eventsli commission</td><td>−{m(s.commissionCents)}</td></tr>
              <tr className="is-net"><td>To you</td><td>{m(s.netCents)}</td></tr>
            </tbody>
          </table>
        </div>

        <div>
          <p className="es-orep-sub">By channel</p>
          <div className="es-orep-bar" role="img" aria-label={`${cardShare}% card, ${100 - cardShare}% at the door`}>
            {cardShare > 0 && <span className="is-card" style={{ width: `${cardShare}%` }} />}
            {cardShare < 100 && <span className="is-door" style={{ width: `${100 - cardShare}%` }} />}
          </div>
          <ul className="es-orep-legend es-orep-num">
            <li>
              <span className="es-orep-dot is-card" />
              <span>Card<small>{s.card} {s.card === 1 ? 'order' : 'orders'} · {cardShare}%</small></span>
              <b>{m(s.cardCents)}</b>
            </li>
            <li>
              <span className="es-orep-dot is-door" />
              <span>At the door<small>{s.door} {s.door === 1 ? 'order' : 'orders'} · {100 - cardShare}%</small></span>
              <b>{m(s.doorCents)}</b>
            </li>
          </ul>

          {hosts.length > 0 && (
            <div className="es-orep-hosts">
              <p className="es-orep-sub">Guests of</p>
              <ul className="es-orep-legend es-orep-num">
                {hosts.slice(0, 6).map((h) => (
                  <li key={h.name}>
                    <span className="es-orep-dot" style={{ background: '#15141c' }} />
                    <span dir="auto">{h.name}<small>{h.orders} {h.orders === 1 ? 'order' : 'orders'}</small></span>
                    <b>{h.tickets} {h.tickets === 1 ? 'ticket' : 'tickets'}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, note, accent = false }) {
  return (
    <div className={`es-orep-kpi ${accent ? 'es-orep-kpi--accent' : ''}`}>
      <p className="es-orep-kpi__label">{label}</p>
      <p className="es-orep-kpi__value es-orep-num">{value}</p>
      {note && <p className="es-orep-kpi__note">{note}</p>}
    </div>
  );
}

/** Orders and tickets per host, busiest first. */
export function hostTally(rows) {
  const by = new Map();
  for (const o of rows) {
    if (!o.guestOf) continue;
    const h = by.get(o.guestOf.name) || { name: o.guestOf.name, orders: 0, tickets: 0 };
    h.orders += 1;
    h.tickets += Number(o.tickets) || 0;
    by.set(h.name, h);
  }
  return [...by.values()].sort((a, b) => b.tickets - a.tickets);
}
