'use client';

import Link from 'next/link';
import NavIcon from '../../../components/shell/NavIcon';
import StatusPill from '../../StatusPill';
import Field, { SelectField, TextareaField } from '../../../components/forms/Field';
import PlaceAutocomplete from '../../../components/forms/PlaceAutocomplete';
import VenuePin from '../../../components/forms/VenuePin';
import { categoryLabel } from '../../../lib/categories';
import { formatEventTime } from '../../../lib/eventTime';
import { isDateOnly, formatDateOnly } from '../../../lib/dateOnly';
import DateOnlyFields from '../new/DateOnlyFields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The cards of the Event details form. `EventDetailsEditor` owns the state,
 * the rules and the save; these only draw a part of it, so a tab can unmount
 * without losing anything typed into it.
 *
 * `f` is the editor's working set: the form and its setters, plus the rules it
 * derived (`live`, `listing`, `venueOptional`, the validation flags). Passing
 * the one bundle keeps each card's signature from being a list of twenty props
 * that has to be kept in step with the editor by hand.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function CardHead({ icon, title, lede, aside }) {
  return (
    <div className="es-dcard__head">
      <div className="es-ovcard__head">
        <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name={icon} size={24} /></span>
        <div className="fx-min0">
          <h2 className="es-dcard__title">{title}</h2>
          {lede && <p className="es-ovcard__desc">{lede}</p>}
        </div>
      </div>
      {aside}
    </div>
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

const CHOOSE = { seat_only: 'Individual seats', table_only: 'Whole tables', seat_and_table: 'Seats or whole tables' };

export function BasicSection({ f }) {
  const { event, form, set, setForm, live, listing, venueOptional, venueNote, categories } = f;
  return (
    <section className="es-dcard" aria-label="Event information">
      <CardHead icon="calendar" title="Event information" lede="The core details of your event." aside={<StatusPill status={event.status} />} />

      {/* ON SALE: what the reviewer approved is shown as facts, not as a wall of
          greyed-out inputs that look editable and are not. */}
      {live ? (
        <>
          <p className="text-sm text-muted">
            It is on sale, so the details Eventsli approved are fixed. You can still change the
            description, the order limit, transfers and how buyers pay.{' '}
            <Link href="/contact" className="text-accent underline">Need to change something else?</Link>
          </p>
          <dl className="es-facts rounded-(--es-radius-md) bg-bg-sunken p-4">
            <Fact term="Title" value={event.title} />
            <Fact term="Category" value={categories.label(event.category)} />
            {isDateOnly(event) ? (
              <Fact term="Date" value={formatDateOnly(event)} />
            ) : (
              <>
                <Fact term="Starts" value={formatEventTime(event.startsAt, event.timezone)} />
                <Fact term="Ends" value={formatEventTime(event.endsAt, event.timezone)} />
              </>
            )}
            <Fact term="Venue" value={event.venue?.name || '—'} />
            <Fact term="Address" value={event.venue?.address || '—'} />
            <Fact term="City" value={event.city || '—'} />
          </dl>
        </>
      ) : (
        <div className="fx-stack fx-stack--sm">
          <div className="es-dgrid">
            <Field label="Event title" name="title" required minLength={3} maxLength={200}
              error={f.titleInvalid ? 'At least 3 characters.' : null}
              value={form.title} onChange={set('title')} />
            <SelectField label="Category" required value={form.category} onChange={set('category')}
              options={categories.list.length
                ? categories.list.map((c) => [c.slug, c.label])
                : [[form.category, categoryLabel(form.category)]]} />
          </div>

          {listing ? (
            /* A listing has a date, not a time (lib/dateOnly.js): the whole
               day(s) at the venue, written through the same two fields so the
               form's save and checks are unchanged. */
            <DateOnlyFields
              firstDay={form.startsAt.slice(0, 10)} lastDay={form.endsAt.slice(0, 10)} timezone={form.timezone}
              errorLast={f.endsBeforeStart ? 'The last day has to be on or after the first.' : null}
              onChange={({ firstDay, lastDay }) => setForm((x) => {
                const first = firstDay ?? x.startsAt.slice(0, 10);
                const last = lastDay === undefined ? x.endsAt.slice(0, 10) : (lastDay || first);
                return { ...x, startsAt: first ? `${first}T00:00` : '', endsAt: first ? `${last < first ? first : last}T23:59` : '' };
              })}
            />
          ) : (
            <div className="es-dgrid">
              <Field label="Start date & time" type="datetime-local" name="startsAt" required
                value={form.startsAt} onChange={set('startsAt')} />
              <Field label="End date & time" type="datetime-local" name="endsAt" required
                min={form.startsAt || undefined}
                error={f.endsBeforeStart ? 'The event has to end after it starts.' : null}
                value={form.endsAt} onChange={set('endsAt')} />
            </div>
          )}

          <div className="es-dgrid">
            {/* VENUE SEARCH, as in the creation wizard — which had it and this
                form did not, so editing a venue after creation was the one path
                that could only ever produce an unpinned event. Typing a venue
                Google has never heard of still works: it is a text input first
                and a combobox second. */}
            <PlaceAutocomplete label={listing ? 'Venue (optional)' : 'Venue'} name="venueName" maxLength={200}
              country={event.country} required={!venueOptional && !listing}
              {...(listing ? {} : venueNote(form.venueName, 'Add the venue name.'))}
              value={form.venueName} onChange={f.setVenueName} onPlace={f.applyPlace} />
            <Field label={listing ? 'Address (optional)' : 'Address'} name="venueAddress"
              required={!venueOptional && !listing} maxLength={300}
              {...(listing ? {} : venueNote(form.venueAddress, 'Add the street address.'))}
              value={form.venueAddress} onChange={set('venueAddress')} />
            {/* The field that makes an event findable. "Events near me" matches
                `events.city` against a local coordinate table, and no organizer
                form had ever asked for one — so every venue typed by hand was
                invisible to it. */}
            <Field label="City" name="city" required={!venueOptional} maxLength={120}
              autoComplete="address-level2"
              hint="Buyers filter by city, and this is what puts your event in “near me”."
              {...venueNote(form.city, 'Add the city.')}
              value={form.city} onChange={set('city')} />
            <SelectField label="Time zone" required value={form.timezone} onChange={set('timezone')}
              options={f.zoneOptions} hint={listing ? 'The dates are the venue’s, in this zone.' : 'Both times are local to the venue in this zone.'} />
          </div>

          {/* The pin, shown and editable. Filled by the venue search above when
              a suggestion is picked, and typed by hand when search is
              unavailable or the venue is somewhere Google has never heard of. */}
          <VenuePin
            lat={form.venueLat}
            lng={form.venueLng}
            fromSearch={Boolean(form.venuePlaceId)}
            onChange={(key, value) => setForm((x) => ({ ...x, [key]: value }))}
          />
        </div>
      )}
    </section>
  );
}

export function DescriptionSection({ f }) {
  return (
    <section className="es-dcard" aria-label="Description">
      <CardHead icon="fileText" title="Description" lede="Tell people what your event is about." aside={<span className="es-ovchip">Optional</span>} />
      <TextareaField label="Description" rows={9} maxLength={5000}
        hint="What people read on the event page."
        value={f.form.description} onChange={f.set('description')} />
    </section>
  );
}

export function FormatSection({ f }) {
  const { event, form, set, live } = f;
  return (
    <section className="es-dcard" aria-label="Tickets and format">
      <CardHead icon="ticket" title="Tickets & format" lede="How tickets work, who pays the fees, and the order limit." />

      {live ? (
        <dl className="es-facts rounded-(--es-radius-md) bg-bg-sunken p-4">
          <Fact term="How tickets work" value={event.admissionType === 'general' ? 'General admission' : 'Reserved seating'} />
          {event.admissionType !== 'general' && <Fact term="How buyers choose" value={CHOOSE[event.purchaseMode]} />}
          <Fact term="Booking fees" value={event.fees?.feeBearer === 'organizer' ? 'Paid by you' : 'Paid by buyers'} />
        </dl>
      ) : (
        <>
          {/**
            * ─────────────────────────────────────────────────────────────────
            * RESERVED SEATING OR GENERAL ADMISSION — the choice that decides
            * how much of this product the organizer ever sees.
            *
            * Reserved means a venue map, table categories, seat-by-seat pricing
            * and a seat picker at the checkout. General admission means a
            * number on a ticket type, and none of the above.
            *
            * Presented as two described choices rather than a dropdown, because
            * a dropdown labelled "Admission type" tells somebody nothing about
            * what they are agreeing to build — and this is the one setting here
            * they cannot change after a ticket sells.
            * ─────────────────────────────────────────────────────────────────
            */}
          <fieldset className="fx-stack fx-stack--sm gap-2">
            <legend className="es-label mb-1.5">
              <span>How tickets work<span className="es-req" aria-hidden="true">*</span></span>
            </legend>
            <div className="es-choice-grid es-choice-grid--2">
              <AdmissionChoice value="reserved" current={form.admissionType} onChange={set('admissionType')} icon="map"
                title="Reserved seating"
                detail="You draw the room, buyers choose their seat or table. For theatres, galas and anything with a floor plan." />
              <AdmissionChoice value="general" current={form.admissionType} onChange={set('admissionType')} icon="users"
                title="General admission"
                detail="No seat map. You set how many tickets of each type exist, and buyers choose how many they want." />
            </div>
            <p className="text-xs text-subtle">
              This is fixed once a ticket sells — a sold ticket points at either a seat or a ticket type, and it cannot become the other.
            </p>
          </fieldset>

          <div className="es-dgrid">
            {/* Only reserved seating has anything to choose BETWEEN. On a
                general-admission event there are no seats and no tables, so this
                question has no answer rather than a default one. */}
            {form.admissionType === 'reserved' && (
              <SelectField label="How buyers choose" required value={form.purchaseMode} onChange={set('purchaseMode')}
                options={Object.entries(CHOOSE)} />
            )}
            <SelectField label="Who pays the booking fees" required value={form.feeBearer} onChange={set('feeBearer')}
              options={[['buyer', 'Buyers — added at checkout'], ['organizer', 'You — taken from your payout']]} />
          </div>
        </>
      )}

      <Field label="Most tickets in one order" type="number" name="maxTicketsPerOrder" min={1} max={100} required
        inputMode="numeric"
        error={f.perOrderInvalid ? 'Between 1 and 100.' : null}
        value={form.maxTicketsPerOrder} onChange={set('maxTicketsPerOrder')} />
    </section>
  );
}

/**
 * One of the two admission choices, as a described radio.
 *
 * A radio rather than a styled button, so the pair is one group to a screen
 * reader and to the keyboard: arrow keys move between them and the legend is
 * read as the question. The whole block is the label, so the detail text is
 * part of what is announced rather than decoration beside it.
 */
function AdmissionChoice({ value, current, onChange, title, detail, icon }) {
  return (
    <label className="es-choice">
      <input type="radio" name="admissionType" value={value}
        checked={current === value} onChange={() => onChange({ target: { value } })} />
      <span className="es-choice__icon" aria-hidden="true"><NavIcon name={icon} size={22} /></span>
      <span className="text-sm">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-muted">{detail}</span>
      </span>
    </label>
  );
}

/**
 * The switches that are safe to flip at any stage — transfers, and how buyers
 * pay. Each is a real field on the event; none is decoration.
 *
 * NO PAYMENT SWITCHES ON A FREE EVENT. `event.needs.payment` is false when
 * every ticket type is free — derived from the prices by the API, never from a
 * flag here, so this card and the submit endpoint cannot disagree about whether
 * a payment method is required. A note replaces them rather than nothing, so an
 * organizer who expected to set up payment is told why there is nothing to set.
 */
export function QuickSettings({ f }) {
  const { event, form, setForm, listing, organizer } = f;
  if (listing) {
    return (
      <section className="es-dcard" aria-label="Quick settings">
        <CardHead icon="settings" title="Quick settings" lede="Common event configurations." />
        <div className="es-qset">
          <div className="es-qset__row">
            <NavIcon name="eye" size={20} />
            <span className="es-qset__text">
              <b>Display only (showcase)</b>
              <small>A listing: shown on Eventsli, with no tickets sold here.</small>
            </span>
          </div>
        </div>
      </section>
    );
  }
  const free = event.needs && !event.needs.payment;
  const stripeReady = Boolean(organizer?.payments?.stripeReady);
  const manualReady = organizer?.payments?.manualMethods > 0;
  return (
    <section className="es-dcard" aria-label="Quick settings">
      <CardHead icon="settings" title="Quick settings" lede="Common event configurations." />
      <div className="es-qset">
        <Switch icon="refresh" label="Allow ticket transfers" detail="Once per ticket. The old QR code stops working."
          checked={form.allowTicketTransfer} onChange={(v) => setForm((x) => ({ ...x, allowTicketTransfer: v }))} />
        {free ? (
          <div className="es-qset__row">
            <NavIcon name="ticket" size={20} />
            <span className="es-qset__text">
              <b>Every ticket is free</b>
              <small>Nothing to set up for payment. Price any ticket type above zero and the payment options appear here.</small>
            </span>
          </div>
        ) : (
          <>
            <Switch icon="card" label="Card payments (Stripe)"
              detail={stripeReady ? 'Buyers pay by card at checkout.' : 'Connect Stripe first.'}
              checked={form.acceptsStripe}
              // Turning one OFF is always allowed; turning one ON needs it set up.
              available={stripeReady || form.acceptsStripe}
              onChange={(v) => setForm((x) => ({ ...x, acceptsStripe: v }))} />
            <Switch icon="cash" label="Manual payments"
              detail={manualReady ? 'e-Transfer, bank transfer or cash, as you set them up.' : 'Add a manual payment method first.'}
              checked={form.acceptsManual}
              available={manualReady || form.acceptsManual}
              onChange={(v) => setForm((x) => ({ ...x, acceptsManual: v }))} />
            {!form.acceptsStripe && !form.acceptsManual && (
              <p className="text-xs text-danger">Choose at least one way to pay before submitting this event.</p>
            )}
            <Link href="/organizer/payments" className="es-dcard__link">Manage payment methods <NavIcon name="arrow" size={16} /></Link>
          </>
        )}
      </div>
    </section>
  );
}

/** One setting as a row, with the product's own switch (`.es-switch`, as on Promo codes). */
function Switch({ icon, label, detail, checked, onChange, available = true }) {
  const id = `qset-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="es-qset__row" aria-disabled={!available || undefined}>
      <NavIcon name={icon} size={20} />
      <span className="es-qset__text">
        <b id={id}>{label}</b>
        <small>{detail}</small>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        className="es-switch"
        disabled={!available}
        onClick={() => onChange(!checked)}
      >
        <span aria-hidden className="es-switch__track"><span className="es-switch__thumb" /></span>
      </button>
    </div>
  );
}
