'use client';

import { useState } from 'react';
import { patch } from '../../utils/apiClient';
import { useToast } from '../../components/ui/Toast';
import Field, { SelectField, TextareaField } from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import NavIcon from '../../components/shell/NavIcon';

/**
 * Billing details: who Eventsli's commission invoices are addressed to
 * (20261123110000). No invoice is issued until they are complete — the address,
 * and either "registered for tax" with the number or "not registered" — and
 * each invoice keeps the details it was issued with, so a later change here
 * never rewrites one already sent.
 *
 * The rules match the API's: address 10–500 characters; a tax number only
 * when registered, 3–40 letters, digits, spaces, dots, dashes or slashes.
 */
const TAX_ID = /^[A-Za-z0-9][A-Za-z0-9 ./-]{1,38}[A-Za-z0-9]$/;

function fromOrganizer(o) {
  return { billingAddress: o?.billingAddress || '', taxStatus: o?.taxStatus || '', taxId: o?.taxId || '' };
}

export default function BillingDetails({ organizer, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => fromOrganizer(organizer));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Re-seeded during render when the saved values change (see OrganizerProfile).
  const [seen, setSeen] = useState(() => JSON.stringify(fromOrganizer(organizer)));
  const signature = JSON.stringify(fromOrganizer(organizer));
  if (signature !== seen) {
    setSeen(signature);
    setForm(fromOrganizer(organizer));
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const address = form.billingAddress.trim();
  const taxId = form.taxId.trim();
  const addressError = address.length > 0 && address.length < 10 ? 'Street, city, postal code and country.' : null;
  const taxIdError = form.taxStatus === 'registered' && taxId.length > 0 && !TAX_ID.test(taxId)
    ? '3–40 letters, digits, spaces, dots, dashes or slashes.' : null;
  const complete = address.length >= 10 && (form.taxStatus === 'not_registered'
    || (form.taxStatus === 'registered' && TAX_ID.test(taxId)));
  const original = fromOrganizer(organizer);
  const changed = address !== original.billingAddress || form.taxStatus !== original.taxStatus
    || (form.taxStatus === 'registered' && taxId !== original.taxId);

  async function submit(e) {
    e.preventDefault();
    if (!complete || !changed) return;
    setBusy(true);
    setError(null);
    try {
      await patch('/organizer', {
        billingAddress: address,
        taxStatus: form.taxStatus,
        ...(form.taxStatus === 'registered' ? { taxId } : {}),
      }, { noRedirect: true });
      toast.success('Billing details saved.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="billing" className="es-dcard" aria-labelledby="org-billing">
      <div className="es-tilehead">
        <span className="es-paytile" aria-hidden="true"><NavIcon name="receipt" size={24} /></span>
        <h2 id="org-billing" className="es-paycard__title">Billing details</h2>
      </div>
      <p className="text-sm text-muted">
        Printed on the commission invoices Eventsli sends you for sales you take yourself (at the door, or paid to you
        directly). {organizer.billingComplete
          ? 'Complete. A change applies to invoices issued from now on.'
          : 'Eventsli cannot issue you an invoice until these are complete.'}
      </p>
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <TextareaField
          label="Billing address" name="billingAddress" required maxLength={500} rows={3}
          hint={`Street, city, postal code and country, as registered for ${organizer.legalName || 'your organization'}.`}
          error={addressError}
          value={form.billingAddress} onChange={set('billingAddress')}
        />
        <SelectField
          label="Tax registration" name="taxStatus" required
          hint="Registered for VAT, GST, sales tax or similar where you are based?"
          options={[['', 'Choose…'], ['registered', 'Registered for tax'], ['not_registered', 'Not registered for tax']]}
          value={form.taxStatus} onChange={set('taxStatus')}
        />
        {form.taxStatus === 'registered' && (
          <Field
            label="Tax number" name="taxId" required maxLength={40}
            hint="As it appears on your registration certificate."
            error={taxIdError}
            value={form.taxId} onChange={set('taxId')}
          />
        )}
        <FormError error={error} />
        <div>
          <SubmitButton busy={busy} busyLabel="Saving…" disabled={!complete || !changed}>Save billing details</SubmitButton>
        </div>
      </form>
    </section>
  );
}
