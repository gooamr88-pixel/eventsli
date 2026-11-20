'use client';

import { useState } from 'react';
import { post } from '../../../utils/apiClient';
import Field, { SelectField, TextareaField } from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import NavIcon from '../../../components/shell/NavIcon';

/**
 * The vendor application form (2026-11-20): the business, the space wanted,
 * and the organizer's own questions. One application per address per event; a
 * second send is answered as a success and adds nothing. `website2` is a
 * honeypot.
 */
export default function VendorApply({ slug, categories, questions, booths }) {
  const [form, setForm] = useState({
    businessName: '', contactName: '', contactEmail: '', contactPhone: '', website: '', category: '',
    description: '', boothTypeId: '', website2: '',
  });
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => String(v).trim() !== ''));
      await post(`/public/events/${encodeURIComponent(slug)}/vendors/applications`, { ...body, answers }, { noRedirect: true });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="es-sppub__sent" role="status">
        <NavIcon name="check" size={28} />
        <div>
          <p className="font-semibold">Thank you — your application was sent.</p>
          <p className="text-sm text-muted">
            The organizer will reply to {form.contactEmail}. You can follow it under Account › Vendor bookings, signed in with that address.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="es-sppub__form fx-stack fx-stack--sm">
      <div className="fx-grid fx-grid--2">
        <Field label="Business name" name="va-business" required maxLength={120} autoComplete="organization" value={form.businessName} onChange={set('businessName')} />
        <Field label="Your name" name="va-name" required maxLength={120} autoComplete="name" value={form.contactName} onChange={set('contactName')} />
        <Field label="Email" name="va-email" type="email" required autoComplete="email" value={form.contactEmail} onChange={set('contactEmail')} />
        <Field label="Phone" name="va-phone" type="tel" optional maxLength={30} autoComplete="tel" value={form.contactPhone} onChange={set('contactPhone')} />
        <Field label="Website or social" name="va-web" type="url" optional placeholder="https://" value={form.website} onChange={set('website')} />
        {categories.length > 0 && (
          <SelectField label="Category" name="va-cat" required value={form.category} onChange={set('category')}
            options={[['', 'Choose…'], ...categories.map((c) => [c, c])]} />
        )}
        {booths.length > 0 && (
          <SelectField label="Space you would like" name="va-booth" optional value={form.boothTypeId} onChange={set('boothTypeId')}
            options={[['', 'Not sure yet'], ...booths.map((b) => [b.id, b.name])]} />
        )}
      </div>
      <TextareaField label="What you sell" name="va-desc" required rows={4} minLength={10} maxLength={1000} value={form.description} onChange={set('description')}
        hint="Your products, prices, and anything that makes you a good fit. Shown on the vendor list if you are booked." />

      {questions.map((q) => (q.type === 'yesno' ? (
        <fieldset key={q.id} className="es-vd-yesno">
          <legend className="es-label"><span>{q.label}{q.required && <span className="es-req" aria-hidden="true">*</span>}</span></legend>
          <div className="fx-row gap-3">
            {['Yes', 'No'].map((v) => (
              <label key={v} className="fx-row items-center gap-1 text-sm">
                <input type="radio" name={`va-q-${q.id}`} value={v} required={q.required}
                  checked={answers[q.id] === v} onChange={() => setAnswers((a) => ({ ...a, [q.id]: v }))} />{v}
              </label>
            ))}
          </div>
        </fieldset>
      ) : q.type === 'long' ? (
        <TextareaField key={q.id} label={q.label} name={`va-q-${q.id}`} required={q.required} optional={!q.required} rows={3} maxLength={1000}
          value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
      ) : (
        <Field key={q.id} label={q.label} name={`va-q-${q.id}`} required={q.required} optional={!q.required} maxLength={200}
          value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
      )))}

      <div aria-hidden="true" className="es-sppub__hp">
        <label htmlFor="va-website2">Leave this empty</label>
        <input id="va-website2" name="website2" tabIndex={-1} autoComplete="off" value={form.website2} onChange={set('website2')} />
      </div>
      <FormError error={error} />
      <div className="fx-row"><SubmitButton busy={busy}>Send application</SubmitButton></div>
      <p className="text-xs text-subtle">Your details go to the organizer of this event only.</p>
    </form>
  );
}
