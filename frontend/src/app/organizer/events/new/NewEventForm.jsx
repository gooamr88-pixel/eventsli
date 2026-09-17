'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { get, post } from '../../../utils/apiClient';
import { useOrganizer } from '../../../hooks/useOrganizer';
import { categoryLabel } from '../../../lib/categories';
import { defaultTimeZone, zonesFor } from '../../../lib/timezones';
import { formatEventTime } from '../../../lib/eventTime';
import Field, { SelectField, TextareaField } from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import NavIcon from '../../../components/shell/NavIcon';
import { Loading, ErrorNotice, Notice } from '../../../components/Feedback';
import CreateProfile from '../../CreateProfile';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Create an event.
 *
 * FIRST, ONE QUESTION: is this a ticketed event or a display-only listing? The
 * two are different products — one sells seats and takes money, the other is a
 * page with no buy button — and every screen after it shows only what that kind
 * needs. A listing is never asked about seats, fees or payments.
 *
 * THEN, ONE STEP AT A TIME. On a phone a single long form is a wall; each step
 * here is one group of related questions with Back and Continue at the thumb,
 * and nothing moves forward until the step is valid. Required fields carry "*",
 * optional ones say "Optional".
 *
 * WHY THIS IS SAFE NOW when an earlier version refused to be a wizard: the
 * answers are kept in sessionStorage as they are typed, so a closed tab or a
 * detour to set up payments loses nothing. Ticket types, the seat map and the
 * cover are still built on the saved event, where they belong.
 *
 * Kept from before: the time zone is a list by country and the API refuses one
 * that does not exist; times are anchored to the EVENT's zone (toIso below).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TYPES = {
  ticketed: {
    title: 'Ticketed event',
    steps: ['basics', 'when', 'tickets', 'payment', 'review'],
  },
  display_only: {
    title: 'Display-only event',
    steps: ['basics', 'when', 'review'],
  },
};

const STEP_TEXT = {
  basics: ['The basics', 'What the event is called and what it is about.'],
  when: ['When and where', 'Times are local to the venue.'],
  tickets: ['How tickets sell', 'You add ticket types and the seat map right after this.'],
  payment: ['How buyers pay', 'Choose from the payment methods you have set up.'],
  review: ['Check and create', 'It is saved as a private draft. Nothing is public until Eventsli approves it.'],
};

/**
 * RESERVED SEATING OR GENERAL ADMISSION — asked here, at creation, because it
 * decides how much of the product this organizer ever has to look at.
 *
 * Reserved means drawing the room: a venue map, table categories, a seat picker
 * at the checkout. General admission means a number on a ticket type and none
 * of the above. Asking afterwards means somebody building a conference spends
 * their first ten minutes in a seat-map editor working out whether they are
 * supposed to be there.
 */
const ADMISSION_TYPES = [
  ['reserved', 'Reserved seating', 'You draw the room; buyers choose their seat or table.', 'map'],
  ['general', 'General admission', 'No seat map. You set how many tickets exist, buyers choose how many they want.', 'ticket'],
];

const PURCHASE_MODES = [
  ['seat_only', 'Individual seats', 'Buyers pick seats one by one.', 'ticket'],
  ['table_only', 'Whole tables', 'Buyers book a table and get every seat at it.', 'layers'],
  ['seat_and_table', 'Seats or tables', 'Buyers can do either.', 'map'],
];

const FEE_BEARERS = [
  ['buyer', 'Buyers pay the fees', 'Added at checkout, shown as its own line.'],
  ['organizer', 'I pay the fees', 'Taken from your payout. Buyers see one price.'],
];

const PAYMENT_OPTIONS = {
  both: ['Stripe + manual', 'Buyers pay by card online, or by your manual methods.', 'card'],
  stripe: ['Stripe only', 'Buyers pay by card at checkout.', 'card'],
  manual: ['Manual only', 'Buyers pay you by e-Transfer, bank transfer or cash.', 'cash'],
};

export default function NewEventForm() {
  const params = useSearchParams();
  const type = params.get('type');
  const { loading, organizer, error, refresh } = useOrganizer();

  if (loading) return <Loading variant="card" />;
  if (error) return <ErrorNotice error={error} />;
  if (!organizer || !organizer.setupComplete) return <CreateProfile organizer={organizer} onCreated={refresh} />;

  if (!TYPES[type]) return <TypeChooser />;
  return <EventWizard key={type} type={type} organizer={organizer} />;
}

// ─── The first question ────────────────────────────────────────────────────
function TypeChooser() {
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
          <span className="es-choice__cta">Create a display-only event <NavIcon name="arrow" size={16} /></span>
        </Link>
      </div>
    </div>
  );
}

function Point({ children }) {
  return <li><NavIcon name="tick" size={16} /><span>{children}</span></li>;
}

// ─── The steps ─────────────────────────────────────────────────────────────
function draftKey(type) {
  return `eventsli.newEvent.${type}`;
}

function initialForm(type, organizer) {
  const country = organizer?.country || 'CA';
  const base = {
    title: '', category: 'other', description: '',
    country, timezone: defaultTimeZone(country, browserZone()),
    startsAt: '', endsAt: '', venueName: '', venueAddress: '',
    admissionType: 'reserved',
    purchaseMode: 'seat_only', feeBearer: 'buyer', maxTicketsPerOrder: '10', allowTicketTransfer: true,
    paymentOption: organizer?.payments?.choices?.[0] || '',
  };
  // A convenience, not a store: a private window or cleared storage simply
  // starts empty. Read only on the client — this component mounts after the
  // organizer loads, so the server never renders it.
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey(type)) || 'null');
    if (saved?.form) {
      const form = { ...base, ...saved.form };
      // A payment option saved before a method was removed is not offered again.
      if (!(organizer?.payments?.choices || []).includes(form.paymentOption)) {
        form.paymentOption = base.paymentOption;
      }
      return { form, step: Number(saved.step) || 0 };
    }
  } catch { /* storage unavailable */ }
  return { form: base, step: 0 };
}

function EventWizard({ type, organizer }) {
  const router = useRouter();
  const headingRef = useRef(null);
  const { steps, title: typeTitle } = TYPES[type];
  const ticketed = type === 'ticketed';

  const [initial] = useState(() => initialForm(type, organizer));
  const [form, setForm] = useState(initial.form);
  const [index, setIndex] = useState(Math.min(initial.step, steps.length - 1));
  const [showErrors, setShowErrors] = useState(false);
  const [categories, setCategories] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const moved = useRef(false);

  const step = steps[index];
  const choices = organizer.payments?.choices || [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/public/event-categories', { noRedirect: true });
        if (!cancelled) setCategories(data?.categories || []);
      } catch { /* the select falls back to "Other" */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Keep the answers as they are typed.
  useEffect(() => {
    try { sessionStorage.setItem(draftKey(type), JSON.stringify({ form, step: index })); } catch { /* private mode */ }
  }, [type, form, index]);

  // A new step is a new screen: take focus to its heading so a screen reader
  // announces where they are, and so the page starts at the top.
  useEffect(() => {
    if (!moved.current) return;
    headingRef.current?.focus();
  }, [index]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setCountry = (e) => {
    const country = e.target.value;
    setForm((f) => ({ ...f, country, timezone: defaultTimeZone(country, browserZone()) }));
  };

  const startIso = toIso(form.startsAt, form.timezone);
  const endIso = toIso(form.endsAt, form.timezone);
  const perOrder = Number(form.maxTicketsPerOrder);

  const problems = {
    title: form.title.trim().length < 3 ? 'Give your event a title of at least 3 characters.' : null,
    startsAt: !form.startsAt ? 'Choose when it starts.'
      : new Date(startIso) <= new Date() ? 'The start has to be in the future.' : null,
    endsAt: !form.endsAt ? 'Choose when it ends.'
      : form.startsAt && new Date(endIso) <= new Date(startIso) ? 'The event has to end after it starts.' : null,
    maxTicketsPerOrder: !(Number.isInteger(perOrder) && perOrder >= 1 && perOrder <= 100) ? 'Between 1 and 100.' : null,
    paymentOption: choices.length > 0 && !choices.includes(form.paymentOption) ? 'Choose how buyers pay.' : null,
  };
  const STEP_FIELDS = {
    basics: ['title'],
    when: ['startsAt', 'endsAt'],
    tickets: ['maxTicketsPerOrder'],
    payment: ['paymentOption'],
    review: [],
  };
  const stepValid = STEP_FIELDS[step].every((f) => !problems[f]);
  const shown = (field) => (showErrors ? problems[field] : null);

  function go(nextIndex) {
    moved.current = true;
    setShowErrors(false);
    setError(null);
    setIndex(nextIndex);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* old browsers */ }
  }

  function next(e) {
    e.preventDefault();
    if (!stepValid) { setShowErrors(true); return; }
    if (index < steps.length - 1) go(index + 1);
    else create();
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const event = await post('/events', {
        title: form.title.trim(),
        category: form.category,
        country: form.country,
        timezone: form.timezone,
        startsAt: startIso,
        endsAt: endIso,
        listingType: type,
        ...(ticketed ? {
          admissionType: form.admissionType,
          purchaseMode: form.purchaseMode,
          feeBearer: form.feeBearer,
          maxTicketsPerOrder: perOrder,
          allowTicketTransfer: form.allowTicketTransfer,
          ...(form.paymentOption && choices.includes(form.paymentOption) ? { paymentOption: form.paymentOption } : {}),
        } : {}),
        ...(form.venueName.trim() ? { venueName: form.venueName.trim() } : {}),
        ...(form.venueAddress.trim() ? { venueAddress: form.venueAddress.trim() } : {}),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      }, { noRedirect: true });
      try { sessionStorage.removeItem(draftKey(type)); } catch { /* fine */ }
      router.push(`/organizer/events/${event.id}?created=1`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const [heading, lede] = STEP_TEXT[step];
  const zone = zonesFor(form.country).find(([z]) => z === form.timezone);
  const zoneLabel = zone ? `${zone[1].split(' — ')[0]} time` : form.timezone;

  return (
    <div className="es-wizard es-wizard--center">
      <div className="es-wizard__progress">
        <p className="es-wizard__count">
          <span>Step {index + 1} of {steps.length}</span>
          <span className="text-ink">{typeTitle}</span>
        </p>
        <div
          className="es-wizard__bar" role="progressbar"
          aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1}
          aria-label={`Step ${index + 1} of ${steps.length}: ${heading}`}
        >
          {steps.map((s, i) => (
            <span key={s} className="es-wizard__seg" data-state={i < index ? 'done' : i === index ? 'current' : 'upcoming'} />
          ))}
        </div>
      </div>

      <div className="es-wizard__head">
        <h1 ref={headingRef} tabIndex={-1} className="es-wizard__title outline-none">{heading}</h1>
        <p className="es-wizard__lede">{lede}</p>
      </div>

      <form onSubmit={next} noValidate className="fx-stack">
        <div className="es-card fx-stack fx-stack--sm p-5">
          {step === 'basics' && (
            <>
              <Field
                label="Event title" name="title" required minLength={3} maxLength={200} autoFocus
                placeholder="e.g. Friday Night Jazz"
                error={shown('title')} value={form.title} onChange={set('title')}
              />
              <SelectField
                label="Category" required value={form.category} onChange={set('category')}
                options={(categories.length ? categories : ['other']).map((c) => [c, categoryLabel(c)])}
                hint="Helps people find it on Eventsli."
              />
              <TextareaField
                label="Description" optional rows={5} maxLength={5000}
                hint="What people read on the event page. You can add it later."
                value={form.description} onChange={set('description')}
              />
            </>
          )}

          {step === 'when' && (
            <>
              <div className="fx-grid fx-grid--2">
                <SelectField
                  label="Country" required value={form.country} onChange={setCountry}
                  options={[['CA', 'Canada'], ['US', 'United States']]}
                  hint={ticketed ? 'Sets the currency — CAD or USD.' : null}
                />
                <SelectField
                  label="Time zone" required value={form.timezone} onChange={set('timezone')}
                  options={zonesFor(form.country)}
                />
              </div>
              <div className="fx-grid fx-grid--2">
                <Field
                  label="Starts" type="datetime-local" name="startsAt" required
                  hint={`Local time, ${zoneLabel}.`}
                  error={shown('startsAt')} value={form.startsAt} onChange={set('startsAt')}
                />
                <Field
                  label="Ends" type="datetime-local" name="endsAt" required
                  min={form.startsAt || undefined}
                  error={shown('endsAt')} value={form.endsAt} onChange={set('endsAt')}
                />
              </div>
              <Field
                label="Venue name" name="venueName" optional maxLength={200}
                placeholder="e.g. The Danforth Music Hall"
                value={form.venueName} onChange={set('venueName')}
              />
              <Field
                label="Address" name="venueAddress" optional maxLength={300} autoComplete="street-address"
                placeholder="Street, city"
                value={form.venueAddress} onChange={set('venueAddress')}
              />
            </>
          )}

          {step === 'tickets' && (
            <>
              <RadioCards
                legend="How do tickets work?" name="admissionType" required
                value={form.admissionType} onChange={set('admissionType')}
                options={ADMISSION_TYPES.map(([value, title, desc, icon]) => ({ value, title, desc, icon }))}
                columns={2}
              />
              {/* Only reserved seating has anything to choose between — a
                  general-admission event has neither seats nor tables, so the
                  question has no answer rather than a default one. */}
              {form.admissionType === 'reserved' && (
                <RadioCards
                  legend="How do buyers choose their place?" name="purchaseMode" required
                  value={form.purchaseMode} onChange={set('purchaseMode')}
                  options={PURCHASE_MODES.map(([value, title, desc, icon]) => ({ value, title, desc, icon }))}
                  columns={3}
                />
              )}
              <RadioCards
                legend="Who pays the booking fees?" name="feeBearer" required
                value={form.feeBearer} onChange={set('feeBearer')}
                options={FEE_BEARERS.map(([value, title, desc]) => ({ value, title, desc }))}
                columns={2}
              />
              <Field
                label="Most tickets in one order" type="number" name="maxTicketsPerOrder" required
                min={1} max={100} inputMode="numeric"
                error={shown('maxTicketsPerOrder') || (form.maxTicketsPerOrder && problems.maxTicketsPerOrder)}
                value={form.maxTicketsPerOrder} onChange={set('maxTicketsPerOrder')}
              />
              <label className="es-check">
                <input
                  type="checkbox" className="es-check__box" checked={form.allowTicketTransfer}
                  onChange={(e) => setForm((f) => ({ ...f, allowTicketTransfer: e.target.checked }))}
                />
                <span className="text-sm">
                  <span className="fx-row gap-2 text-ink">Let buyers pass a ticket on <span className="es-optional">Optional</span></span>
                  <span className="block text-muted">Once per ticket. The old QR code stops working.</span>
                </span>
              </label>
              <p className="fx-row items-start text-sm text-muted">
                <span className="text-accent"><NavIcon name="info" size={18} /></span>
                <span className="fx-min0 flex-1">
                  {form.admissionType === 'general'
                    ? 'Ticket types and prices come next, on the event itself. There is no seating map to build.'
                    : 'Ticket types, prices and the seating map come next, on the event itself.'}
                </span>
              </p>
            </>
          )}

          {step === 'payment' && (
            choices.length === 0 ? (
              <Notice tone="warning" title="You have no payment method yet.">
                <p>
                  You can still create this event as a draft. It cannot go on sale until you connect
                  Stripe or add a manual payment method — your answers here are kept while you do.
                </p>
                <div className="fx-row pt-1">
                  <Link href="/organizer/payments" className="es-btn es-btn--secondary es-btn--sm">
                    Set up payment methods
                  </Link>
                </div>
              </Notice>
            ) : (
              <>
                <RadioCards
                  legend="Payment options for this event" name="paymentOption" required
                  value={form.paymentOption} onChange={set('paymentOption')}
                  options={choices.map((c) => ({ value: c, title: PAYMENT_OPTIONS[c][0], desc: PAYMENT_OPTIONS[c][1], icon: PAYMENT_OPTIONS[c][2] }))}
                  columns={choices.length === 3 ? 3 : choices.length}
                  error={shown('paymentOption')}
                />
                {!organizer.payments.stripeReady && (
                  <p className="text-sm text-muted">
                    Want card payments too? <Link href="/organizer/payments" className="text-accent underline">Connect Stripe</Link>.
                  </p>
                )}
                {organizer.payments.manualMethods === 0 && (
                  <p className="text-sm text-muted">
                    Want e-Transfer or cash too? <Link href="/organizer/payments" className="text-accent underline">Add a manual payment method</Link>.
                  </p>
                )}
              </>
            )
          )}

          {step === 'review' && (
            <Review form={form} ticketed={ticketed} startIso={startIso} choices={choices} onEdit={(s) => go(steps.indexOf(s))} />
          )}
        </div>

        <FormError error={error} />
        {showErrors && !stepValid && (
          <p className="text-sm text-danger" role="alert">Fix the highlighted fields to continue.</p>
        )}

        <div className="es-wizard__actions fx-sticky-actions">
          {index > 0 ? (
            <button type="button" className="es-btn es-btn--ghost" onClick={() => go(index - 1)} disabled={busy}>
              Back
            </button>
          ) : (
            <Link href="/organizer/events/new" className="es-btn es-btn--ghost">Change type</Link>
          )}
          <SubmitButton busy={busy} busyLabel="Creating…" className="es-btn--lg">
            {index < steps.length - 1 ? 'Continue' : 'Create event'}
            {index < steps.length - 1 && <NavIcon name="arrow" size={18} />}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

function RadioCards({ legend, name, value, onChange, options, columns = 2, required, error }) {
  const id = useId();
  return (
    <fieldset className="fx-stack fx-stack--sm" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="es-label mb-1.5">
        <span>{legend}{required && <span className="es-req" aria-hidden="true">*</span>}</span>
      </legend>
      <div className={`es-choice-grid es-choice-grid--${columns}`}>
        {options.map((o) => (
          <label key={o.value} className="es-choice">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={onChange} required={required} />
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

function Review({ form, ticketed, startIso, choices, onEdit }) {
  const rows = [
    ['basics', 'Title', form.title.trim()],
    ['basics', 'Category', categoryLabel(form.category)],
    ['when', 'Starts', form.startsAt ? formatEventTime(startIso, form.timezone) : '—'],
    ['when', 'Venue', form.venueName.trim() || 'Not added yet'],
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

function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * `datetime-local` → ISO 8601, anchored to the EVENT's timezone.
 *
 * The input yields "2026-09-05T20:00" with no offset, and `new Date(...)` reads
 * that in the BROWSER's zone — an organizer in Vancouver scheduling a Toronto
 * show at 8pm would create it at 11pm. The offset is computed for the target
 * zone at that instant, which handles daylight saving correctly.
 *
 * The SHAPE is validated, not the parse result: V8's lenient legacy parser
 * turns junk like "not-a-date:00Z" into a real date rather than NaN.
 */
export function toIso(localValue, timeZone) {
  if (!localValue) return localValue;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(localValue)) return localValue;

  const naive = new Date(`${localValue.length === 16 ? `${localValue}:00` : localValue}Z`);
  if (Number.isNaN(naive.getTime())) return localValue;

  // The zone's offset from UTC at a given instant.
  const offsetAt = (ms) => {
    const d = new Date(ms);
    return new Date(d.toLocaleString('en-US', { timeZone })).getTime()
      - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  };

  // TWO passes. The offset used to be taken once, at the wall-clock time read
  // AS IF it were UTC — which is the wrong instant by the offset itself. Within
  // that many hours of a daylight-saving change it picked the other side of the
  // change, and the event was saved an hour off (07:00 in Chicago on the day
  // DST starts became 08:00). Re-measuring at the first answer lands on the
  // right side of the change.
  const first = naive.getTime() - offsetAt(naive.getTime());
  return new Date(naive.getTime() - offsetAt(first)).toISOString();
}
