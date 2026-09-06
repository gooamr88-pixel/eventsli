'use client';

import { useState } from 'react';
import { post } from '../utils/apiClient';
import { refreshAuth } from '../hooks/useAuth';
import Field from '../components/forms/Field';
import FormError from '../components/forms/FormError';
import SubmitButton from '../components/forms/SubmitButton';

/**
 * Becoming an organizer. BRD §15 — anyone can, and one account has one profile.
 *
 * Creating the profile is what GRANTS the organizer role, which is why the
 * endpoint has no `requireRole` on it: gating it on already being an organizer
 * would make it unreachable. It also means `refreshAuth()` afterwards is not
 * optional — the access context is cached for a few seconds, so without it the
 * very next request still sees an attendee and the dashboard 403s.
 */
const COUNTRIES = [
  ['CA', 'Canada'],
  ['US', 'United States'],
];

export default function CreateProfile({ onCreated }) {
  const [form, setForm] = useState({ displayName: '', country: 'CA' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/organizer', form, { noRedirect: true });
      // The role follows the profile, and the cached access context does not
      // know that yet.
      await refreshAuth();
      onCreated?.();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="fx-container fx-container--sm fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Start selling tickets</h2>
        <p className="max-w-[58ch] text-muted">
          Set up an organizer profile. You can build an event straight away — connecting
          a payout account comes later, before it goes on sale.
        </p>
      </div>

      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <Field
          label="Organizer name"
          name="displayName"
          required
          minLength={2}
          maxLength={120}
          hint="This is what buyers see on your event pages."
          value={form.displayName}
          onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
        />

        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="org-country" className="text-sm text-ink">Country</label>
          <select
            id="org-country"
            value={form.country}
            onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
            className="rounded-[--es-radius-md] border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink"
          >
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          {/* Not editable afterwards, and the API refuses to change it. It
              decides which Stripe entity you are onboarded under and resolves
              the settlement currency — changing it once events exist would
              silently reinterpret them. Saying so here is cheaper than a
              support conversation later. */}
          <p className="text-xs text-subtle">
            This cannot be changed later — it decides your payout account and the
            currency your events are priced in.
          </p>
        </div>

        <FormError error={error} />

        <SubmitButton busy={busy} busyLabel="Setting up…">Create organizer profile</SubmitButton>
      </form>
    </div>
  );
}
