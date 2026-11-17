'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { post } from '../../../utils/apiClient';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { useCategories } from '../../../hooks/useCategories';
import { categoryLabel } from '../../../lib/categories';
import { defaultTimeZone, zoneOptions } from '../../../lib/timezones';
import { browserZone } from '../../../lib/eventTime';
import { DEFAULT_COUNTRY } from '../../../lib/markets';
import { monthRange } from '../../../lib/comingSoon';
import { useOpenCountries, openCountryFor } from '../../../hooks/useOpenCountries';
import Field, { SelectField, TextareaField } from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import NavIcon from '../../../components/shell/NavIcon';
import MonthFields from './MonthFields';
import { draftKey } from './wizardModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ANNOUNCE AN EVENT — "Coming soon" (owner, 2026-11-17).
 *
 * One screen, not a wizard: a teaser is a title, a city and a month. The cover
 * is added on the event itself, where every cover is uploaded (it needs the
 * saved event to sign the upload), and it is required before publishing —
 * the API's `teaserBlockers` says so, and the checklist there shows it.
 *
 * Saved as a private draft, like every new event. Venue, exact times, ticket
 * types and payment come later, before ticket sales open.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ComingSoonForm({ organizer }) {
  const router = useRouter();
  const formRef = useRef(null);
  const categories = useCategories();
  const { options: countryOptions, ready: countriesReady } = useOpenCountries();

  const [form, setForm] = useState(() => {
    const country = organizer?.country || DEFAULT_COUNTRY;
    const base = {
      title: '', category: 'other', city: '', description: '',
      country, timezone: defaultTimeZone(country, browserZone()), month: '',
    };
    // Handed over by the AI creator's "set it up yourself": what was already
    // typed comes with it, so nothing is retyped (AiCreator.handOff).
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey('coming_soon')) || 'null')?.form;
      if (saved) {
        return {
          ...base,
          description: typeof saved.description === 'string' ? saved.description : '',
          ...(saved.country ? { country: saved.country } : {}),
          ...(saved.timezone ? { timezone: saved.timezone } : {}),
        };
      }
    } catch { /* storage unavailable: start empty */ }
    return base;
  });
  const [showErrors, setShowErrors] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useFocusFirstInvalid(formRef, attempt);

  // Only the markets an admin has open are offered (as in the wizard).
  const openCountry = countriesReady ? openCountryFor(form.country, countryOptions) : null;
  if (openCountry && openCountry !== form.country) setForm((f) => ({ ...f, country: openCountry }));

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const range = monthRange(form.month, form.timezone);

  const problems = {
    title: form.title.trim().length < 3 ? 'Give your event a title of at least 3 characters.' : null,
    city: form.city.trim().length < 2 ? 'Add the city — it is how people find this event near them.' : null,
    month: !range.startsAt ? 'Choose the month it is happening.' : null,
  };
  const shown = (key) => (showErrors ? problems[key] : null);

  async function submit(e) {
    e.preventDefault();
    if (Object.values(problems).some(Boolean)) {
      setShowErrors(true);
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const event = await post('/events', {
        title: form.title.trim(),
        category: form.category,
        country: form.country,
        timezone: form.timezone,
        city: form.city.trim(),
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        listingType: 'ticketed',
        comingSoon: true,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      }, { noRedirect: true });
      try { sessionStorage.removeItem(draftKey('coming_soon')); } catch { /* fine */ }
      router.push(`/organizer/events/${event.id}?created=1`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="es-wizard es-wizard--center">
      <div className="es-wizard__head">
        <p className="es-eyebrow">Coming soon</p>
        <h1 className="es-wizard__title">Announce your event</h1>
        <p className="es-wizard__lede">
          Just the essentials for now. People can find it and ask to hear when tickets go on sale —
          you add the venue, times and tickets when they are ready.
        </p>
      </div>

      <form ref={formRef} onSubmit={submit} noValidate className="fx-stack">
        <div className="es-card fx-stack fx-stack--sm p-5">
          <Field
            label="Event title" name="title" required minLength={3} maxLength={200} autoFocus
            placeholder="e.g. Summer Jazz Festival"
            error={shown('title')} value={form.title} onChange={set('title')}
          />
          <SelectField
            label="Category" required value={form.category} onChange={set('category')}
            options={categories.list.length
              ? categories.list.map((c) => [c.slug, c.label])
              : [[form.category || 'other', categoryLabel(form.category || 'other')]]}
          />
          <Field
            label="City" name="city" required maxLength={120} autoComplete="address-level2"
            placeholder="e.g. Toronto"
            hint="The venue can wait. The city is what puts it in “events near me”."
            error={shown('city')} value={form.city} onChange={set('city')}
          />
          <div className="fx-grid fx-grid--2">
            <SelectField
              label="Country" required value={form.country} onChange={set('country')}
              options={countryOptions} hint="Sets the currency when tickets go on sale."
            />
            <SelectField
              label="Time zone" required value={form.timezone} onChange={set('timezone')}
              options={zoneOptions(form.country, form.timezone)}
            />
          </div>
          <MonthFields
            value={form.month} timezone={form.timezone}
            onChange={(month) => setForm((f) => ({ ...f, month }))}
            error={shown('month')}
            hint="A rough date is enough. You set the exact day and time before tickets go on sale."
          />
          <TextareaField
            label="A line or two about it" optional rows={3} maxLength={5000}
            hint="What people read on the coming-soon page. You can add it later."
            value={form.description} onChange={set('description')}
          />
          <p className="fx-row items-start text-sm text-muted">
            <span className="text-accent"><NavIcon name="image" size={18} /></span>
            <span className="fx-min0 flex-1">
              Next you add a cover image — the picture people see. It is needed before you publish.
            </span>
          </p>
        </div>

        <FormError error={error} />

        <div className="es-wizard__actions fx-sticky-actions">
          {showErrors && Object.values(problems).some(Boolean) && (
            <p className="es-wizard__alert text-sm text-danger" role="alert">Fix the highlighted fields to continue.</p>
          )}
          <Link href="/organizer/events/new" className="es-btn es-btn--ghost">Change type</Link>
          <SubmitButton busy={busy} busyLabel="Saving…" className="es-btn--lg">
            Save and add a cover <NavIcon name="arrow" size={18} />
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
