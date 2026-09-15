'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { get, post } from '../../../utils/apiClient';
import { useOrganizer } from '../../../hooks/useOrganizer';
import { categoryLabel } from '../../../lib/categories';
import { defaultTimeZone, zonesFor } from '../../../lib/timezones';
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
 * NOT a multi-step wizard, deliberately. Everything beyond this form (tiers,
 * the map, artwork) is edited afterwards on a real event that already exists
 * and can be saved; a wizard holds an organizer's work in browser state, where a
 * closed tab loses it. The guidance a wizard gives lives on the event's
 * overview instead, as a launch checklist.
 *
 * What was wrong with the previous version, and is fixed here:
 *   • The time zone was a free-text box and the API stored whatever it got —
 *     "Toronto" broke every date on that event. It is a list now, by country,
 *     and the API refuses a zone that does not exist.
 *   • How buyers choose (seats, whole tables, either), who carries the fees,
 *     tickets per order and transfers were shown on the overview but settable
 *     NOWHERE an organizer could reach. They are set here.
 *   • A start in the past was accepted without a word.
 *   • On a phone the sticky submit bar sat under the dashboard's bottom tab
 *     bar (see `.es-nav-content .fx-sticky-actions`).
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PURCHASE_MODES = [
  ['seat_only', 'Individual seats', 'Buyers pick seats one by one.'],
  ['table_only', 'Whole tables', 'Buyers book a table and get every seat at it.'],
  ['seat_and_table', 'Seats or whole tables', 'Buyers can do either.'],
];

export default function NewEventForm() {
  const router = useRouter();
  const { loading, organizer, refresh } = useOrganizer();

  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(() => ({
    title: '', category: 'other', venueName: '', venueAddress: '', country: 'CA',
    timezone: defaultTimeZone('CA', browserZone()), startsAt: '', endsAt: '',
    listingType: 'ticketed', purchaseMode: 'seat_only', feeBearer: 'buyer',
    maxTicketsPerOrder: '10', allowTicketTransfer: true, description: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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

  // The organizer's country is the sensible default, and the zone follows it.
  // Adjusted DURING render so the selects never visibly flip after load.
  const [seenCountry, setSeenCountry] = useState(null);
  if (organizer?.country && organizer.country !== seenCountry) {
    setSeenCountry(organizer.country);
    setForm((f) => ({ ...f, country: organizer.country, timezone: defaultTimeZone(organizer.country, browserZone()) }));
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setCountry = (e) => {
    const country = e.target.value;
    setForm((f) => ({ ...f, country, timezone: defaultTimeZone(country, browserZone()) }));
  };

  const ticketed = form.listingType === 'ticketed';
  const startIso = toIso(form.startsAt, form.timezone);
  const endIso = toIso(form.endsAt, form.timezone);
  const startsInPast = Boolean(form.startsAt) && new Date(startIso) <= new Date();
  const endsBeforeStart = Boolean(form.startsAt && form.endsAt) && new Date(endIso) <= new Date(startIso);
  const perOrder = Number(form.maxTicketsPerOrder);
  const perOrderInvalid = ticketed && !(Number.isInteger(perOrder) && perOrder >= 1 && perOrder <= 100);
  const blocked = startsInPast || endsBeforeStart || perOrderInvalid;

  async function submit(e) {
    e.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      const event = await post('/events', {
        title: form.title.trim(),
        category: form.category,
        country: form.country,
        timezone: form.timezone,
        // Anchored to the EVENT's timezone — see toIso below.
        startsAt: startIso,
        endsAt: endIso,
        listingType: form.listingType,
        ...(ticketed ? {
          purchaseMode: form.purchaseMode,
          feeBearer: form.feeBearer,
          maxTicketsPerOrder: perOrder,
          allowTicketTransfer: form.allowTicketTransfer,
        } : {}),
        ...(form.venueName.trim() ? { venueName: form.venueName.trim() } : {}),
        ...(form.venueAddress.trim() ? { venueAddress: form.venueAddress.trim() } : {}),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
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
        lede="The essentials. It stays a private draft — ticket types, the seat map and artwork come next, on the event itself."
      />

      <div className="grid items-start gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <form onSubmit={submit} className="fx-stack" noValidate={false}>
          <Panel title="What it is">
            <Field label="Title" name="title" required minLength={3} maxLength={200} value={form.title} onChange={set('title')} />
            <div className="fx-grid fx-grid--2">
              <Select
                id="ev-category" label="Category" value={form.category} onChange={set('category')}
                options={(categories.length ? categories : ['other']).map((c) => [c, categoryLabel(c)])}
              />
              <Select
                id="ev-type" label="Type" value={form.listingType} onChange={set('listingType')}
                // BRD §12 — a listing with nothing behind it is a real type.
                options={[['ticketed', 'Sell tickets'], ['display_only', 'Listing only — no tickets']]}
                hint={ticketed ? null : 'Shown on Eventsli with no buy button.'}
              />
            </div>
            <div className="fx-stack fx-stack--sm gap-1.5">
              <label htmlFor="ev-description" className="text-sm text-ink">Description</label>
              <textarea id="ev-description" rows={5} maxLength={5000} value={form.description} onChange={set('description')} className="es-input py-2" />
              <p className="text-xs text-subtle">What buyers read on the event page. Optional.</p>
            </div>
          </Panel>

          <Panel title="Where">
            <div className="fx-grid fx-grid--2">
              <Select
                id="ev-country" label="Country" value={form.country} onChange={setCountry}
                options={[['CA', 'Canada'], ['US', 'United States']]}
                hint="Sets the currency — CAD or USD. It locks once a ticket sells."
              />
              <Select
                id="ev-timezone" label="Time zone" value={form.timezone} onChange={set('timezone')}
                options={zonesFor(form.country)}
                hint="Where the event happens. Buyers see times in this zone."
              />
            </div>
            <div className="fx-grid fx-grid--2">
              <Field label="Venue" name="venueName" maxLength={200} placeholder="e.g. The Danforth Music Hall" value={form.venueName} onChange={set('venueName')} />
              <Field label="Address" name="venueAddress" maxLength={300} placeholder="Street, city" value={form.venueAddress} onChange={set('venueAddress')} />
            </div>
          </Panel>

          <Panel title="When">
            <div className="fx-grid fx-grid--2">
              <Field
                label="Starts" type="datetime-local" name="startsAt" required
                hint={`Local time in ${zoneName(form)}.`}
                error={startsInPast ? 'The start has to be in the future.' : null}
                value={form.startsAt} onChange={set('startsAt')}
              />
              <Field
                label="Ends" type="datetime-local" name="endsAt" required
                min={form.startsAt || undefined}
                error={endsBeforeStart ? 'The event has to end after it starts.' : null}
                value={form.endsAt} onChange={set('endsAt')}
              />
            </div>
          </Panel>

          {ticketed && (
            <Panel title="How tickets sell">
              <fieldset className="fx-stack fx-stack--sm">
                <legend className="text-sm text-ink">How buyers choose</legend>
                <div className="fx-grid fx-grid--3">
                  {PURCHASE_MODES.map(([value, label, detail]) => (
                    <label key={value} className="es-card fx-row items-start gap-2.5 p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-wash">
                      <input
                        type="radio" name="purchaseMode" value={value} className="mt-1"
                        checked={form.purchaseMode === value} onChange={set('purchaseMode')}
                      />
                      <span className="fx-min0">
                        <span className="block text-sm text-ink">{label}</span>
                        <span className="block text-xs text-muted">{detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="fx-grid fx-grid--2">
                <Select
                  id="ev-fees" label="Who pays the fees" value={form.feeBearer} onChange={set('feeBearer')}
                  options={[['buyer', 'Buyers — added at checkout'], ['organizer', 'You — taken from your payout']]}
                  hint="Either way every fee is its own line on the order."
                />
                <Field
                  label="Tickets per order" type="number" name="maxTicketsPerOrder" min={1} max={100} required
                  error={perOrderInvalid ? 'Between 1 and 100.' : null}
                  value={form.maxTicketsPerOrder} onChange={set('maxTicketsPerOrder')}
                />
              </div>

              <label className="fx-row items-start gap-2.5 text-sm">
                <input
                  type="checkbox" className="mt-0.5" checked={form.allowTicketTransfer}
                  onChange={(e) => setForm((f) => ({ ...f, allowTicketTransfer: e.target.checked }))}
                />
                <span>
                  <span className="block text-ink">Let buyers pass a ticket on</span>
                  <span className="block text-xs text-muted">Once per ticket. The old code stops working when the new one is issued.</span>
                </span>
              </label>
            </Panel>
          )}

          <FormError error={error} />

          <div className="fx-sticky-actions fx-row">
            <SubmitButton busy={busy} busyLabel="Creating…" disabled={blocked}>Create draft event</SubmitButton>
            <p className="text-xs text-subtle">Nothing is public until Eventsli approves it.</p>
          </div>
        </form>

        <Panel title="What happens next" className="lg:sticky lg:top-6">
          <ol className="fx-stack fx-stack--sm text-sm text-muted">
            {[
              ['Create the draft', 'Nothing is public yet.'],
              ['Add ticket types and the seat map', 'The prices and the seats you sell.'],
              ['Connect payouts', 'So card sales reach your Stripe account.'],
              ['Accept the terms and submit', 'You see every fee before you do.'],
              ['Eventsli reviews it', 'Then it goes on sale.'],
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
      <select id={id} value={value} onChange={onChange} className="es-input" aria-describedby={hint ? `${id}-hint` : undefined}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <p id={`${id}-hint`} className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}

/** The friendly name of the chosen zone, for the date hints. */
function zoneName({ country, timezone }) {
  const found = zonesFor(country).find(([z]) => z === timezone);
  return found ? found[1].split(' — ')[0] + ' time' : timezone;
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
