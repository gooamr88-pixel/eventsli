'use client';

import { useState } from 'react';
import { patch } from '../../../utils/apiClient';
import { useCategories } from '../../../hooks/useCategories';
import { zoneOptions as zoneGroups } from '../../../lib/timezones';
// All three from one module now. `toIso` used to be exported out of the
// create-event wizard, so editing a date meant importing half its logic from a
// component; it lives beside its inverse `toLocalInput`, which is what this
// file uses it with.
import { toLocalInput, toIso } from '../../../lib/eventTime';
import { useToast } from '../../../components/ui/Toast';
import { useOrganizer } from '../../../hooks/useOrganizer';
import NavIcon from '../../../components/shell/NavIcon';
import { pinProblem } from '../../../components/forms/VenuePin';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import { useStepSave } from './BuildStep';
import { Notice } from '../../../components/Feedback';
import { useNowMinute } from '../../../hooks/useNowMinute';
import FeeSummary from './FeeSummary';
import { BasicSection, DescriptionSection, FormatSection, QuickSettings } from './DetailsSections';

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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE FORM, THREE CARDS (2026-11). Basic details, Description and Tickets &
 * format are tabs over the same state, so moving between them loses nothing
 * and Save sends every change at once. A tab holding a refusal is marked, so
 * an error is never only in a card nobody is looking at. The cards themselves
 * are in DetailsSections.jsx; everything that decides what is allowed stays
 * here, in one place.
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
  const now = useNowMinute();

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
      // The venue decides the zone. Saving then re-anchors both times to it,
      // keeping their wall clock (see `datesMoved` below).
      ...(place.timeZone ? { timezone: place.timeZone } : {}),
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
  // A display-only listing needs only the city (submissionService.js).
  const listing = form.listingType === 'display_only';
  const venueMissing = listing
    ? !form.city.trim()
    : !form.venueName.trim() || !form.venueAddress.trim() || !form.city.trim();
  /** The message a missing part gets: a refusal, or a reminder. */
  const venueNote = (value, refusal) => {
    if (value.trim()) return {};
    return venueOptional
      ? { hint: `${refusal} You can save without it, but not submit.` }
      : { error: touched ? refusal : null };
  };

  // Worldwide, the market's own first; the current value is always offered.
  const zoneOptions = zoneGroups(event.country, form.timezone);

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

  // Which card is open, and which ones hold a problem — so a refusal in a
  // tab nobody is looking at is marked on its tab rather than invisible.
  const [tab, setTab] = useState('basic');
  const problems = {
    basic: titleInvalid || endsBeforeStart || pinInvalid || (touched && !venueOptional && venueMissing),
    format: perOrderInvalid,
  };
  const ticketed = form.listingType === 'ticketed';
  const tabs = [
    { key: 'basic', label: 'Basic details', icon: 'info' },
    { key: 'description', label: 'Description', icon: 'fileText' },
    ...(ticketed ? [{ key: 'format', label: 'Tickets & format', icon: 'ticket' }] : []),
  ];
  const shown = tabs.some((t) => t.key === tab) ? tab : 'basic';
  const f = {
    event, form, set, setForm, live, listing, venueOptional, venueNote, setVenueName, applyPlace,
    categories, zoneOptions, organizer, titleInvalid, endsBeforeStart, perOrderInvalid,
  };

  return (
    <form onSubmit={save} className="es-dform">
      {event.status === 'pending_review' && (
        <Notice tone="info" title="This event is waiting for review.">
          <p>Saving a change takes it out of the queue and back to draft, so Eventsli reviews what you actually changed. Submit it again afterwards.</p>
        </Notice>
      )}

      <div className="es-dtabs" role="tablist" aria-label="Event details sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`dtab-${t.key}`}
            aria-selected={shown === t.key}
            aria-controls="dtab-panel"
            className="es-dtabs__tab"
            onClick={() => setTab(t.key)}
          >
            <NavIcon name={t.icon} size={18} />
            {t.label}
            {problems[t.key] && <span className="es-dtabs__dot"><span className="sr-only"> — needs attention</span></span>}
          </button>
        ))}
      </div>

      <div className="es-dform__grid">
        <div id="dtab-panel" role="tabpanel" aria-labelledby={`dtab-${shown}`} className="fx-stack fx-min0">
          {shown === 'basic' && <BasicSection f={f} />}
          {shown === 'description' && <DescriptionSection f={f} />}
          {shown === 'format' && <FormatSection f={f} />}
          <FormError error={error} />
        </div>
        <div className="fx-stack fx-min0">
          {/* THE CHARGES COME WITH THE FORM: `feeBearer` — who absorbs the
              platform fee — is edited here, and this is what that choice
              costs. Read-only: every rate is the admin's (BRD §05/§06). */}
          {ticketed && (
            <section className="es-dcard" aria-label="What you are charged">
              <div className="es-ovcard__head">
                <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="receipt" size={24} /></span>
                <div className="fx-min0">
                  <h2 className="es-dcard__title">What you are charged</h2>
                  <p className="es-ovcard__desc">Set by Eventsli, and agreed when the terms were accepted.</p>
                </div>
              </div>
              <FeeSummary event={event} rich />
            </section>
          )}
          <QuickSettings f={f} />
        </div>
      </div>

      <div className="es-dform__bar">
        <SubmitButton busy={busy} busyLabel="Saving…" disabled={blocked || changedKeys.length === 0}>
          <NavIcon name="tick" size={18} /> Save changes
        </SubmitButton>
        <button type="button" className="es-btn es-btn--secondary" disabled={changedKeys.length === 0}
          onClick={() => { setForm(original); setError(null); }}>
          Discard
        </button>
        <span className="es-dform__saved">
          <NavIcon name="clock" size={16} />
          {changedKeys.length > 0 ? 'Unsaved changes' : `Last saved ${ago(event.updatedAt, now)}`}
        </span>
      </div>
    </form>
  );
}

/** "2 minutes ago", from the event's own `updatedAt`. */
function ago(iso, now) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then) || now === null) return '';
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `on ${new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
