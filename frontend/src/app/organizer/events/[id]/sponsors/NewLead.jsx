'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '../../../../utils/apiClient';
import { Panel } from '../../../../components/ui/Page';
import Field, { SelectField, TextareaField } from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';

/** A brand you are already talking to. The proposal is written on its own page next. */
export default function NewLead({ eventId, packages, onCancel }) {
  const router = useRouter();
  const [form, setForm] = useState({ companyName: '', contactName: '', contactEmail: '', contactPhone: '', website: '', packageId: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => String(v).trim() !== ''));
      const deal = await post(`/events/${eventId}/sponsorship/deals`, body, { noRedirect: true });
      router.push(`/organizer/events/${eventId}/sponsors/${deal.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel title="Add a sponsor" description="A brand you are talking to. Next you write and send them a proposal, and they sign and pay online.">
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field label="Company" name="sp-company" required maxLength={120} autoFocus value={form.companyName} onChange={set('companyName')} />
          <Field label="Contact email" name="sp-email" type="email" required value={form.contactEmail} onChange={set('contactEmail')}
            hint="The proposal goes here. They sign in with this address to sign and pay." />
          <Field label="Contact name" name="sp-contact" optional maxLength={120} value={form.contactName} onChange={set('contactName')} />
          <Field label="Phone" name="sp-phone" type="tel" optional maxLength={30} value={form.contactPhone} onChange={set('contactPhone')} />
          <Field label="Website" name="sp-website" type="url" optional placeholder="https://" value={form.website} onChange={set('website')} />
          <SelectField label="Package" name="sp-package" optional value={form.packageId} onChange={set('packageId')}
            options={[['', 'Decide later'], ...packages.filter((p) => p.isActive).map((p) => [p.id, p.name])]} />
        </div>
        <TextareaField label="Notes" name="sp-notes" optional rows={3} maxLength={4000} value={form.notes} onChange={set('notes')}
          hint="Only you see these." />
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy}>Add sponsor</SubmitButton>
          <button type="button" className="es-btn es-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
