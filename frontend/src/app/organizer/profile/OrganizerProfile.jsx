'use client';

import { useState } from 'react';
import Link from 'next/link';
import { patch } from '../../utils/apiClient';
import { useOrganizer } from '../../hooks/useOrganizer';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ui/Toast';
import Field, { TextareaField } from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import CreateProfile from '../CreateProfile';
import { PageHeader, Panel } from '../../components/ui/Page';
import { Loading } from '../../components/Feedback';

/**
 * The organization: what buyers see, and the details that are fixed.
 *
 * The organization name, brand and description are editable here at any time.
 * `country` is shown but refused by the API on purpose: it decides which Stripe
 * entity the account is onboarded under and the settlement currency, so
 * changing it after events exist would silently reinterpret them.
 *
 * An organizer from before the setup step, with details missing, gets the setup
 * form itself rather than a partial editor.
 */
function fromOrganizer(o) {
  return { legalName: o?.legalName || '', displayName: o?.displayName || '', description: o?.description || '' };
}

export default function OrganizerProfile() {
  const { loading, organizer, refresh } = useOrganizer();
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(() => fromOrganizer(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Seeded DURING render, not in an effect: the effect version paints an empty
  // field first, and anyone who started typing in that gap loses their text.
  const [seen, setSeen] = useState(null);
  const signature = organizer ? JSON.stringify(fromOrganizer(organizer)) : null;
  if (signature && signature !== seen) {
    setSeen(signature);
    setForm(fromOrganizer(organizer));
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const original = fromOrganizer(organizer);
  const changed = Object.keys(form).filter((k) => form[k].trim() !== original[k]);
  const invalid = form.legalName.trim().length < 2 || form.displayName.trim().length < 2 || form.description.trim().length < 20;

  async function submit(e) {
    e.preventDefault();
    if (invalid || changed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await patch('/organizer', Object.fromEntries(changed.map((k) => [k, form[k].trim()])), { noRedirect: true });
      toast.success('Organization details saved.');
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading variant="card" />;
  if (!organizer || !organizer.setupComplete) return <CreateProfile organizer={organizer} onCreated={refresh} />;

  return (
    <div className="fx-stack">
      <PageHeader eyebrow="Your account" title="Organization" lede="Who buyers see they are buying from, and the details that are fixed." />

      <div className="grid gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Organization details">
          <form onSubmit={submit} className="fx-stack fx-stack--sm">
            <Field
              label="Organization name" name="legalName" required minLength={2} maxLength={160}
              hint="The company, club or collective behind your events."
              value={form.legalName} onChange={set('legalName')}
            />
            <Field
              label="Brand name" name="displayName" required minLength={2} maxLength={120}
              hint="What buyers see on your event pages and tickets."
              value={form.displayName} onChange={set('displayName')}
            />
            <TextareaField
              label="Description" name="description" required minLength={20} maxLength={2000} rows={4}
              error={form.description.trim().length > 0 && form.description.trim().length < 20 ? 'At least 20 characters.' : null}
              value={form.description} onChange={set('description')}
            />
            <FormError error={error} />
            <div className="fx-row">
              <SubmitButton busy={busy} busyLabel="Saving…" disabled={invalid || changed.length === 0}>
                Save changes
              </SubmitButton>
              {changed.length > 0 && (
                <button type="button" className="es-btn es-btn--ghost" onClick={() => { setForm(original); setError(null); }}>
                  Discard
                </button>
              )}
            </div>
          </form>
        </Panel>

        <Panel title="Account">
          <dl className="fx-stack fx-stack--sm text-sm">
            <Row term="Signed in as" value={user?.email || '—'} />
            <Row term="Country" value={organizer.country} note="Fixed — it sets your payout account and your events' currency. Contact support to move." />
            <Row
              term="Payment methods"
              value={(organizer.payments?.choices?.length ?? 0) > 0 ? 'Ready' : 'None yet'}
              link={{ href: '/organizer/payments', label: (organizer.payments?.choices?.length ?? 0) > 0 ? 'Manage' : 'Set up' }}
            />
            <Row
              term="Organizer agreement"
              value={organizer.policiesAcceptedAt ? `Accepted ${new Date(organizer.policiesAcceptedAt).toLocaleDateString()}` : '—'}
              link={{ href: '/terms/organizer', label: 'Read' }}
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
