'use client';

import { useState } from 'react';
import { patch } from '../../../utils/apiClient';
import { categoryLabel } from '../../../lib/categories';
import { useCategories } from '../../../hooks/useCategories';
import { zonesFor } from '../../../lib/timezones';
// All three from one module now. `toIso` used to be exported out of the
// create-event wizard, so editing a date meant importing half its logic from a
// component; it lives beside its inverse `toLocalInput`, which is what this
// file uses it with.
import { toLocalInput, toIso, formatEventTime } from '../../../lib/eventTime';
import { useToast } from '../../../components/ui/Toast';
import { useOrganizer } from '../../../hooks/useOrganizer';
import Link from 'next/link';
import { Panel } from '../../../components/ui/Page';
import Field, { SelectField, TextareaField } from '../../../components/forms/Field';
import PlaceAutocomplete from '../../../components/forms/PlaceAutocomplete';
import VenuePin, { pinProblem } from '../../../components/forms/VenuePin';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import { useStepSave } from './BuildStep';
import { Notice } from '../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Editing an event after it exists.
 *
 * There was no such screen. `PATCH /events/:id` worked, but nothing in the
 * dashboard called it — so a typo in the title, a wrong date or venue, or a
 * rejected event's requested changes could not be made, and the overview told
 * rejected organizers to "make them and submit again" with no way to.
 *
 * The form follows the API's rules rather than guessing (eventRules.js,
 * editConsequence):
 *   • draft, rejected — everything editable;
 *   • under review    — saving withdraws it to draft; it is submitted again;
 *   • on sale / suspended — the approved details are shown as facts; only the
 *     description, the order limit, transfers and payments stay editable;
 *   • once a ticket has sold, listing type, purchase mode and who pays the fee
 *     are fixed — the API says so, and its sentence is shown.
 *
 * Only CHANGED fields are sent, so a refusal names the field the organizer
 * actually touched.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function fromEvent(event) {
  return {
    title: event.title || '',
    category: event.category || 'other',
    description: event.description || '',
    venueName: event.venue?.name || '',
    venueAddress: event.venue?.address || '',
    city: event.city || '',
    /**
     * WHERE THE VENUE ACTUALLY IS — three fields this form did not have.
     *
     * The creation wizard has searched Google Places since 20260920120000 and
     * writes `venuePlaceId` plus coordinates. THIS form, which is where a venue
     * is edited for the rest of the event's life, had three plain text boxes
     * and sent no pin at all. So the only way to get coordinates onto an event
     * was to get them right at creation and never touch the venue again; any
     * later correction silently left the event unpinned.
     *
     * The consequence is "events near me". `/public/events/near` measures to
     * `venue_lat/lng` when they exist and falls back to a city centroid when
     * they do not — and every published event on the platform is NULL, which is
     * why proximity has only ever been accurate to a whole city.
     *
     * The API already accepted all three on PATCH (`ORGANIZER_EDITABLE` in
     * eventRules.js names venueLat, venueLng and venuePlaceId). Nothing in the
     * backend had to change; the form simply never sent them.
     */
    venuePlaceId: event.venuePlaceId || '',
    venueLat: event.venueLocation?.lat === undefined || event.venueLocation?.lat === null
      ? '' : String(event.venueLocation.lat),
    venueLng: event.venueLocation?.lng === undefined || event.venueLocation?.lng === null
      ? '' : String(event.venueLocation.lng),
    timezone: event.timezone,
    startsAt: toLocalInput(event.startsAt, event.timezone),
    endsAt: toLocalInput(event.endsAt, event.timezone),
    listingType: event.listingType || 'ticketed',
    admissionType: event.admissionType || 'reserved',
    purchaseMode: event.purchaseMode || 'seat_only',
    feeBearer: event.fees?.feeBearer || 'buyer',
    maxTicketsPerOrder: String(event.rules?.maxTicketsPerOrder ?? ''),
    allowTicketTransfer: Boolean(event.rules?.allowTicketTransfer),
    acceptsStripe: Boolean(event.payments?.acceptsStripe),
    acceptsManual: Boolean(event.payments?.acceptsManual),
  };
}

export default function EventDetailsEditor({ event, onSaved }) {
  const toast = useToast();
  const { organizer } = useOrganizer();
  // The admin's categories, with the admin's labels (hooks/useCategories).
  const categories = useCategories();
  const [form, setForm] = useState(() => fromEvent(event));
  const [busy, setBusy] = useState(false);
  // Set on the first save attempt, so the venue fields are not flagged red
  // before anybody has touched them.
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(null);

  // Re-seeded when the event itself changes (after a save, or another action
  // on the page), during render rather than in an effect.
  const [seenVersion, setSeenVersion] = useState(event.updatedAt);
  if (event.updatedAt !== seenVersion) {
    setSeenVersion(event.updatedAt);
    setForm(fromEvent(event));
  }

  const live = event.status === 'published' || event.status === 'suspended';
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  /**
   * TYPING THE VENUE NAME DROPS THE CHOSEN PLACE — the wizard's rule, for the
   * same reason it exists there.
   *
   * `PlaceAutocomplete` is a text input, so the name can be edited after a
   * suggestion was picked, and the moment it is, the pin beside it describes a
   * DIFFERENT building. A stale pin is worse than none: it puts the map on the
   * public event page at the wrong address, confidently, with nothing on screen
   * saying the two ever disagreed. Clearing costs a re-pick; keeping costs
   * somebody arriving at the wrong door.
   *
   * The address and the city are deliberately left alone. They are free text an
   * organizer may have corrected on purpose — a suite number, a building name
   * Google spells differently — and wiping them on a keystroke in another field
   * would delete work nobody asked to delete.
   *
   * ONLY A GOOGLE PIN IS DROPPED, and `venuePlaceId` is what tells them apart.
   * A pin that came from a suggestion belongs to that suggestion's name, so
   * editing the name orphans it. A pin somebody TYPED belongs to the event —
   * they looked it up and entered it deliberately — and clearing it because
   * they fixed a capital letter in the venue name would delete the only pin the
   * event has, on a deployment where venue search cannot supply another.
   */
  const setVenueName = (venueName) => setForm((f) => (
    f.venuePlaceId
      ? { ...f, venueName, venuePlaceId: '', venueLat: '', venueLng: '' }
      : { ...f, venueName }
  ));

  /** A chosen suggestion, resolved. `null` is a lookup that failed after the
   *  name was already in the field: nothing is overwritten, and the event keeps
   *  whatever it had — which is the state every event was in before this. */
  const applyPlace = (place) => {
    if (!place) return;
    setForm((f) => ({
      ...f,
      venueName: place.name || f.venueName,
      venueAddress: place.address || f.venueAddress,
      city: place.city || f.city,
      venuePlaceId: place.placeId || '',
      // Both or neither, always — `venue_coords_together` refuses half a pin.
      venueLat: place.lat === null || place.lat === undefined ? '' : String(place.lat),
      venueLng: place.lng === null || place.lng === undefined ? '' : String(place.lng),
    }));
  };

  const original = fromEvent(event);
  const changedKeys = Object.keys(form).filter((k) => form[k] !== original[k]);
  const datesMoved = ['startsAt', 'endsAt', 'timezone'].some((k) => changedKeys.includes(k));

  const endsBeforeStart = form.startsAt && form.endsAt
    && new Date(toIso(form.endsAt, form.timezone)) <= new Date(toIso(form.startsAt, form.timezone));
  const perOrder = Number(form.maxTicketsPerOrder);
  const perOrderInvalid = !(Number.isInteger(perOrder) && perOrder >= 1 && perOrder <= 100);
  const titleInvalid = form.title.trim().length < 3;
  /**
   * Half a pin blocks the save, because `venue_coords_together` would refuse it
   * anyway — and a database CHECK surfaces to an organizer as an opaque error
   * rather than as the sentence under the two boxes they just filled in.
   */
  const pinInvalid = Boolean(pinProblem({ lat: form.venueLat, lng: form.venueLng }));
  const blocked = endsBeforeStart || perOrderInvalid || titleInvalid || pinInvalid;

  /**
   * THE VENUE IS REQUIRED TO SUBMIT, NOT TO SAVE A DRAFT.
   *
   * A draft is where an organizer works before the room is booked, so
   * refusing to save one without a venue does not produce a venue — it
   * produces "TBC" in three boxes, or a lost edit for anyone who came here
   * to change the title. Once the event is with Eventsli or on sale, the
   * answer has to stay true, and emptying it out is refused.
   *
   * `POST /events/:id/submit` enforces the same rule on the way in, so a
   * draft still cannot reach the review queue without all three.
   */
  const venueOptional = ['draft', 'rejected'].includes(event.status);
  const venueMissing = !form.venueName.trim() || !form.venueAddress.trim() || !form.city.trim();
  /** The message a missing part gets: a refusal, or a reminder. */
  const venueNote = (value, refusal) => {
    if (value.trim()) return {};
    return venueOptional
      ? { hint: `${refusal} You can save without it, but not submit.` }
      : { error: touched ? refusal : null };
  };

  const zones = zonesFor(event.country);
  const zoneOptions = zones.some(([z]) => z === form.timezone) ? zones : [[form.timezone, form.timezone], ...zones];

  /* The step bar's "Save and continue" runs this form's save, so the way on
     from this screen commits it. Without this the bar would navigate and the
     edits would go with it — see BuildStep.jsx. */
  useStepSave(commit);

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * SAVE, AND SAY WHETHER IT IS SAFE TO MOVE ON.
   *
   * Split out of the submit handler so the step bar at the foot of the screen
   * can call the same code. "Save and continue" has to mean it — and the only
   * way it can is by running the form's own save, with the form's own
   * validation, rather than a second copy that will drift from this one.
   *
   * `true` means continue. NOTHING TO SAVE IS ALSO `true`: a reader who opened
   * this screen, changed nothing and pressed the way on is not being refused.
   * Only a real refusal — a missing venue on an event that may not have one,
   * or a server that said no — returns false and keeps them here, where the
   * error is.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async function commit() {
    if (blocked || changedKeys.length === 0) return true;

    // An event already with Eventsli or on sale cannot have its venue emptied
    // out; a draft can be saved without one. See `venueOptional` above.
    setTouched(true);
    if (!venueOptional && venueMissing) return false;

    const body = {};
    for (const key of changedKeys) {
      if (key === 'startsAt' || key === 'endsAt' || key === 'timezone') continue;
      if (key === 'maxTicketsPerOrder') body.maxTicketsPerOrder = perOrder;
      else if (key === 'venueName' || key === 'venueAddress' || key === 'city') body[key] = form[key].trim() || null;
      /**
       * THE PIN TRAVELS AS A NUMBER OR AS NULL, never as "".
       *
       * The form holds coordinates as strings so the inputs and the "changed"
       * comparison stay uniform, but an empty string is not a coordinate —
       * `venue_coords_together` in the database refuses half a pin, and the
       * create path already sends null for a blank. Sending "" here would make
       * `Number('')` zero: a venue off the coast of Africa.
       */
      else if (key === 'venueLat' || key === 'venueLng') {
        body[key] = form[key] === '' ? null : Number(form[key]);
      } else if (key === 'venuePlaceId') body[key] = form[key] || null;
      else if (typeof form[key] === 'string') body[key] = form[key].trim();
      else body[key] = form[key];
    }

    /**
     * BOTH COORDINATES MOVE TOGETHER, even when only one of them "changed".
     *
     * Picking a new venue writes lat and lng in one go, but a re-pick that
     * happens to land on the same latitude would mark only `venueLng` as
     * changed — and a PATCH carrying one half of a pin is exactly what the
     * database constraint exists to refuse. Cheap to send both; expensive to
     * debug the 400 that follows not sending them.
     */
    if ('venueLat' in body || 'venueLng' in body) {
      body.venueLat = form.venueLat === '' ? null : Number(form.venueLat);
      body.venueLng = form.venueLng === '' ? null : Number(form.venueLng);
    }
    // A zone change re-anchors both times, even if their wall-clock text is the same.
    if (datesMoved) {
      if (changedKeys.includes('timezone')) body.timezone = form.timezone;
      body.startsAt = toIso(form.startsAt, form.timezone);
      body.endsAt = toIso(form.endsAt, form.timezone);
    }

    setBusy(true);
    setError(null);
    try {
      const saved = await patch(`/events/${event.id}`, body, { noRedirect: true });
      toast.success(event.status === 'pending_review' && saved?.status === 'draft'
        ? 'Saved. It went back to draft — submit it again when it is ready.'
        : 'Event details saved.');
      onSaved?.();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function save(e) {
    e.preventDefault();
    commit();
  }

  return (
    <Panel title="Event details">
      {event.status === 'pending_review' && (
        <Notice tone="info" title="This event is waiting for review.">
          <p>Saving a change takes it out of the queue and back to draft, so Eventsli reviews what you actually changed. Submit it again afterwards.</p>
        </Notice>
      )}
      {live && (
        <p className="text-sm text-muted">
          It is on sale, so the details Eventsli approved are fixed. You can still change the
          description, the order limit, transfers and how buyers pay.{' '}
          <Link href="/contact" className="text-accent underline">Need to change something else?</Link>
        </p>
      )}

      {/* ON SALE: what the reviewer approved is shown as facts, not as a wall of
          greyed-out inputs that look editable and are not. */}
      {live && (
        <dl className="es-facts rounded-(--es-radius-md) bg-bg-sunken p-4">
          <Fact term="Title" value={event.title} />
          <Fact term="Category" value={categories.label(event.category)} />
          <Fact term="Starts" value={formatEventTime(event.startsAt, event.timezone)} />
          <Fact term="Ends" value={formatEventTime(event.endsAt, event.timezone)} />
          <Fact term="Venue" value={event.venue?.name || '—'} />
          <Fact term="Address" value={event.venue?.address || '—'} />
          {event.listingType === 'ticketed' && (
            <>
              <Fact term="How buyers choose" value={{ seat_only: 'Individual seats', table_only: 'Whole tables', seat_and_table: 'Seats or whole tables' }[event.purchaseMode]} />
              <Fact term="Booking fees" value={event.fees?.feeBearer === 'organizer' ? 'Paid by you' : 'Paid by buyers'} />
            </>
          )}
        </dl>
      )}

      <form onSubmit={save} className="fx-stack fx-stack--sm">
        {!live && (
          <>
            <Field label="Title" name="title" required minLength={3} maxLength={200}
              error={titleInvalid ? 'At least 3 characters.' : null}
              value={form.title} onChange={set('title')} />

            <SelectField label="Category" required value={form.category} onChange={set('category')}
              options={categories.list.length
                ? categories.list.map((c) => [c.slug, c.label])
                : [[form.category, categoryLabel(form.category)]]} />
          </>
        )}

        <TextareaField label="Description" optional rows={5} maxLength={5000}
          hint="What people read on the event page."
          value={form.description} onChange={set('description')} />

        {!live && (
          <>
            <div className="fx-grid fx-grid--2">
              {/* VENUE SEARCH, as in the creation wizard — which had it and
                  this form did not, so editing a venue after creation was the
                  one path that could only ever produce an unpinned event.
                  Typing a venue Google has never heard of still works: it is a
                  text input first and a combobox second. */}
              <PlaceAutocomplete label="Venue name" name="venueName" maxLength={200}
                country={event.country} required={!venueOptional}
                {...venueNote(form.venueName, 'Add the venue name.')}
                value={form.venueName} onChange={setVenueName} onPlace={applyPlace} />
              <Field label="Street address" name="venueAddress" required={!venueOptional} maxLength={300}
                {...venueNote(form.venueAddress, 'Add the street address.')}
                value={form.venueAddress} onChange={set('venueAddress')} />
              {/* The field that makes an event findable. "Events near me"
                  matches `events.city` against a local coordinate table, and
                  no organizer form had ever asked for one — so every venue
                  typed by hand was invisible to it. */}
              <Field label="City" name="city" required={!venueOptional} maxLength={120}
                autoComplete="address-level2"
                hint="Buyers filter by city, and this is what puts your event in “near me”."
                {...venueNote(form.city, 'Add the city.')}
                value={form.city} onChange={set('city')} />
            </div>

            {/* The pin, shown and editable. Filled by the venue search above
                when a suggestion is picked, and typed by hand when search is
                unavailable or the venue is somewhere Google has never heard
                of — which, until the Places key is unrestricted, is every
                venue on this deployment. */}
            <VenuePin
              lat={form.venueLat}
              lng={form.venueLng}
              fromSearch={Boolean(form.venuePlaceId)}
              onChange={(key, value) => setForm((f) => ({ ...f, [key]: value }))}
            />

            <div className="fx-grid fx-grid--2">
              <Field label="Starts" type="datetime-local" name="startsAt" required
                value={form.startsAt} onChange={set('startsAt')} />
              <Field label="Ends" type="datetime-local" name="endsAt" required
                min={form.startsAt || undefined}
                error={endsBeforeStart ? 'The event has to end after it starts.' : null}
                value={form.endsAt} onChange={set('endsAt')} />
            </div>
            <SelectField label="Time zone" required value={form.timezone} onChange={set('timezone')}
              options={zoneOptions} hint="Both times are local to the venue in this zone." />
          </>
        )}

        {form.listingType === 'ticketed' && (
          <>
            {/**
              * ─────────────────────────────────────────────────────────────────
              * RESERVED SEATING OR GENERAL ADMISSION — the choice that decides
              * how much of this product the organizer ever sees.
              *
              * Reserved means a venue map, table categories, seat-by-seat
              * pricing and a seat picker at the checkout. General admission
              * means a number on a ticket type, and none of the above: no map
              * to draw, no map screens in the sidebar, no seat to choose.
              *
              * Presented as two described choices rather than a dropdown,
              * because a dropdown labelled "Admission type" tells somebody
              * nothing about what they are agreeing to build — and this is the
              * one setting here they cannot change after a ticket sells.
              * ─────────────────────────────────────────────────────────────────
              */}
            {!live && (
              <fieldset className="fx-stack fx-stack--sm gap-2">
                <legend className="es-label mb-1.5">
                  <span>How tickets work<span className="es-req" aria-hidden="true">*</span></span>
                </legend>
                <AdmissionChoice
                  value="reserved"
                  current={form.admissionType}
                  onChange={set('admissionType')}
                  title="Reserved seating"
                  detail="You draw the room, buyers choose their seat or table. For theatres, galas and anything with a floor plan."
                />
                <AdmissionChoice
                  value="general"
                  current={form.admissionType}
                  onChange={set('admissionType')}
                  title="General admission"
                  detail="No seat map. You set how many tickets of each type exist, and buyers choose how many they want."
                />
                <p className="text-xs text-subtle">
                  This is fixed once a ticket sells — a sold ticket points at either a seat or a
                  ticket type, and it cannot become the other.
                </p>
              </fieldset>
            )}

            {!live && (
              <div className="fx-grid fx-grid--2">
                {/* Only reserved seating has anything to choose BETWEEN. On a
                    general-admission event there are no seats and no tables, so
                    this question has no answer rather than a default one. */}
                {form.admissionType === 'reserved' && (
                  <SelectField label="How buyers choose" required value={form.purchaseMode} onChange={set('purchaseMode')}
                    options={[['seat_only', 'Individual seats'], ['table_only', 'Whole tables'], ['seat_and_table', 'Seats or whole tables']]} />
                )}
                <SelectField label="Who pays the booking fees" required value={form.feeBearer} onChange={set('feeBearer')}
                  options={[['buyer', 'Buyers — added at checkout'], ['organizer', 'You — taken from your payout']]} />
              </div>
            )}
            <Field label="Most tickets in one order" type="number" name="maxTicketsPerOrder" min={1} max={100} required
              inputMode="numeric"
              error={perOrderInvalid ? 'Between 1 and 100.' : null}
              value={form.maxTicketsPerOrder} onChange={set('maxTicketsPerOrder')} />
            <label className="es-check">
              <input type="checkbox" className="es-check__box" checked={form.allowTicketTransfer}
                onChange={(e) => setForm((f) => ({ ...f, allowTicketTransfer: e.target.checked }))} />
              <span className="text-sm">
                <span className="block text-ink">Let buyers pass a ticket on</span>
                <span className="block text-muted">Once per ticket. The old QR code stops working.</span>
              </span>
            </label>

            {/**
              * NO PAYMENT SECTION ON A FREE EVENT.
              *
              * `event.needs.payment` is false when every ticket type is free —
              * derived from the prices by the API, never from a flag here, so
              * this section and the submit endpoint cannot disagree about
              * whether a payment method is required.
              *
              * A note replaces it rather than nothing at all: an organizer who
              * expected to set up payment should be told why there is nothing
              * to set up, and what would bring it back.
              */}
            {event.needs && !event.needs.payment ? (
              <div className="fx-stack fx-stack--sm rounded-(--es-radius-md) bg-bg-sunken px-4 py-3">
                <p className="text-sm text-ink">Every ticket on this event is free.</p>
                <p className="text-sm text-muted">
                  There is nothing to set up — no card details, no Stripe account, no payouts.
                  Price any ticket type above zero and the payment options appear here.
                </p>
              </div>
            ) : (
            <fieldset className="fx-stack fx-stack--sm gap-2">
              <legend className="es-label mb-1.5">
                <span>How buyers pay<span className="es-req" aria-hidden="true">*</span></span>
              </legend>
              <PaymentToggle
                label="Card payments (Stripe)"
                detail={organizer?.payments?.stripeReady ? 'Buyers pay by card at checkout.' : 'Connect Stripe first.'}
                checked={form.acceptsStripe}
                // Turning one OFF is always allowed; turning one ON needs it set up.
                available={Boolean(organizer?.payments?.stripeReady) || form.acceptsStripe}
                onChange={(v) => setForm((f) => ({ ...f, acceptsStripe: v }))}
              />
              <PaymentToggle
                label="Manual payments"
                detail={organizer?.payments?.manualMethods > 0 ? 'e-Transfer, bank transfer or cash, as you set them up.' : 'Add a manual payment method first.'}
                checked={form.acceptsManual}
                available={organizer?.payments?.manualMethods > 0 || form.acceptsManual}
                onChange={(v) => setForm((f) => ({ ...f, acceptsManual: v }))}
              />
              {!form.acceptsStripe && !form.acceptsManual && (
                <p className="text-xs text-danger">Choose at least one before submitting this event.</p>
              )}
              <p className="text-xs text-subtle">
                <Link href="/organizer/payments" className="text-accent underline">Manage payment methods</Link>
              </p>
            </fieldset>
            )}
          </>
        )}

        <FormError error={error} />

        <div className="fx-row">
          <SubmitButton busy={busy} busyLabel="Saving…" disabled={blocked || changedKeys.length === 0}>
            Save changes
          </SubmitButton>
          {changedKeys.length > 0 && (
            <button type="button" className="es-btn es-btn--ghost" onClick={() => { setForm(original); setError(null); }}>
              Discard
            </button>
          )}
        </div>
      </form>
    </Panel>
  );
}

function Fact({ term, value }) {
  return (
    <div className="fx-min0">
      <dt className="es-facts__term">{term}</dt>
      <dd className="es-facts__value">{value}</dd>
    </div>
  );
}

/**
 * One of the two admission choices, as a described radio.
 *
 * A radio rather than a styled button, so the pair is one group to a screen
 * reader and to the keyboard: arrow keys move between them and the legend above
 * is read as the question. The whole block is the label, so the detail text is
 * part of what is announced rather than decoration beside it.
 */
function AdmissionChoice({ value, current, onChange, title, detail }) {
  return (
    <label className="es-check">
      <input
        type="radio"
        name="admissionType"
        className="es-check__box"
        value={value}
        checked={current === value}
        onChange={() => onChange({ target: { value } })}
      />
      <span className="text-sm">
        <span className="block text-ink">{title}</span>
        <span className="block text-muted">{detail}</span>
      </span>
    </label>
  );
}

function PaymentToggle({ label, detail, checked, available, onChange }) {
  return (
    <label className={`es-check${available ? '' : ' cursor-not-allowed opacity-60'}`} aria-disabled={!available || undefined}>
      <input
        type="checkbox" className="es-check__box" checked={checked} disabled={!available}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-sm">
        <span className="block text-ink">{label}</span>
        <span className="block text-muted">{detail}</span>
      </span>
    </label>
  );
}
