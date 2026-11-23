'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '../../../../utils/apiClient';
import { Panel } from '../../../../components/ui/Page';
import Field, { TextareaField } from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';

/** A business you already work with. The offer is sent from its own page next. */
export default function NewVendor({ eventId, onCancel }) {
  const router = useRouter();
  const [form, setForm] = useState({ businessName: '', contactEmail: '', contactName: '', contactPhone: '', category: '', description: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => String(v).trim() !== ''));
      const app = await post(`/events/${eventId}/vendors/applications`, body, { noRedirect: true });
      router.push(`/organizer/events/${eventId}/vendors/${app.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <Panel title="Add a vendor" description="A business you already work with. You send them an offer from the next screen.">
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field label="Business" name="nv-business" required maxLength={120} autoFocus value={form.businessName} onChange={set('businessName')} />
          <Field label="Contact email" name="nv-email" type="email" required value={form.contactEmail} onChange={set('contactEmail')}
            hint="The offer goes here. They sign in with this address to accept and pay." />
          <Field label="Contact name" name="nv-name" optional maxLength={120} value={form.contactName} onChange={set('contactName')} />
          <Field label="Phone" name="nv-phone" type="tel" optional maxLength={30} value={form.contactPhone} onChange={set('contactPhone')} />
          <Field label="Category" name="nv-category" optional maxLength={60} value={form.category} onChange={set('category')} placeholder="Food, Merch, Art…" />
        </div>
        <TextareaField label="What they sell" name="nv-desc" optional rows={2} maxLength={1000} value={form.description} onChange={set('description')} />
        <TextareaField label="Notes" name="nv-notes" optional rows={2} maxLength={4000} value={form.notes} onChange={set('notes')} hint="Only you see these." />
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy}>Add vendor</SubmitButton>
          <button type="button" className="es-btn es-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
