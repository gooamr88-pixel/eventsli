import Image from 'next/image';
import NavIcon from '../../components/shell/NavIcon';
import { Zoomable } from '../../components/Lightbox';
import EventShare from './EventShare';
import ClampText from './ClampText';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The top of the event page: the poster on the left; on the right one tinted
 * panel with the title, the organizer's headline and the description, and
 * beside them the facts a guest checks — when, where, who, and the terms.
 *
 * REBUILT 2026-11-15 to the owner's reference (the guest experience the owner
 * asked for "exactly"): everything a guest needs to decide is above the fold,
 * in two columns, before the tickets.
 *
 * NOTHING IS WRITTEN OVER THE POSTER. A poster is the organizer's own artwork
 * with its own words on it; text laid over it is text fighting it. It is shown
 * whole (`contain`) over a blurred copy of itself, never cropped.
 *
 * THE HEADLINE is the description's own first line when that line reads as a
 * heading ("Tickets selling fast — get yours before it's too late"): it is
 * the organizer's words, set in the accent, and it is not repeated in the
 * paragraph under it. See `splitDescription` in page.jsx.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventHero({ event, tagline, about, when }) {
  return (
    <section className="es-evx-head">
      {event.coverUrl ? (
        <div className="es-ev-poster es-evx-head__poster">
          <Zoomable
            items={[{ url: event.coverUrl, caption: event.title }]}
            label={`Open the poster for ${event.title} full screen`}
          >
            <span aria-hidden className="es-ev-poster__wash">
              <Image src={event.coverUrl} alt="" fill sizes="100vw" />
            </span>
            <Image
              src={event.coverUrl}
              alt={`Poster for ${event.title}`}
              fill
              sizes="(max-width: 48rem) 100vw, 40rem"
              priority
              className="es-ev-poster__img"
            />
          </Zoomable>
          <div className="es-ev-head__actions">
            <EventShare title={event.title} slug={event.slug} />
          </div>
        </div>
      ) : (
        /* No artwork is a normal state — an event may publish without one. */
        <div className="es-ev-poster es-ev-poster--empty es-evx-head__poster">
          <p className="es-ev-poster__fallback fx-break">{event.title}</p>
          <div className="es-ev-head__actions">
            <EventShare title={event.title} slug={event.slug} />
          </div>
        </div>
      )}

      <div className="es-evx-head__panel">
        <div className="es-evx-head__main">
          <h1 className="es-evx-head__title fx-break">{event.title}</h1>
          {tagline && <p className="es-evx-head__tagline fx-break">{tagline}</p>}
          {about && <ClampText text={about} />}
        </div>

        <ul className="es-evx-facts" aria-label="Event details">
          <Fact icon="calendar">Event date: {when.date}</Fact>
          {when.start && <Fact icon="clock">Event starts at {when.start}</Fact>}
          {when.end && <Fact icon="clock">Ends at {when.end}</Fact>}
          {event.venue && <Fact icon="pin">{event.venue}</Fact>}
          {event.venueAddress && <Fact icon="building">{event.venueAddress}</Fact>}
          {event.organizer?.name && (
            <Fact icon="tag">
              Presented by <a href="#event-organizer" className="es-evx-facts__link">{event.organizer.name}</a>
            </Fact>
          )}
          <Fact icon="info">
            <a href="/terms" className="es-evx-facts__link">Terms &amp; Conditions</a>
            {' / '}
            <a href="#event-faq" className="es-evx-facts__link">Refund policy</a>
          </Fact>
        </ul>
      </div>
    </section>
  );
}

function Fact({ icon, children }) {
  return (
    <li className="es-evx-facts__row">
      <span aria-hidden className="es-evx-facts__icon"><NavIcon name={icon} size={20} /></span>
      <span className="fx-min0 fx-break">{children}</span>
    </li>
  );
}
