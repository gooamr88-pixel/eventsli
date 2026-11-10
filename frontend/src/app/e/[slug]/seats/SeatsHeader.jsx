'use client';

import Link from 'next/link';
import NavIcon from '../../../components/shell/NavIcon';
import { useCountdown } from '../../../hooks/useCountdown';
import { formatEventTime } from '../../../lib/eventTime';
import EventShare from '../EventShare';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The top of the seat page: which event this is, when it starts, and where
 * the buyer is in the purchase.
 *
 * The seat page used to open on a back link and "Choose your seats", so a
 * buyer who arrived from a shared link saw a map with no event attached to
 * it. The card names the event, its date and venue; the countdown says how
 * soon; the steps say this is step one of three, and that choosing a seat
 * does not yet commit to anything.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SeatsHeader({ event }) {
  return (
    <div className="fx-stack gap-4">
      <div className="es-seathead">
        <div className="es-seathead__event">
          {event.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.coverUrl} alt="" className="es-seathead__cover" />
          ) : (
            <span className="es-seathead__cover es-seathead__cover--blank" aria-hidden="true">
              <NavIcon name="ticket" size={28} />
            </span>
          )}
          <div className="fx-min0 fx-stack gap-1.5">
            <h1 className="es-seathead__title">{event.title}</h1>
            <p className="es-seathead__meta">
              <span><NavIcon name="calendar" size={16} />{formatEventTime(event.startsAt, event.timezone)}</span>
              {event.venue && <span><NavIcon name="pin" size={16} />{event.venue}</span>}
            </p>
            {event.categoryLabel && <span className="es-seathead__tag">{event.categoryLabel}</span>}
          </div>
        </div>
        {/* Share and save beside the event, as in the owner's mockup. */}
        <div className="es-seathead__actions">
          <EventShare title={event.title} slug={event.slug} tone="card" />
        </div>
        <Countdown startsAt={event.startsAt} />
      </div>

      <div className="es-seatsteps">
        <Link href={`/e/${event.slug}`} className="es-seatsteps__back fx-hit">
          <NavIcon name="chevronLeft" size={16} />Back to event
        </Link>
        <ol className="es-seatsteps__list" aria-label="Buying steps">
          <li aria-current="step"><span className="es-nums">1</span><em>Select seats</em></li>
          <li><span className="es-nums">2</span><em>Ticket details</em></li>
          <li><span className="es-nums">3</span><em>Payment</em></li>
        </ol>
      </div>
    </div>
  );
}

function Countdown({ startsAt }) {
  const { remaining } = useCountdown(startsAt);
  if (remaining === null || remaining <= 0) return null;
  const s = Math.floor(remaining / 1000);
  const parts = [
    [Math.floor(s / 86400), 'Days'],
    [Math.floor((s % 86400) / 3600), 'Hours'],
    [Math.floor((s % 3600) / 60), 'Mins'],
    [s % 60, 'Secs'],
  ];
  return (
    <div className="es-countdown" role="timer" aria-label={`Starts in ${parts[0][0]} days and ${parts[1][0]} hours`}>
      <p className="es-countdown__label">Event starts in</p>
      <div className="es-countdown__cells" aria-hidden="true">
        {parts.map(([n, label]) => (
          <span key={label} className="es-countdown__cell">
            <b className="es-nums">{String(n).padStart(2, '0')}</b>
            <small>{label}</small>
          </span>
        ))}
      </div>
    </div>
  );
}
