'use client';

import { useId } from 'react';
import Link from 'next/link';
import NavIcon from '../../../components/shell/NavIcon';
import { categoryLabel } from '../../../lib/categories';
import { formatEventTime } from '../../../lib/eventTime';
import { ADMISSION_TYPES, PURCHASE_MODES, PAYMENT_OPTIONS, STEP_SHORT } from './wizardModel';
import { useAiQuota } from '../../../hooks/useAiQuota';
import { QuotaDots } from './ai/AiParts';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE ORGANIZER IS IN THE WIZARD — every step named.
 *
 * It was five unlabelled segments under "Step 2 of 5": countable, but nobody
 * could see what was done or what was still to come, and a finished step could
 * only be reached by pressing Back once per step. Each step is named now, and a
 * finished one is a button straight back to it. Forward is only ever Continue,
 * which validates — nothing here skips a step.
 *
 * An ordered list with `aria-current="step"` rather than the `progressbar` it
 * replaced: the steps are things to read and go back to, not a value.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function WizardStepper({ steps, index, title, onGo, disabled = false }) {
  return (
    <ol className="es-wizard__steps" aria-label={`${title} — steps`}>
      {steps.map((s, i) => {
        const state = i < index ? 'done' : i === index ? 'current' : 'upcoming';
        const inner = (
          <>
            <span aria-hidden className="es-wizard__seg" data-state={state} />
            <span className="es-wizard__steplabel">
              {STEP_SHORT[s]}
              <span className="sr-only">
                {state === 'done' ? ' — done, go back to it' : state === 'current' ? ' — this step' : ' — still to come'}
              </span>
            </span>
          </>
        );
        return (
          <li key={s} className="es-wizard__step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            {state === 'done' ? (
              <button type="button" className="es-wizard__steplink" onClick={() => onGo(i)} disabled={disabled}>
                {inner}
              </button>
            ) : (
              <span className="es-wizard__steplink">{inner}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

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
  const { quota } = useAiQuota();
  const ai = quota?.enabled;
  return (
    <div className="es-wizard es-wizard--center">
      <div className="es-wizard__head">
        <p className="es-eyebrow">New event</p>
        <h1 className="es-wizard__title">{ai ? 'Create an event' : 'What kind of event are you creating?'}</h1>
        <p className="es-wizard__lede">
          {ai ? 'Start from a description, or set it up step by step.' : 'Pick one. You will only be asked what that kind of event needs.'}
        </p>
      </div>

      {/* THE SMART EVENT CREATOR, offered only when the API says it is on
          (`/ai/quota`). Off, or unreachable, and this page is exactly what it
          was: the two manual choices below. */}
      {ai && (
        <>
          <Link href="/organizer/events/new?mode=ai" className="es-ai-hero">
            <span className="es-ai-hero__badge"><NavIcon name="sparkle" size={14} /> New</span>
            <span className="es-ai-hero__icon" aria-hidden="true"><NavIcon name="sparkle" size={26} /></span>
            <span className="es-ai-hero__title">Describe it, and we&rsquo;ll draft it</span>
            <span className="es-ai-hero__text">
              Write a few sentences. You get the details, ticket types and schedule ready to check, usually in under
              15 seconds. Nothing is saved until you say so, and nothing is published.
            </span>
            <span className="es-ai-hero__foot">
              <QuotaDots quota={quota} tone="light" />
              <span className="es-ai-hero__cta">Start with AI <NavIcon name="arrow" size={18} /></span>
            </span>
          </Link>
          <p className="es-ai-or">Or set it up step by step</p>
        </>
      )}

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
