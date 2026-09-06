'use client';

import { useEffect, useState } from 'react';
import { patch } from '../../utils/apiClient';
import { useOrganizer } from '../../hooks/useOrganizer';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import CreateProfile from '../CreateProfile';
import { Loading } from '../../components/Feedback';

/**
 * The organizer profile.
 *
 * One editable field, and the other one is shown so its absence is not a
 * mystery: `country` is refused by the API on purpose. It decides which Stripe
 * entity the account is onboarded under and resolves the settlement currency,
 * so changing it after events exist would silently reinterpret them. Moving
 * country is a support conversation, not a form field — and saying that here is
 * cheaper than letting someone hunt for the control.
 */
export default function OrganizerProfile() {
  const { loading, organizer, refresh } = useOrganizer();
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  /**
   * Seeded from the loaded profile DURING render, not in an effect — React's
   * documented way to reset state when an input changes. The effect version
   * paints an empty field first and then fills it, so anyone who started typing
   * in that gap has their text replaced.
   */
  const [seenName, setSeenName] = useState(null);
  if (organizer?.displayName && organizer.displayName !== seenName) {
    setSeenName(organizer.displayName);
    setDisplayName(organizer.displayName);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await patch('/organizer', { displayName }, { noRedirect: true });
      setSaved(true);
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading variant="card" />;
  if (!organizer) return <CreateProfile onCreated={refresh} />;

  return (
    <div className="fx-container fx-container--sm fx-stack">
      <h2 className="text-xl">Profile</h2>

      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <Field
          label="Organizer name"
          name="displayName"
          required
          minLength={2}
          maxLength={120}
          hint="What buyers see on your event pages."
          value={displayName}
          onChange={(e) => { setDisplayName(e.target.value); setSaved(false); }}
        />

        <FormError error={error} />
        {saved && <p className="text-sm text-accent">Saved.</p>}

        <SubmitButton
          busy={busy}
          busyLabel="Saving…"
          disabled={displayName.trim() === organizer.displayName}
        >
          Save
        </SubmitButton>
      </form>

      <dl className="fx-stack fx-stack--sm es-card p-5 text-sm">
        <Row term="Country" value={organizer.country}
          note="Fixed. It sets your payout account and your events’ currency — contact support to move." />
        <Row term="Payouts"
          value={organizer.canReceivePayouts ? 'Ready' : organizer.stripeConnected ? 'Incomplete' : 'Not connected'} />
      </dl>
    </div>
  );
}

function Row({ term, value, note }) {
  return (
    <div className="fx-row fx-row--between border-t border-border-base pt-3 first:border-0 first:pt-0">
      <dt className="fx-min0">
        <span className="block text-ink">{term}</span>
        {note && <span className="block text-xs text-subtle">{note}</span>}
      </dt>
      <dd className="whitespace-nowrap text-ink">{value}</dd>
    </div>
  );
}
