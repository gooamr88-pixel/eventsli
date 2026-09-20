'use client';

import Link from 'next/link';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Your seats are on hold" — the beat between choosing and paying.
 *
 * Or your table, or your tickets: a general-admission event has no seats, so
 * every noun on this screen comes from `noun`. See `heldNoun` in
 * `hooks/useReservation.js` for where that is decided and why it is not on the
 * quote.
 *
 * WHAT IT IS FOR. The seat map hands over the moment a hold succeeds, and the
 * checkout form is a wall of fields. Between them a buyer has just committed
 * something — those seats are now off sale for everybody else — and nothing
 * acknowledged it. This is the acknowledgement: what you have, for how long,
 * and what it costs, before a single field asks for anything.
 *
 * THE COST IS A CLICK, AND IT IS WORTH NAMING. Any step between a decision and
 * a payment loses some buyers. This one earns its place by removing a worse
 * surprise — a buyer who does not know the clock exists meets it as a red
 * `RESERVATION_EXPIRED` wall after typing their card details, which loses the
 * sale *and* the goodwill.
 *
 * On a reload the hold panel appears again rather than being remembered. That
 * is deliberate: the countdown it shows is shorter than last time, which is the
 * single most useful thing the page can say to somebody who has come back.
 *
 * THE RING IS DECORATION OVER A NUMBER, never instead of one. It is
 * `aria-hidden`; the figure inside it is the accessible content, and the
 * `aria-live` region belongs to the text, not the circle.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function HoldConfirm({
  quote, formatted, remaining, expired, totalMs, slug, onProceed,
  /* What is on hold, in words — `heldNoun(reservation)` from useReservation.
     Defaulted rather than required: this screen renders the countdown on a
     live checkout, and a missing prop must not be the thing that breaks it. */
  noun = { one: 'seat', many: 'seats', they: 'they' },
}) {
  const urgent = !expired && remaining !== null && remaining <= 60_000;
  const warning = !expired && !urgent && remaining !== null && remaining <= 5 * 60_000;

  // How much of the ring is left. Clamped, because a hold restored from an
  // older session can report more time than the window it was issued for, and
  // a stroke offset outside 0–1 draws nothing at all.
  const fraction = remaining === null || !totalMs
    ? 1
    : Math.max(0, Math.min(1, remaining / totalMs));

  const ink = expired || urgent ? 'var(--es-danger)' : warning ? 'var(--es-warning)' : 'var(--es-accent)';

  return (
    <div className="es-plate fx-stack items-center bg-surface p-6 text-center">
      <div className="fx-stack fx-stack--sm items-center gap-1">
        <Ring fraction={fraction} ink={ink} />
        <p className="text-sm text-muted">
          {expired ? 'This hold has ended' : `Your ${noun.many} ${noun.they === 'it' ? 'is' : 'are'} reserved for`}
        </p>
        <p
          className={`es-nums font-mono text-3xl font-medium ${
            expired || urgent ? 'text-danger' : warning ? 'text-warning' : 'text-accent'
          }`}
          // Polite: this updates every second, and an assertive region would
          // have a screen reader interrupt itself sixty times a minute.
          aria-live="polite"
        >
          {expired ? '00:00' : formatted}
        </p>
      </div>

      {quote?.event?.title && (
        <div className="fx-stack fx-stack--sm gap-0.5">
          <p className="text-md text-ink">{quote.event.title}</p>
          {/* WHEN, beside what and where. This panel is the last screen that
              names the event before the form takes over, and it listed the
              venue without ever saying the date — so a buyer holding seats for
              one of an organizer's three nights had nothing here to check it
              against. In the event's own zone, labelled, like every other time
              in the product. */}
          {quote.event.startsAt && (
            <p className="text-sm text-subtle">
              {formatEventTime(quote.event.startsAt, quote.event.timezone)}
            </p>
          )}
          {quote.event.venue && <p className="text-sm text-subtle">{quote.event.venue}</p>}
        </div>
      )}

      <p className="es-nums text-xl font-medium text-ink">
        {formatMoney(quote.totalCents, quote.currency)}
      </p>
      <p className="text-sm text-muted">
        Admits {quote.admits} {quote.admits === 1 ? 'person' : 'people'}
      </p>

      {expired ? (
        <>
          <p className="text-sm text-muted">
            Your {noun.many} went back on sale. Nothing was charged — choose again and
            {noun.they === 'it' ? ' it may' : ' they may'} still be there.
          </p>
          <Link href={slug ? `/e/${slug}` : '/events'} className="es-btn es-btn--primary es-btn--block es-btn--lg">
            Back to the event
          </Link>
        </>
      ) : (
        <>
          <p className="rounded-(--es-radius-md) bg-bg-sunken px-4 py-3 text-sm text-muted">
            Finish within {Math.max(1, Math.round((totalMs || 0) / 60000))} minutes to keep
            {noun.they === 'it' ? ' it' : ' them'}. After that {noun.they} go{noun.they === 'it' ? 'es' : ''} back on sale.
          </p>
          <button
            type="button"
            onClick={onProceed}
            className="es-btn es-btn--primary es-btn--block es-btn--lg"
          >
            Proceed to checkout
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The countdown, as a ring.
 *
 * Drawn with a stroke-dasharray rather than animated: it is redrawn once a
 * second by the countdown that already ticks, so a CSS transition would be
 * chasing a value that has already moved on. `rotate(-90)` starts it at twelve
 * o'clock, which is the only place a clock may start.
 */
function Ring({ fraction, ink }) {
  const r = 46;
  const circumference = 2 * Math.PI * r;

  return (
    <svg width="112" height="112" viewBox="0 0 112 112" aria-hidden="true" className="mb-1">
      <circle cx="56" cy="56" r={r} fill="none" stroke="var(--es-border)" strokeWidth="7" />
      <circle
        cx="56" cy="56" r={r}
        fill="none"
        stroke={ink}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        transform="rotate(-90 56 56)"
      />
      <g transform="translate(56 56)">
        <path
          d="M-7 -2h14v11a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2z M-4 -2v-4a4 4 0 0 1 8 0v4"
          fill="none"
          stroke={ink}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
