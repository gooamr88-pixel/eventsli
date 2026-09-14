'use client';

import { useState } from 'react';
import Link from 'next/link';
import { patch } from '../../utils/apiClient';
import { useOrganizer } from '../../hooks/useOrganizer';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ui/Toast';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import CreateProfile from '../CreateProfile';
import { PageHeader, Panel } from '../../components/ui/Page';
import { Loading } from '../../components/Feedback';

/**
 * The organizer profile.
 *
 * One editable field, and the other is shown so its absence is not a mystery:
 * `country` is refused by the API on purpose. It decides which Stripe entity the
 * account is onboarded under and the settlement currency, so changing it after
 * events exist would silently reinterpret them.
 */
export default function OrganizerProfile() {
  const { loading, organizer, refresh } = useOrganizer();
  const { user } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Seeded DURING render, not in an effect: the effect version paints an empty
  // field first, and anyone who started typing in that gap loses their text.
  const [seenName, setSeenName] = useState(null);
  if (organizer?.displayName && organizer.displayName !== seenName) {
    setSeenName(organizer.displayName);
    setDisplayName(organizer.displayName);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await patch('/organizer', { displayName }, { noRedirect: true });
      toast.success('Profile saved.');
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
    <div className="fx-stack">
      <PageHeader eyebrow="Your account" title="Profile" lede="How you appear to buyers, and the details that are fixed." />

      <div className="grid gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Public name">
          <form onSubmit={submit} className="fx-stack fx-stack--sm">
            <Field
              label="Organizer name"
              name="displayName"
              required
              minLength={2}
              maxLength={120}
              hint="What buyers see on your event pages and tickets."
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <FormError error={error} />
            <div>
              <SubmitButton busy={busy} busyLabel="Saving…" disabled={displayName.trim() === organizer.displayName}>
                Save
              </SubmitButton>
            </div>
          </form>
        </Panel>

        <Panel title="Account">
          <dl className="fx-stack fx-stack--sm text-sm">
            <Row term="Signed in as" value={user?.email || '—'} />
            <Row term="Country" value={organizer.country} note="Fixed — it sets your payout account and your events' currency. Contact support to move." />
            <Row
              term="Payouts"
              value={organizer.canReceivePayouts ? 'Ready' : organizer.stripeConnected ? 'Incomplete' : 'Not connected'}
              link={organizer.canReceivePayouts ? null : { href: '/organizer/payouts', label: 'Set up' }}
            />
          </dl>
          <Link href="/account/security" className="text-sm text-accent">Password and signed-in devices</Link>
        </Panel>
      </div>
    </div>
  );
}

function Row({ term, value, note, link }) {
  return (
    <div className="fx-row fx-row--between border-t border-border-base pt-3 first:border-0 first:pt-0">
      <dt className="fx-min0 flex-1">
        <span className="block text-ink">{term}</span>
        {note && <span className="block text-xs text-subtle">{note}</span>}
      </dt>
      <dd className="fx-break text-right text-ink">
        {value}
        {link && <> · <Link href={link.href} className="text-accent">{link.label}</Link></>}
      </dd>
    </div>
  );
}
