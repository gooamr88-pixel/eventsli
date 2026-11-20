'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { post } from '../../../utils/apiClient';
import Field, { SelectField, TextareaField } from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import NavIcon from '../../../components/shell/NavIcon';

/**
 * The sponsor inquiry form (2026-11-20). One inquiry per address per event;
 * a second send is answered as a success and adds nothing. The hidden
 * `website2` field is a honeypot: people never see it, bots fill it.
 */
export default function SponsorInquiry({ slug, packages }) {
  // "Ask about Gold" links here with ?package=<id>.
  const asked = useSearchParams().get('package');
  const [form, setForm] = useState(() => ({
    companyName: '', contactName: '', contactEmail: '', contactPhone: '', website: '', message: '', website2: '',
    packageId: asked && packages.some((p) => p.id === asked) ? asked : '',
  }));
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
      await post(`/public/events/${encodeURIComponent(slug)}/sponsorship/inquiries`, body, { noRedirect: true });
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
          <p className="font-semibold">Thank you — your inquiry was sent.</p>
          <p className="text-sm text-muted">The organizer will reply to {form.contactEmail}. We have sent you a copy.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="es-sppub__form fx-stack fx-stack--sm">
      <div className="fx-grid fx-grid--2">
        <Field label="Company" name="si-company" required maxLength={120} autoComplete="organization" value={form.companyName} onChange={set('companyName')} />
        <Field label="Your name" name="si-name" required maxLength={120} autoComplete="name" value={form.contactName} onChange={set('contactName')} />
        <Field label="Email" name="si-email" type="email" required autoComplete="email" value={form.contactEmail} onChange={set('contactEmail')} />
        <Field label="Phone" name="si-phone" type="tel" optional maxLength={30} autoComplete="tel" value={form.contactPhone} onChange={set('contactPhone')} />
        <Field label="Website" name="si-website" type="url" optional placeholder="https://" autoComplete="url" value={form.website} onChange={set('website')} />
        {packages.length > 0 && (
          <SelectField label="Interested in" name="si-package" optional value={form.packageId} onChange={set('packageId')}
            options={[['', 'Not sure yet'], ...packages.map((p) => [p.id, p.name])]} />
        )}
      </div>
      <TextareaField label="Message" name="si-message" optional rows={4} maxLength={2000} value={form.message} onChange={set('message')}
        hint="Your goals, budget, or anything you would like to offer in kind." />
      {/* Honeypot — hidden from people and from assistive technology. */}
      <div aria-hidden="true" className="es-sppub__hp">
        <label htmlFor="si-website2">Leave this empty</label>
        <input id="si-website2" name="website2" tabIndex={-1} autoComplete="off" value={form.website2} onChange={set('website2')} />
      </div>
      <FormError error={error} />
      <div className="fx-row"><SubmitButton busy={busy}>Send inquiry</SubmitButton></div>
      <p className="text-xs text-subtle">Your details go to the organizer of this event only.</p>
    </form>
  );
}
