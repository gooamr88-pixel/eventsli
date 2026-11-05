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
import { PageHeader } from '../../components/ui/Page';
import NavIcon from '../../components/shell/NavIcon';
import { StoreArt } from '../../components/ui/Illustrations';
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

  const hasPayments = (organizer.payments?.choices?.length ?? 0) > 0;

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Your account"
        icon="building"
        title="Organization"
        lede="The details buyers see about you across your event pages and tickets."
        art={<StoreArt />}
      />

      <div className="grid gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="es-dcard" aria-labelledby="org-details">
          <div className="es-tilehead">
            <span className="es-paytile" aria-hidden="true"><NavIcon name="building" size={24} /></span>
            <h2 id="org-details" className="es-paycard__title">Organization details</h2>
          </div>
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
        </section>

        <section className="es-dcard" aria-labelledby="org-account">
          <div className="es-tilehead">
            <span className="es-paytile" aria-hidden="true"><NavIcon name="user" size={24} /></span>
            <h2 id="org-account" className="es-paycard__title">Account</h2>
          </div>
          <dl className="es-acctrows">
            <Row icon="mail" term="Signed in as" value={user?.email || '—'} />
            <Row icon="globe" term="Country" value={organizer.country} note="Fixed — it sets your payout account and your events' currency. Contact support to move." />
            <Row
              icon="card"
              term="Payment methods"
              value={hasPayments ? 'Ready' : 'None yet'}
              link={{ href: '/organizer/payments', label: hasPayments ? 'Manage' : 'Set up' }}
            />
            <Row
              icon="fileText"
              term="Organizer agreement"
              value={organizer.policiesAcceptedAt ? `Accepted ${new Date(organizer.policiesAcceptedAt).toLocaleDateString()}` : '—'}
              link={{ href: '/terms/organizer', label: 'Read' }}
            />
          </dl>
          <Link href="/account/security" className="es-acctrows__go">
            <NavIcon name="shield" size={20} />
            <span className="flex-1">Password and signed-in devices</span>
            <NavIcon name="chevronRight" size={18} />
          </Link>
        </section>
      </div>
    </div>
  );
}

function Row({ icon, term, value, note, link }) {
  return (
    <div className="es-acctrows__row">
      <NavIcon name={icon} size={20} />
      <dt className="fx-min0">
        <span className="block font-semibold text-ink">{term}</span>
        {note && <span className="block text-xs text-muted">{note}</span>}
      </dt>
      <dd className="fx-break text-right text-muted">
        {value}
        {link && <> · <Link href={link.href} className="font-semibold text-accent">{link.label}</Link></>}
      </dd>
    </div>
  );
}
