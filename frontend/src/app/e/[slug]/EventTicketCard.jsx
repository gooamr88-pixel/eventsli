import Link from 'next/link';
import NavIcon from '../../components/shell/NavIcon';
import { formatPrice } from '../../utils/money';
import { ctaFor } from './EventPurchasePanel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "TICKETS" — the call to buy, as a ticket (owner's reference, 2026-11-15).
 *
 * A tab label, a pill that answers the first worry ("do I need an account?"),
 * then one card drawn as a ticket: the invitation and the button on the left,
 * a yellow stub on the right behind a perforation, with the lowest price on it.
 *
 * The button goes where the bottom bar goes (`ctaFor`), so the two can never
 * disagree; an event that cannot be bought says why instead of showing one.
 * Guests really can buy without an account — checkout is email-only and
 * /tickets/find re-sends the tickets — so the pill is a fact, not a slogan.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventTicketCard({ event, cheapest = [], soldOut }) {
  if (event.displayOnly) return null;
  const cta = ctaFor(event, soldOut);
  const from = cheapest.length > 0 ? Math.min(...cheapest) : null;

  return (
    <section id="event-tickets" className="es-evx-tickets" aria-labelledby="event-tickets-title">
      <p className="es-evx-tickets__tab">Tickets</p>

      <p className="es-evx-tickets__pill">
        <NavIcon name="ticket" size={18} />
        Instant purchase — no account needed
      </p>

      <div className="es-evx-ticket">
        <div className="es-evx-ticket__body">
          <h2 id="event-tickets-title" className="es-evx-ticket__title">
            {cta.kind === 'soldout' ? 'This event is sold out' : 'Get your tickets now!'}
          </h2>
          <p className="es-evx-ticket__text">
            {cta.kind === 'soldout'
              ? 'Every ticket has gone. Keep an eye on the organizer’s other events, or check back in case seats are released.'
              : 'Buy directly and secure your spot. No account is needed — a quick, simple checkout, and your tickets arrive by email.'}
          </p>
          {cta.kind === 'buy' && (
            <Link href={cta.href} className="es-evx-ticket__btn">
              {event.admissionType === 'general' ? 'Buy tickets' : 'Book tickets'}
              <NavIcon name="arrow" size={18} />
            </Link>
          )}
        </div>

        <div className="es-evx-ticket__stub" aria-hidden>
          <span className="es-evx-ticket__icon"><NavIcon name="ticket" size={44} /></span>
          {from !== null && (
            <span className="es-evx-ticket__from">
              {from === 0 ? 'Free' : <>From <b>{formatPrice(from, event.currency)}</b></>}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
