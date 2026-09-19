'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { get, post } from '../../../utils/apiClient';
import { useOrganizer } from '../../../hooks/useOrganizer';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { categoryLabel } from '../../../lib/categories';
import { defaultTimeZone, zonesFor } from '../../../lib/timezones';
import { toIso, browserZone } from '../../../lib/eventTime';
import {
  TYPES, STEP_TEXT, ADMISSION_TYPES, PURCHASE_MODES, FEE_BEARERS,
  PAYMENT_OPTIONS, draftKey, initialForm, problemsFor, blockingFields, SUBMIT_ONLY_FIELDS,
} from './wizardModel';
import { TypeChooser, RadioCards, Review } from './WizardParts';
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
 * that does not exist; times are anchored to the EVENT's zone — `toIso`, which
 * now lives in `lib/eventTime.js` beside `toLocalInput`, its exact inverse.
 *
 * WHAT IS WHERE, because this is three files now. It passed the project's
 * 500-line cap, and the seams are the ones that were already there:
 *
 *   wizardModel.js   the steps, the choices, the draft, the validation — what
 *                    this wizard can ASK, which changes when the product gains
 *                    an option
 *   WizardParts.jsx  the type chooser, the card radios, the review table —
 *                    stateless, each rendered from its props
 *   here             where the organizer is up to, and what Continue does
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function NewEventForm() {
  const params = useSearchParams();
  const type = params.get('type');
  const { loading, organizer, error, refresh } = useOrganizer();

  if (loading) return <Loading variant="card" />;
  if (error) return <ErrorNotice error={error} />;
  if (!organizer || !organizer.setupComplete) return <CreateProfile organizer={organizer} onCreated={refresh} />;

  // `key={type}` so switching between the two products rebuilds the wizard
  // rather than carrying one type's answers into the other's steps.
  if (!TYPES[type]) return <TypeChooser />;
  return <EventWizard key={type} type={type} organizer={organizer} />;
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
  // Bumped on every refused submit, so focus moves to the problem each time
  // rather than only on the first press. See `next()` below.
  const [attempt, setAttempt] = useState(0);
  const [categories, setCategories] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const moved = useRef(false);
  const formRef = useRef(null);

  useFocusFirstInvalid(formRef, attempt);

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

  const problems = problemsFor({ form, startIso, endIso, choices });
  /**
   * WHAT BLOCKS CONTINUE, AND WHAT ONLY WARNS.
   *
   * The venue fields are asked for here and required at submit, but they do
   * not hold a draft hostage — an organizer starts an event before the room
   * is booked, and a form that refuses to move just gets "TBC" typed into it,
   * which then reaches the listing. See `SUBMIT_ONLY_FIELDS`.
   */
  const stepValid = blockingFields(step).every((f) => !problems[f]);
  const shown = (field) => (
    showErrors && !SUBMIT_ONLY_FIELDS.includes(field) ? problems[field] : null
  );
  /** The same message, said as "you will need this" rather than as a refusal. */
  const pending = (field) => (problems[field] ? `Needed before you submit. ${problems[field]}` : null);

  function go(nextIndex) {
    moved.current = true;
    setShowErrors(false);
    setError(null);
    setIndex(nextIndex);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* old browsers */ }
  }

  function next(e) {
    e.preventDefault();
    if (!stepValid) {
      setShowErrors(true);
      /**
       * A COUNTER, not a flag, and the distinction is the whole fix.
       *
       * `showErrors` is already true on a second refused press, so an effect
       * watching it would not re-run — the first "Continue" would move focus to
       * the problem and every press after it would do nothing at all.
       *
       * The alert further down ("Fix the highlighted fields to continue") was
       * the only thing this form said on a refusal. It announces THAT something
       * is wrong; moving focus is what says WHICH — the field's own label, its
       * invalid state and its message, all of it wiring `Field` already has.
       */
      setAttempt((n) => n + 1);
      return;
    }
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
        // The column and the API have always accepted it; nothing ever sent
        // one, which is why "near me" could not see a manually entered venue.
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
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

      <form ref={formRef} onSubmit={next} noValidate className="fx-stack">
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
                label="Venue name" name="venueName" maxLength={200}
                placeholder="e.g. The Danforth Music Hall"
                hint={pending('venueName')}
                value={form.venueName} onChange={set('venueName')}
              />
              <Field
                label="Street address" name="venueAddress" maxLength={300} autoComplete="street-address"
                placeholder="e.g. 147 Danforth Ave"
                hint={pending('venueAddress')}
                value={form.venueAddress} onChange={set('venueAddress')}
              />
              {/* CITY IS ITS OWN FIELD, not the tail of the address line.
                  "Events near me" matches on `events.city`, so a city buried
                  inside a free-text address is a city the listing cannot read
                  — which is why manually entered venues never appeared there. */}
              <Field
                label="City" name="city" maxLength={120} autoComplete="address-level2"
                placeholder="e.g. Toronto"
                hint={pending('city')
                  || 'Buyers filter by city, and this is what puts your event in “near me”.'}
                value={form.city} onChange={set('city')}
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
