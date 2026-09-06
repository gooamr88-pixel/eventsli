'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { get, post } from '../../../utils/apiClient';
import { useOrganizer } from '../../../hooks/useOrganizer';
import Field from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import CreateProfile from '../../CreateProfile';
import { Loading } from '../../../components/Feedback';

/**
 * Create an event.
 *
 * NOT a multi-step wizard, deliberately. `POST /events` needs five things —
 * title, country, timezone, start, end — and everything else (tiers, the seat
 * map, categories, artwork) is edited afterwards on a real event that already
 * exists and can be saved. Splitting five fields across four screens invents
 * ceremony, and worse, it holds an organizer's work in browser state where a
 * closed tab loses it.
 *
 * So: one short form, then straight into the event where the rest happens.
 */
export default function NewEventForm() {
  const router = useRouter();
  const { loading, organizer, refresh } = useOrganizer();

  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    title: '',
    category: 'other',
    venueName: '',
    venueAddress: '',
    country: 'CA',
    timezone: guessTimezone(),
    startsAt: '',
    endsAt: '',
    listingType: 'ticketed',
    description: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/public/event-categories', { noRedirect: true });
        if (!cancelled) setCategories(data?.categories || []);
      } catch { /* the select falls back to the default below */ }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * The organizer's country is the sensible default for their first event, and
   * it is the one they are onboarded under at Stripe.
   *
   * Adjusted DURING render, not in an effect. This is React's documented way to
   * seed state from a value that arrives later: setting state while rendering
   * makes React re-run this component immediately, before it commits. The
   * effect version renders once with the wrong default, paints it, and then
   * corrects — which here means the select visibly flips after load, and an
   * organizer who changed it in that instant has their choice overwritten.
   */
  const [seenCountry, setSeenCountry] = useState(null);
  if (organizer?.country && organizer.country !== seenCountry) {
    setSeenCountry(organizer.country);
    setForm((f) => ({ ...f, country: organizer.country }));
  }

  const endsBeforeStart = form.startsAt && form.endsAt
    && new Date(form.endsAt) <= new Date(form.startsAt);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const event = await post('/events', {
        title: form.title,
        category: form.category,
        country: form.country,
        timezone: form.timezone,
        // datetime-local gives "2026-09-05T20:00" with no zone. Sent as-is, a
        // server reading it as UTC would shift the event by the offset. The
        // API takes ISO 8601, so it is anchored to the event's own timezone
        // here — the field is labelled with that timezone for the same reason.
        startsAt: toIso(form.startsAt, form.timezone),
        endsAt: toIso(form.endsAt, form.timezone),
        listingType: form.listingType,
        ...(form.venueName ? { venueName: form.venueName } : {}),
        ...(form.venueAddress ? { venueAddress: form.venueAddress } : {}),
        ...(form.description ? { description: form.description } : {}),
      }, { noRedirect: true });

      router.push(`/organizer/events/${event.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (loading) return <Loading variant="card" />;
  if (!organizer) return <CreateProfile onCreated={refresh} />;

  return (
    <div className="fx-container fx-container--md fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">New event</h2>
        <p className="max-w-[58ch] text-muted">
          Just the essentials. Tickets, seating and artwork come next, on the event
          itself.
        </p>
      </div>

      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <Field
          label="Title" name="title" required minLength={3} maxLength={200}
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />

        <Select
          label="Category" value={form.category}
          onChange={(v) => setForm((f) => ({ ...f, category: v }))}
          options={(categories.length ? categories : ['other']).map((c) => [c, label(c)])}
        />

        <Select
          label="Country" value={form.country}
          onChange={(v) => setForm((f) => ({ ...f, country: v }))}
          options={[['CA', 'Canada'], ['US', 'United States']]}
          hint="Sets the currency. It is locked once a ticket sells."
        />

        <Field
          label="Time zone" name="timezone" required
          hint="Where the event happens — times are shown to buyers in this zone."
          value={form.timezone}
          onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
        />

        <Field
          label={`Starts (${form.timezone})`} type="datetime-local" name="startsAt" required
          value={form.startsAt}
          onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
        />
        <Field
          label={`Ends (${form.timezone})`} type="datetime-local" name="endsAt" required
          error={endsBeforeStart ? 'The event has to end after it starts.' : null}
          value={form.endsAt}
          onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
        />

        <Field
          label="Venue" name="venueName"
          value={form.venueName}
          onChange={(e) => setForm((f) => ({ ...f, venueName: e.target.value }))}
        />
        <Field
          label="Address" name="venueAddress"
          value={form.venueAddress}
          onChange={(e) => setForm((f) => ({ ...f, venueAddress: e.target.value }))}
        />

        <Select
          label="Type" value={form.listingType}
          onChange={(v) => setForm((f) => ({ ...f, listingType: v }))}
          options={[
            ['ticketed', 'Sell tickets'],
            // BRD §12 — a listing with nothing behind it. A real type, not a
            // degraded one: it is how a poster gets onto the platform.
            ['display_only', 'Listing only — no tickets'],
          ]}
        />

        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="ev-description" className="text-sm text-ink">Description</label>
          <textarea
            id="ev-description" rows={5}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="es-input"
          />
        </div>

        <FormError error={error} />

        <SubmitButton busy={busy} busyLabel="Creating…" disabled={endsBeforeStart}>
          Create event
        </SubmitButton>
      </form>
    </div>
  );
}

function Select({ label: text, value, onChange, options, hint }) {
  const id = `sel-${text.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{text}</label>
      <select
        id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className="es-input"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}

const NAMES = {
  music: 'Music', festival: 'Festival', nightlife: 'Nightlife', sports: 'Sports',
  arts: 'Arts', comedy: 'Comedy', film: 'Film', food_drink: 'Food & drink',
  business: 'Business', community: 'Community', education: 'Learning',
  family: 'Family', other: 'Other',
};
const label = (c) => NAMES[c] || c.replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase());

/** The browser's own zone is right far more often than any default, and it is
 *  editable. Falling back to Toronto rather than UTC: UTC is nobody's event. */
function guessTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';
  } catch {
    return 'America/Toronto';
  }
}

/**
 * `datetime-local` → ISO 8601, anchored to the EVENT's timezone.
 *
 * The input yields "2026-09-05T20:00" with no offset. `new Date(...)` on that
 * reads it in the BROWSER's zone, so an organizer in Vancouver scheduling a
 * Toronto show at 8pm would create it at 11pm. The offset is computed for the
 * target zone at that instant, which also handles daylight saving correctly —
 * a date in July and one in January do not share an offset.
 */
export function toIso(localValue, timeZone) {
  if (!localValue) return localValue;

  /**
   * The SHAPE is validated, not the parse result.
   *
   * `new Date()` was the guard here and it does not work: V8 falls back to a
   * lenient legacy parser, so `new Date("not-a-date:00Z")` is not NaN — it is
   * 2000-01-01T05:00Z. A malformed value therefore sailed past an
   * `isNaN(getTime())` check and became a real timestamp in a request body.
   * Found by a test that fed it junk.
   *
   * `datetime-local` only ever emits YYYY-MM-DDTHH:MM, with optional seconds.
   */
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(localValue)) return localValue;

  const naive = new Date(`${localValue.length === 16 ? `${localValue}:00` : localValue}Z`);
  if (Number.isNaN(naive.getTime())) return localValue;

  // What the wall-clock time would be in `timeZone` if the naive value were
  // UTC. The difference between the two IS the offset to remove.
  const asZoned = new Date(naive.toLocaleString('en-US', { timeZone }));
  const asUtc = new Date(naive.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = asZoned.getTime() - asUtc.getTime();

  return new Date(naive.getTime() - offsetMs).toISOString();
}
