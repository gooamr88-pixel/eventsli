'use client';

import Link from 'next/link';
import NavIcon from '../../../../components/shell/NavIcon';
import { TicketsArt } from '../../../../components/ui/Illustrations';
import { formatMoney } from '../../../../utils/money';
import { useApi } from '../../../../hooks/useApi';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The pieces around the ticket-type table: the first-time empty state, an
 * example of what one looks like, and the three steps from here to tickets on
 * sale.
 *
 * THE EXAMPLE IS LABELLED AS ONE and is not a row of this event: it says
 * "Example only", has no data behind it, and its button starts a REAL new
 * ticket type rather than editing a pretend one.
 *
 * THE STEPS ARE COUNTED, not decorative. "Ticket types" is done when this
 * event has one; the seating step is done when the map has seats (reserved
 * seating) or every type has a quantity (general admission); "Review &
 * publish" is done when the event is on sale.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function EmptyTickets({ onAdd }) {
  return (
    <section className="es-dcard es-tierempty" aria-labelledby="tiers-empty">
      <TicketsArt className="es-tierempty__art" />
      <h2 id="tiers-empty" className="es-tierempty__title">Create your first ticket type</h2>
      <p className="es-tierempty__text">
        Name your tickets, set prices and choose how many are available — General Admission, VIP, Early Bird, a table.
        You can add more later, edit them, or set when each one is on sale.
      </p>
      {onAdd && (
        <button type="button" className="es-btn es-btn--primary es-btn--lg" onClick={onAdd}>
          <NavIcon name="plus" size={20} />Add ticket type
        </button>
      )}
    </section>
  );
}

export function ExampleTier({ currency, onAdd }) {
  return (
    <section className="fx-stack fx-stack--sm" aria-labelledby="tiers-example">
      <div className="es-tierex__head">
        <h2 id="tiers-example" className="es-tierex__title"><NavIcon name="eye" size={20} />Example: ticket type preview</h2>
        <span className="es-ovchip"><NavIcon name="info" size={14} /> Example only</span>
      </div>
      <div className="es-dcard es-tierex">
        <span className="es-paytile es-tierex__tile" aria-hidden="true"><NavIcon name="ticket" size={22} /></span>
        <span className="fx-min0">
          <b className="block text-ink">General Admission</b>
          <small className="block text-muted">Standard entry to the event.</small>
        </span>
        <span className="es-tierex__fact"><NavIcon name="tag" size={16} />{formatMoney(2500, currency)}</span>
        <span className="es-tierex__fact"><NavIcon name="users" size={16} />150 available</span>
        <span className="es-status" data-tone="success">On sale</span>
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={onAdd}>
          <NavIcon name="plus" size={16} />Use this<span className="sr-only"> — start a new ticket type</span>
        </button>
      </div>
    </section>
  );
}

export function TicketSetup({ event, tiers }) {
  const base = `/organizer/events/${event.id}`;
  const seated = event.admissionType !== 'general';
  const { data: stats } = useApi(seated ? `/events/${event.id}/stats?days=7` : null);

  const steps = [
    {
      key: 'tiers', title: 'Ticket types', text: 'Create the ticket types and their prices.',
      done: tiers.length > 0, href: `${base}/tiers`,
    },
    seated
      ? {
        key: 'map', title: 'Seating map', text: 'Draw the room and assign ticket types to seats or tables.',
        done: (stats?.seats?.total || 0) > 0, href: `${base}/map`,
      }
      : {
        key: 'qty', title: 'Quantities', text: 'Set how many of each ticket type you are selling.',
        done: tiers.length > 0 && tiers.every((t) => t.quantity !== null && t.quantity !== undefined), href: `${base}/tiers`,
      },
    {
      key: 'publish', title: 'Review & publish', text: 'Check your setup and submit it to go on sale.',
      done: event.status === 'published', href: `${base}#going-on-sale`,
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <section className="es-dcard" aria-labelledby="tiers-setup">
      <div className="es-ovcard__head">
        <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="layers" size={26} /></span>
        <div className="fx-min0">
          <h2 id="tiers-setup" className="es-dcard__title">Ticket setup</h2>
          <p className="es-ovcard__desc">Get your tickets on sale in 3 steps.</p>
        </div>
      </div>
      <ol className="es-tiersteps">
        {steps.map((s, i) => (
          <li key={s.key} data-state={s.done ? 'done' : i === current ? 'current' : 'todo'}>
            <span className="es-tiersteps__mark" aria-hidden="true">{s.done ? <NavIcon name="tick" size={14} /> : i + 1}</span>
            <Link href={s.href} className="es-tiersteps__body">
              <b>{s.title}<span className="sr-only">{s.done ? ' — done' : i === current ? ' — next' : ''}</span></b>
              <small>{s.text}</small>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
