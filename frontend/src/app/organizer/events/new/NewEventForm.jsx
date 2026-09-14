'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { get, post } from '../../../utils/apiClient';
import { useOrganizer } from '../../../hooks/useOrganizer';
import { categoryLabel } from '../../../lib/categories';
import Field from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import CreateProfile from '../../CreateProfile';
import { PageHeader, Panel } from '../../../components/ui/Page';
import { Loading } from '../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Create an event.
 *
 * NOT a multi-step wizard, deliberately. `POST /events` needs five things —
 * title, country, timezone, start, end — and everything else (tiers, the map,
 * artwork) is edited afterwards on a real event that already exists and can be
 * saved. A wizard holds an organizer's work in browser state, where a closed tab
 * loses it. The guidance a wizard gives lives on the event's overview instead,
 * as a launch checklist.
 *
 * So: one form in three short sections, and "what happens next" beside it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function NewEventForm() {
  const router = useRouter();
  const { loading, organizer, refresh } = useOrganizer();

  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    title: '', category: 'other', venueName: '', venueAddress: '', country: 'CA',
    timezone: guessTimezone(), startsAt: '', endsAt: '', listingType: 'ticketed', description: '',
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

  // The organizer's country is the sensible default. Adjusted DURING render so
  // the select never visibly flips after load.
  const [seenCountry, setSeenCountry] = useState(null);
  if (organizer?.country && organizer.country !== seenCountry) {
    setSeenCountry(organizer.country);
    setForm((f) => ({ ...f, country: organizer.country }));
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const endsBeforeStart = form.startsAt && form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt);

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
        // Anchored to the EVENT's timezone — see toIso below.
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
    <div className="fx-stack">
      <PageHeader
        eyebrow="New event"
        title="Create an event"
        lede="Just the essentials. It stays a private draft — ticket types, the seat map and artwork come next, on the event itself."
      />

      <div className="grid items-start gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <form onSubmit={submit} className="fx-stack">
          <Panel title="What it is">
            <Field label="Title" name="title" required minLength={3} maxLength={200} value={form.title} onChange={set('title')} />
            <div className="fx-grid fx-grid--2">
              <Select
                id="ev-category" label="Category" value={form.category} onChange={set('category')}
                options={(categories.length ? categories : ['other']).map((c) => [c, label(c)])}
              />
              <Select
                id="ev-type" label="Type" value={form.listingType} onChange={set('listingType')}
                // BRD §12 — a listing with nothing behind it is a real type.
                options={[['ticketed', 'Sell tickets'], ['display_only', 'Listing only — no tickets']]}
              />
            </div>
            <div className="fx-stack fx-stack--sm gap-1.5">
              <label htmlFor="ev-description" className="text-sm text-ink">Description</label>
              <textarea id="ev-description" rows={5} value={form.description} onChange={set('description')} className="es-input py-2" />
              <p className="text-xs text-subtle">What buyers read on the event page. You can change it later.</p>
            </div>
          </Panel>

          <Panel title="When">
            <Field
              label="Time zone" name="timezone" required
              hint="Where the event happens — buyers see times in this zone."
              value={form.timezone} onChange={set('timezone')}
            />
            <div className="fx-grid fx-grid--2">
              <Field label={`Starts (${form.timezone})`} type="datetime-local" name="startsAt" required value={form.startsAt} onChange={set('startsAt')} />
              <Field
                label={`Ends (${form.timezone})`} type="datetime-local" name="endsAt" required
                error={endsBeforeStart ? 'The event has to end after it starts.' : null}
                value={form.endsAt} onChange={set('endsAt')}
              />
            </div>
          </Panel>

          <Panel title="Where">
            <Select
              id="ev-country" label="Country" value={form.country} onChange={set('country')}
              options={[['CA', 'Canada'], ['US', 'United States']]}
              hint="Sets the currency — CAD or USD. It locks once a ticket sells."
            />
            <div className="fx-grid fx-grid--2">
              <Field label="Venue" name="venueName" value={form.venueName} onChange={set('venueName')} />
              <Field label="Address" name="venueAddress" value={form.venueAddress} onChange={set('venueAddress')} />
            </div>
          </Panel>

          <FormError error={error} />

          <div className="fx-sticky-actions fx-row">
            <SubmitButton busy={busy} busyLabel="Creating…" disabled={endsBeforeStart}>Create draft event</SubmitButton>
          </div>
        </form>

        <Panel title="What happens next" className="lg:sticky lg:top-6">
          <ol className="fx-stack fx-stack--sm text-sm text-muted">
            {[
              ['Create the draft', 'Nothing is public yet.'],
              ['Add ticket types and the seat map', 'The prices and the seats you sell.'],
              ['Connect payouts', 'So card sales reach your Stripe account.'],
              ['Accept the terms and submit', 'You see every fee before you do.'],
              ['Eventsli reviews it', 'Usually within a day — then it goes on sale.'],
            ].map(([title, detail], i) => (
              <li key={title} className="es-marquee__row py-2">
                <span className="es-marquee__index text-lg" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                <span className="fx-min0">
                  <span className="block text-ink">{title}</span>
                  <span className="block">{detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}

function Select({ id, label: text, value, onChange, options, hint }) {
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{text}</label>
      <select id={id} value={value} onChange={onChange} className="es-input">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}

const label = categoryLabel;

/** The browser's own zone is right far more often than any default, and it is editable. */
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

  const asZoned = new Date(naive.toLocaleString('en-US', { timeZone }));
  const asUtc = new Date(naive.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = asZoned.getTime() - asUtc.getTime();

  return new Date(naive.getTime() - offsetMs).toISOString();
}
