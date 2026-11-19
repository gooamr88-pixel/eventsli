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
export default function EventTicketCard({ event, cheapest = [], soldOut, when = null }) {
  const cta = ctaFor(event, soldOut);
  // Over, or every ticket gone (owner, 2026-11-20): a section that says so
  // plainly and offers the next step, in place of a card inviting a purchase.
  if (cta.kind === 'ended' || cta.kind === 'soldout') return <EventStatusCard event={event} kind={cta.kind} when={when} />;
  if (event.displayOnly) return null;
  const from = cheapest.length > 0 ? Math.min(...cheapest) : null;

  return (
    <section id="event-tickets" className="es-evx-tickets" aria-labelledby="event-tickets-title">
      <p className="es-evx-tickets__tab">Tickets</p>

      {cta.kind !== 'offline' && (
        <p className="es-evx-tickets__pill">
          <NavIcon name="ticket" size={18} />
          Instant purchase — no account needed
        </p>
      )}

      <div className="es-evx-ticket">
        <div className="es-evx-ticket__body">
          <h2 id="event-tickets-title" className="es-evx-ticket__title">
            {cta.kind === 'soldout' ? 'This event is sold out' : cta.kind === 'offline' ? 'Tickets from the organizer' : 'Get your tickets now!'}
          </h2>
          <p className="es-evx-ticket__text">
            {cta.kind === 'offline'
              ? cta.note
              : cta.kind === 'soldout'
              ? (
                <>
                  Every ticket has gone. Keep an eye on{' '}
                  {event.organizerProfile?.slug
                    ? <Link href={`/o/${event.organizerProfile.slug}`}>the organizer’s other events</Link>
                    : 'the organizer’s other events'}
                  , or check back in case seats are released.
                </>
              )
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "THIS EVENT HAS ENDED" / "SOLD OUT" (owner, 2026-11-20): "put a clear,
 * professional section that tells the visitor".
 *
 * Where the ticket card would be, so it is the first thing under the header:
 * a status label, a plain sentence on what that means, and somewhere to go —
 * upcoming events, this organizer's other events, and (ended) "Find my
 * tickets" for the people who were there and want their ticket or receipt.
 * The poster carries the same word as a stamp (EventHero).
 * ─────────────────────────────────────────────────────────────────────────────
 */
function EventStatusCard({ event, kind, when }) {
  const ended = kind === 'ended';
  const organizer = event.organizerProfile?.slug ? `/o/${event.organizerProfile.slug}` : null;
  const where = [event.venue, event.city].filter(Boolean).join(', ');
  return (
    <section id="event-tickets" className={`es-evstate es-evstate--${kind}`} aria-labelledby="event-state-title">
      <span className="es-evstate__icon" aria-hidden="true">
        <NavIcon name={ended ? 'calendar' : 'ticket'} size={28} />
      </span>
      <div className="es-evstate__body">
        <p className="es-evstate__label">{ended ? 'Event ended' : 'Sold out'}</p>
        <h2 id="event-state-title" className="es-evstate__title">
          {ended ? 'This event has ended' : 'Every ticket has been sold'}
        </h2>
        <p className="es-evstate__text">
          {ended ? (
            <>
              {when?.date ? <>It took place on <strong>{when.date}</strong>{where ? <> at <strong>{where}</strong></> : null}. </> : null}
              {event.displayOnly ? 'Thank you to everyone who came.' : 'Tickets are no longer on sale.'}
            </>
          ) : (
            <>
              Tickets for this event are no longer available. {event.admissionType === 'general' ? 'Tickets' : 'Seats'} sometimes
              come back when a booking is cancelled, so it is worth checking this page again closer to the date.
            </>
          )}
        </p>
        <div className="es-evstate__actions">
          <Link href="/events" className="es-btn es-btn--primary">
            Browse upcoming events <NavIcon name="arrow" size={18} />
          </Link>
          {organizer && (
            <Link href={organizer} className="es-btn es-btn--secondary">
              More from {event.organizerProfile?.name || 'the organizer'}
            </Link>
          )}
        </div>
        {ended && !event.displayOnly && (
          <p className="es-evstate__foot">
            Went to this event? <Link href="/tickets/find">Find my tickets</Link> to see your ticket and receipt again.
          </p>
        )}
      </div>
    </section>
  );
}
