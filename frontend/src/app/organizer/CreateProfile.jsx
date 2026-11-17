'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { get, patch, post } from '../utils/apiClient';
import { refreshAuth } from '../hooks/useAuth';
import Field, { SelectField, TextareaField } from '../components/forms/Field';
import FormError from '../components/forms/FormError';
import SubmitButton from '../components/forms/SubmitButton';
import NavIcon from '../components/shell/NavIcon';
import { useShellFocus } from '../components/shell/shellFocus';
import { OnboardingProgress } from './OnboardingProgress';
import { DEFAULT_COUNTRY, currencyFor, guessCountry } from '../lib/markets';
import { useOpenCountries, openCountryFor } from '../hooks/useOpenCountries';

/**
 * What choosing this country means, said before it is fixed for good: the
 * currency, and whether buyers can pay by card or the organizer collects.
 */
function countryHint(country, cardCountries) {
  const currency = currencyFor(country);
  const payments = cardCountries.includes(country)
    ? 'Buyers can pay by card, or with your own payment methods.'
    : 'Online card payments are not available here yet: you sell tickets directly — in person, by bank transfer or mobile money — and record each sale.';
  return `Where your organization is based. Your events are priced in ${currency}. ${payments} This cannot be changed later.`;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Set up the organization — step 1 of getting to a first event.
 *
 * BRD §15 — anyone can become an organizer, and creating this profile is what
 * GRANTS the role, so `refreshAuth()` afterwards is not optional: the access
 * context is cached for a few seconds and the very next request would still see
 * an attendee.
 *
 * Two uses, one form:
 *   · no organizer yet   → POST, which creates it (and asks the country)
 *   · organizer from before this step existed, missing some of it → PATCH the
 *     missing fields; the country is already fixed and not asked again
 *
 * The organization name typed at sign-up is pre-filled, so nobody is asked the
 * same question twice in their first five minutes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
// The markets Eventsli sells in, from the one list — see lib/markets.

export default function CreateProfile({ organizer = null, onCreated }) {
  const agreeId = useId();
  const [form, setForm] = useState(() => ({
    legalName: organizer?.legalName || '',
    displayName: organizer?.displayName || '',
    description: organizer?.description || '',
    country: organizer?.country || DEFAULT_COUNTRY,
    acceptPolicies: Boolean(organizer?.policiesAcceptedAt),
  }));
  const [brandTouched, setBrandTouched] = useState(Boolean(organizer?.displayName));
  // Only the markets an admin has open are offered; a closed default moves to
  // the first open one (during render, so the closed one never paints).
  const { options: countryOptions, cardCountries, ready: countriesReady } = useOpenCountries();
  const openCountry = countriesReady && !organizer ? openCountryFor(form.country, countryOptions) : null;
  if (openCountry && openCountry !== form.country) setForm((f) => ({ ...f, country: openCountry }));
  // Start where they are, not in Canada: their clock or language names the
  // country more often than not. Once, when the open list arrives — during
  // render, like the move above, so Canada never paints first. Safe to read the
  // browser here: this form only renders after the organizer fetch, in the
  // browser, never in the server's HTML.
  const [guessed, setGuessed] = useState(false);
  if (!organizer && !guessed && countriesReady) {
    setGuessed(true);
    const guess = guessCountry();
    if (guess && guess !== form.country && countryOptions.some(([code]) => code === guess)) {
      setForm((f) => ({ ...f, country: guess }));
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A task, not a place: this form is rendered on the dashboard's route, and on
  // a phone it sat under an app bar reading "Dashboard" and above Your events and
  // Payments tabs that each led back to this same form. See shellFocus.js.
  useShellFocus({ title: 'Set up your organization' });

  // Pre-fill from sign-up. Only into empty fields, so a slow answer never
  // overwrites what someone has already started typing.
  useEffect(() => {
    if (organizer) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const defaults = await get('/organizer/setup-defaults', { noRedirect: true, cache: 'no-store' });
        if (cancelled || !defaults?.organizationName) return;
        setForm((f) => ({
          ...f,
          legalName: f.legalName || defaults.organizationName,
          displayName: f.displayName || defaults.organizationName,
        }));
      } catch { /* the fields simply start empty */ }
    })();
    return () => { cancelled = true; };
  }, [organizer]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  // Until the brand is edited on its own, it follows the organization name —
  // most organizers sell under the same name, and typing it twice is friction.
  const setLegal = (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, legalName: value, ...(brandTouched ? {} : { displayName: value }) }));
  };

  const descriptionShort = form.description.trim().length > 0 && form.description.trim().length < 20;
  const ready = form.legalName.trim().length >= 2
    && form.displayName.trim().length >= 2
    && form.description.trim().length >= 20
    && form.acceptPolicies;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const body = {
      legalName: form.legalName.trim(),
      displayName: form.displayName.trim(),
      description: form.description.trim(),
      acceptPolicies: true,
    };
    try {
      if (organizer) await patch('/organizer', body, { noRedirect: true });
      else await post('/organizer', { ...body, country: form.country }, { noRedirect: true });
      await refreshAuth();
      onCreated?.();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="es-wizard es-wizard--center">
      <OnboardingProgress current="organization" />

      <div className="es-wizard__head">
        <h1 className="es-wizard__title">Tell us about your organization</h1>
        <p className="es-wizard__lede">
          This is who buyers see they are buying from. You can change the names and description later.
        </p>
      </div>

      <form onSubmit={submit} className="es-card fx-stack fx-stack--sm p-5">
        <Field
          label="Organization name" name="legalName" required minLength={2} maxLength={160}
          autoComplete="organization"
          hint="The company, club or collective behind your events."
          value={form.legalName} onChange={setLegal}
        />
        <Field
          label="Brand name" name="displayName" required minLength={2} maxLength={120}
          hint="What buyers see on your event pages and tickets. Often the same as the organization."
          value={form.displayName}
          onChange={(e) => { setBrandTouched(true); set('displayName')(e); }}
        />
        <TextareaField
          label="Description" name="description" required minLength={20} maxLength={2000} rows={4}
          placeholder="e.g. We host live jazz nights and dinner shows in downtown Toronto."
          hint="A sentence or two about what you organize."
          error={descriptionShort ? `A little more — at least 20 characters (${20 - form.description.trim().length} to go).` : null}
          value={form.description} onChange={set('description')}
        />

        {!organizer && (
          <SelectField
            label="Country" required value={form.country}
            onChange={set('country')}
            options={countryOptions}
            // Not editable afterwards, and the API refuses to change it: it
            // decides which Stripe entity you are onboarded under and the
            // currency your events are priced in.
            hint={countryHint(form.country, cardCountries)}
          />
        )}

        <label htmlFor={agreeId} className="es-check mt-1">
          <input
            id={agreeId} type="checkbox" className="es-check__box" required
            checked={form.acceptPolicies}
            onChange={(e) => setForm((f) => ({ ...f, acceptPolicies: e.target.checked }))}
          />
          <span className="text-sm text-ink">
            I agree to the{' '}
            <Link href="/terms/organizer" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
              organizer agreement<span className="sr-only"> (opens in a new tab)</span>
            </Link>{' '}
            and confirm I am allowed to sell tickets for this organization.
            <span className="es-req" aria-hidden="true">*</span>
          </span>
        </label>

        <FormError error={error} />

        <div className="es-wizard__actions pt-2">
          <SubmitButton busy={busy} busyLabel="Saving…" disabled={!ready} className="es-btn--lg">
            Save and continue
            <NavIcon name="arrow" size={18} />
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
