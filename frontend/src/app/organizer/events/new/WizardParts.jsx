'use client';

import { useId } from 'react';
import Link from 'next/link';
import NavIcon from '../../../components/shell/NavIcon';
import { categoryLabel } from '../../../lib/categories';
import { formatEventTime } from '../../../lib/eventTime';
import { ADMISSION_TYPES, PURCHASE_MODES, PAYMENT_OPTIONS } from './wizardModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The wizard's three self-contained pieces: the question before it starts, the
 * card-shaped radio group it asks most of its questions with, and the summary
 * it ends on.
 *
 * Split out of `NewEventForm.jsx` when that file passed the 500-line cap. Each
 * of these renders from its props and holds no state, which is what makes them
 * the right thing to move: the file left behind is now only the wizard's state
 * machine and its steps.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * THE FIRST QUESTION, before any form exists: is this a ticketed event or a
 * display-only listing?
 *
 * Two links rather than a radio and a Continue button. The answer picks which
 * wizard runs, so it belongs in the URL — `?type=` — where the back button can
 * undo it and a half-filled draft of one type cannot leak into the other.
 */
export function TypeChooser() {
  return (
    <div className="es-wizard es-wizard--center">
      <div className="es-wizard__head">
        <p className="es-eyebrow">New event</p>
        <h1 className="es-wizard__title">What kind of event are you creating?</h1>
        <p className="es-wizard__lede">Pick one. You will only be asked what that kind of event needs.</p>
      </div>

      <div className="es-choice-grid es-choice-grid--2">
        <Link href="/organizer/events/new?type=ticketed" className="es-choice es-choice--lg">
          <span className="es-choice__icon"><NavIcon name="ticket" size={22} /></span>
          <span className="es-choice__body">
            <span className="es-choice__title">Ticketed event</span>
            <span className="es-choice__desc">Sell tickets online and at the door.</span>
            <ul className="es-choice__list">
              <Point>Ticket types and prices</Point>
              <Point>A seating map with seats or tables</Point>
              <Point>Stripe and manual payments</Point>
            </ul>
          </span>
          <span className="es-choice__cta">Create a ticketed event <NavIcon name="arrow" size={16} /></span>
        </Link>

        <Link href="/organizer/events/new?type=display_only" className="es-choice es-choice--lg">
          <span className="es-choice__icon"><NavIcon name="eye" size={22} /></span>
          <span className="es-choice__body">
            <span className="es-choice__title">Display-only event</span>
            <span className="es-choice__desc">Show your event on Eventsli without selling tickets.</span>
            <ul className="es-choice__list">
              <Point>An event page people can find and share</Point>
              <Point>No tickets, payments or seating map</Point>
              <Point>Ready in two steps</Point>
            </ul>
          </span>
          <span className="es-choice__cta">Create a listing <NavIcon name="arrow" size={16} /></span>
        </Link>
      </div>
    </div>
  );
}

function Point({ children }) {
  return <li><NavIcon name="tick" size={16} /><span>{children}</span></li>;
}

/**
 * A radio group drawn as cards.
 *
 * A `<fieldset>` with a real `<legend>`, not a heading and some divs: the
 * legend is what a screen reader reads before each option, so without it every
 * choice is announced with no idea what question it answers.
 *
 * The error is wired through `aria-describedby` on the fieldset rather than on
 * the inputs — the message is about the group, and repeating it on all three
 * radios would have it read out three times.
 */
export function RadioCards({ legend, name, value, onChange, options, columns = 2, required, error }) {
  const id = useId();
  return (
    <fieldset className="fx-stack fx-stack--sm" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="es-label mb-1.5">
        <span>{legend}{required && <span className="es-req" aria-hidden="true">*</span>}</span>
      </legend>
      <div className={`es-choice-grid es-choice-grid--${columns}`}>
        {options.map((o, i) => (
          <label key={o.value} className="es-choice">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={onChange}
              required={required}
              /**
               * `data-invalid`, NOT `aria-invalid`, and only on the first
               * radio.
               *
               * `aria-invalid` is not supported on `role="radio"` — the linter
               * refuses it, and it is right: validity belongs to the GROUP, and
               * marking all three options invalid would have a screen reader
               * say "invalid" three times for one unanswered question. The
               * fieldset's `aria-describedby` above is what carries the message.
               *
               * This attribute exists purely so `useFocusFirstInvalid` has
               * something focusable to aim at. One per group, so focus lands on
               * the first option rather than the last.
               */
              data-invalid={error && i === 0 ? 'true' : undefined}
            />
            {o.icon && <span className="es-choice__icon"><NavIcon name={o.icon} size={20} /></span>}
            <span className="es-choice__body">
              <span className="es-choice__title">{o.title}</span>
              <span className="es-choice__desc">{o.desc}</span>
            </span>
          </label>
        ))}
      </div>
      {error && <p id={`${id}-error`} className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}

/**
 * The last step: every answer, each with a way back to the step that set it.
 *
 * "Edit" jumps to the step rather than scrolling to a field, because the
 * wizard's steps are the only navigation it has — and the visually hidden
 * suffix names what is being edited, so five identical "Edit" buttons are five
 * distinct controls to a screen reader.
 */
export function Review({ form, ticketed, startIso, choices, onEdit }) {
  const rows = [
    ['basics', 'Title', form.title.trim()],
    ['basics', 'Category', categoryLabel(form.category)],
    ['when', 'Starts', form.startsAt ? formatEventTime(startIso, form.timezone) : '—'],
    ['when', 'Venue', form.venueName.trim() || 'Not added yet'],
    ['when', 'City', form.city.trim() || 'Not added yet'],
    ...(ticketed ? [
      ['tickets', 'Tickets', ADMISSION_TYPES.find(([v]) => v === form.admissionType)?.[1]],
      // Meaningless without a map, so it is left off the summary entirely
      // rather than shown as a setting that will not apply.
      ...(form.admissionType === 'reserved'
        ? [['tickets', 'Buyers choose', PURCHASE_MODES.find(([v]) => v === form.purchaseMode)?.[1]]]
        : []),
      ['tickets', 'Booking fees', form.feeBearer === 'buyer' ? 'Paid by buyers' : 'Paid by you'],
      ['payment', 'Payments', choices.includes(form.paymentOption) ? PAYMENT_OPTIONS[form.paymentOption][0] : 'None yet — add one before going on sale'],
    ] : [
      ['basics', 'Tickets', 'None — display only'],
    ]),
  ];

  return (
    <>
      <dl className="es-review">
        {rows.map(([stepKey, term, value]) => (
          <div key={term} className="es-review__row">
            <dt className="es-review__term">{term}</dt>
            <dd className="es-review__value">
              {value}{' '}
              <button type="button" className="ml-1 text-xs text-accent underline" onClick={() => onEdit(stepKey)}>
                Edit<span className="sr-only"> {term}</span>
              </button>
            </dd>
          </div>
        ))}
      </dl>
      <div className="rounded-(--es-radius-md) bg-bg-sunken p-4">
        <p className="mb-2 text-sm font-medium text-ink">What happens next</p>
        <ol className="list-decimal fx-stack fx-stack--sm gap-1 pl-5 text-sm text-muted">
          {ticketed ? (
            <>
              <li>Add ticket types and prices.</li>
              <li>Build the seating map.</li>
              <li>Accept the terms and submit for review.</li>
            </>
          ) : (
            <>
              <li>Add a cover image (recommended).</li>
              <li>Accept the terms and submit for review.</li>
            </>
          )}
          <li>Eventsli reviews it — usually within a day.</li>
        </ol>
      </div>
    </>
  );
}
