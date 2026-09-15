'use client';

import { useEffect, useState } from 'react';
import { get, patch } from '../../../utils/apiClient';
import { categoryLabel } from '../../../lib/categories';
import { zonesFor } from '../../../lib/timezones';
import { toLocalInput } from '../../../lib/eventTime';
import { toIso } from '../new/NewEventForm';
import { useToast } from '../../../components/ui/Toast';
import { Panel } from '../../../components/ui/Page';
import Field from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
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
 *   • on sale / suspended — only the description, tickets per order and
 *     transfers; the rest is shown disabled and changes go through Eventsli;
 *   • once a ticket has sold, listing type, purchase mode and who pays the fee
 *     are fixed — the API says so, and its sentence is shown.
 *
 * Only CHANGED fields are sent, so a refusal names the field the organizer
 * actually touched.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const LIVE_EDITABLE = new Set(['description', 'maxTicketsPerOrder', 'allowTicketTransfer']);

function fromEvent(event) {
  return {
    title: event.title || '',
    category: event.category || 'other',
    description: event.description || '',
    venueName: event.venue?.name || '',
    venueAddress: event.venue?.address || '',
    timezone: event.timezone,
    startsAt: toLocalInput(event.startsAt, event.timezone),
    endsAt: toLocalInput(event.endsAt, event.timezone),
    listingType: event.listingType || 'ticketed',
    purchaseMode: event.purchaseMode || 'seat_only',
    feeBearer: event.fees?.feeBearer || 'buyer',
    maxTicketsPerOrder: String(event.rules?.maxTicketsPerOrder ?? ''),
    allowTicketTransfer: Boolean(event.rules?.allowTicketTransfer),
  };
}

export default function EventDetailsEditor({ event, onSaved }) {
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(() => fromEvent(event));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Re-seeded when the event itself changes (after a save, or another action
  // on the page), during render rather than in an effect.
  const [seenVersion, setSeenVersion] = useState(event.updatedAt);
  if (event.updatedAt !== seenVersion) {
    setSeenVersion(event.updatedAt);
    setForm(fromEvent(event));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/public/event-categories', { noRedirect: true });
        if (!cancelled) setCategories(data?.categories || []);
      } catch { /* the current category stays selectable */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const live = event.status === 'published' || event.status === 'suspended';
  const locked = (key) => live && !LIVE_EDITABLE.has(key);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const original = fromEvent(event);
  const changedKeys = Object.keys(form).filter((k) => form[k] !== original[k]);
  const datesMoved = ['startsAt', 'endsAt', 'timezone'].some((k) => changedKeys.includes(k));

  const endsBeforeStart = form.startsAt && form.endsAt
    && new Date(toIso(form.endsAt, form.timezone)) <= new Date(toIso(form.startsAt, form.timezone));
  const perOrder = Number(form.maxTicketsPerOrder);
  const perOrderInvalid = !(Number.isInteger(perOrder) && perOrder >= 1 && perOrder <= 100);
  const titleInvalid = form.title.trim().length < 3;
  const blocked = endsBeforeStart || perOrderInvalid || titleInvalid;

  const zones = zonesFor(event.country);
  const zoneOptions = zones.some(([z]) => z === form.timezone) ? zones : [[form.timezone, form.timezone], ...zones];

  async function save(e) {
    e.preventDefault();
    if (blocked || changedKeys.length === 0) return;

    const body = {};
    for (const key of changedKeys) {
      if (key === 'startsAt' || key === 'endsAt' || key === 'timezone') continue;
      if (key === 'maxTicketsPerOrder') body.maxTicketsPerOrder = perOrder;
      else if (key === 'venueName' || key === 'venueAddress') body[key] = form[key].trim() || null;
      else if (typeof form[key] === 'string') body[key] = form[key].trim();
      else body[key] = form[key];
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
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Event details">
      {event.status === 'pending_review' && (
        <Notice tone="info" title="This event is waiting for review.">
          <p>Saving a change takes it out of the queue and back to draft, so Eventsli reviews what you actually changed. Submit it again afterwards.</p>
        </Notice>
      )}
      {live && (
        <Notice tone="info" title="This event is on sale.">
          <p>You can change the description, tickets per order and transfers here. Anything a reviewer approved — the title, dates, venue, how tickets sell — goes through Eventsli.</p>
        </Notice>
      )}

      <form onSubmit={save} className="fx-stack fx-stack--sm">
        <Field label="Title" name="title" required minLength={3} maxLength={200} disabled={locked('title')}
          error={titleInvalid ? 'At least 3 characters.' : null}
          value={form.title} onChange={set('title')} />

        <div className="fx-grid fx-grid--2">
          <Select id="ed-category" label="Category" value={form.category} onChange={set('category')} disabled={locked('category')}
            options={(categories.length ? categories : [form.category]).map((c) => [c, categoryLabel(c)])} />
          <Select id="ed-listing" label="Type" value={form.listingType} onChange={set('listingType')} disabled={locked('listingType')}
            options={[['ticketed', 'Sell tickets'], ['display_only', 'Listing only — no tickets']]} />
        </div>

        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="ed-description" className="text-sm text-ink">Description</label>
          <textarea id="ed-description" rows={5} maxLength={5000} value={form.description}
            onChange={set('description')} className="es-input py-2" />
        </div>

        <div className="fx-grid fx-grid--2">
          <Field label="Venue" name="venueName" maxLength={200} disabled={locked('venueName')}
            value={form.venueName} onChange={set('venueName')} />
          <Field label="Address" name="venueAddress" maxLength={300} disabled={locked('venueAddress')}
            value={form.venueAddress} onChange={set('venueAddress')} />
        </div>

        <div className="fx-grid fx-grid--2">
          <Field label="Starts" type="datetime-local" name="startsAt" required disabled={locked('startsAt')}
            value={form.startsAt} onChange={set('startsAt')} />
          <Field label="Ends" type="datetime-local" name="endsAt" required disabled={locked('endsAt')}
            min={form.startsAt || undefined}
            error={endsBeforeStart ? 'The event has to end after it starts.' : null}
            value={form.endsAt} onChange={set('endsAt')} />
        </div>
        <Select id="ed-zone" label="Time zone" value={form.timezone} onChange={set('timezone')} disabled={locked('timezone')}
          options={zoneOptions} hint="Both times are local to the venue in this zone." />

        {form.listingType === 'ticketed' && (
          <>
            <div className="fx-grid fx-grid--2">
              <Select id="ed-mode" label="How buyers choose" value={form.purchaseMode} onChange={set('purchaseMode')}
                disabled={locked('purchaseMode')}
                options={[['seat_only', 'Individual seats'], ['table_only', 'Whole tables'], ['seat_and_table', 'Seats or whole tables']]} />
              <Select id="ed-fees" label="Who pays the fees" value={form.feeBearer} onChange={set('feeBearer')}
                disabled={locked('feeBearer')}
                options={[['buyer', 'Buyers — added at checkout'], ['organizer', 'You — taken from your payout']]} />
            </div>
            <div className="fx-grid fx-grid--2">
              <Field label="Tickets per order" type="number" name="maxTicketsPerOrder" min={1} max={100} required
                error={perOrderInvalid ? 'Between 1 and 100.' : null}
                value={form.maxTicketsPerOrder} onChange={set('maxTicketsPerOrder')} />
              <label className="fx-row items-start gap-2.5 self-end pb-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={form.allowTicketTransfer}
                  onChange={(e) => setForm((f) => ({ ...f, allowTicketTransfer: e.target.checked }))} />
                <span>
                  <span className="block text-ink">Let buyers pass a ticket on</span>
                  <span className="block text-xs text-muted">Once per ticket.</span>
                </span>
              </label>
            </div>
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

function Select({ id, label, value, onChange, options, hint, disabled }) {
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      <select id={id} value={value} onChange={onChange} disabled={disabled} className="es-input"
        aria-describedby={hint ? `${id}-hint` : undefined}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <p id={`${id}-hint`} className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}
