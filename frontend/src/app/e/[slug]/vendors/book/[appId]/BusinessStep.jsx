'use client';

import { useRef, useState } from 'react';
import { patch } from '../../../../../utils/apiClient';
import { messageFor } from '../../../../../utils/errors';
import { uploadLogo } from '../../../../../components/sponsors/sponsorUi';
import Field, { SelectField, TextareaField } from '../../../../../components/forms/Field';
import FormError from '../../../../../components/forms/FormError';
import NavIcon from '../../../../../components/shell/NavIcon';
import SocialIcon, { SOCIAL_FIELDS } from '../../../../../components/vendors/booking/SocialIcon';
import DocumentsCard from '../../../../../components/vendors/booking/DocumentsCard';

const BIO_MAX = 300;
const REQUIRED = [['businessName', 'Business name'], ['address', 'Address'], ['city', 'City'], ['postalCode', 'Postal code']];

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 1 of a vendor booking (owner's reference, 2026-11-21):
 *
 *   Add business information   logo · company · category · address · city ·
 *                              postal code · biography
 *   Social media links         Instagram · X · YouTube · Facebook · WhatsApp ·
 *                              LinkedIn · website
 *   The organizer's questions
 *   Add Documents              one tile per document asked for
 *
 * The form saves on Continue (one PATCH). Documents upload on their own the
 * moment a file is chosen. Required fields say so under the box, as the
 * reference does, after the first attempt — not while someone is typing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function BusinessStep({ booking, onSaved, onBooking, nextLabel }) {
  const b = booking.business;
  const base = `/partner/vendors/bookings/${booking.id}`;
  const [form, setForm] = useState(() => ({
    businessName: b.businessName === 'My business' ? '' : b.businessName || '',
    contactName: b.contactName || '', contactPhone: b.contactPhone || '', category: b.category || '',
    address: b.address || '', city: b.city || '', postalCode: b.postalCode || '', description: b.description || '',
    website: b.website || '',
  }));
  const [socials, setSocials] = useState(() => ({ ...(b.socials || {}) }));
  const [answers, setAnswers] = useState(() => Object.fromEntries((booking.answers || []).map((a) => [a.id, a.answer])));
  const [logo, setLogo] = useState(b.logoUrl ? { url: b.logoUrl, path: b.logoPath } : null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { categories, questions, documents: docSpec } = booking.program;

  const errors = Object.fromEntries(REQUIRED.filter(([k]) => !form[k].trim()).map(([k, label]) => [k, `${label} is required.`]));
  if (categories.length && !form.category) errors.category = 'Choose a category.';
  for (const q of questions) if (q.required && !String(answers[q.id] ?? '').trim()) errors[`q-${q.id}`] = 'Please answer this.';
  const shown = (k) => (tried ? errors[k] : null);

  async function submit(e) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) {
      document.querySelector('.es-vb-form [aria-invalid="true"]')?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const site = form.website.trim();
      const saved = await patch(base, {
        ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || (k === 'businessName' ? v : null)])),
        // "mybakery.ca" is what people type; the API wants a full address.
        website: site && !/^https?:\/\//i.test(site) ? `https://${site}` : site || null,
        socials, answers, logoPath: logo?.path || null,
      }, { noRedirect: true });
      onSaved(saved);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="fx-stack es-vb-flow__form" noValidate>
      <section className="es-vb-card es-vb-form" aria-labelledby="vb-biz">
        <h2 id="vb-biz" className="es-vb-card__title">Add business information</h2>
        <p className="es-vb-card__lede">Upload your business logo and manage your business details.</p>
        <div className="es-vb-biz">
          <LogoTile base={`/partner/vendors/${booking.id}`} value={logo} onChange={setLogo} />
          <div className="es-vb-biz__fields">
            <Field label="Company / Organization" name="vb-company" required maxLength={120} autoComplete="organization"
              placeholder="e.g. New Arts Canada" value={form.businessName} onChange={set('businessName')} error={shown('businessName')} />
            {categories.length > 0 ? (
              <SelectField label="Category" name="vb-category" required value={form.category} onChange={set('category')} error={shown('category')}
                options={[['', 'Choose…'], ...categories.map((c) => [c, c])]} />
            ) : (
              <Field label="Contact person" name="vb-contact" optional maxLength={120} autoComplete="name" value={form.contactName} onChange={set('contactName')} />
            )}
            <Field label="Address" name="vb-address" required maxLength={200} autoComplete="street-address"
              placeholder="e.g. 100 Queen St W" value={form.address} onChange={set('address')} error={shown('address')} />
            <Field label="City" name="vb-city" required maxLength={80} autoComplete="address-level2"
              placeholder="e.g. Toronto" value={form.city} onChange={set('city')} error={shown('city')} />
            <Field label="Postal Code" name="vb-postal" required maxLength={20} autoComplete="postal-code"
              placeholder="e.g. K1A 0B1" value={form.postalCode} onChange={set('postalCode')} error={shown('postalCode')} />
            <Field label="Phone" name="vb-phone" type="tel" optional maxLength={30} autoComplete="tel" value={form.contactPhone} onChange={set('contactPhone')}
              hint="For the organizer on the day." />
            {categories.length > 0 && (
              <Field label="Contact person" name="vb-contact" optional maxLength={120} autoComplete="name" value={form.contactName} onChange={set('contactName')} />
            )}
            <div className="es-vb-biz__wide">
              <TextareaField label="Biography" name="vb-bio" optional rows={3} maxLength={BIO_MAX} value={form.description} onChange={set('description')}
                placeholder="What you sell, and what makes you a great fit." />
            </div>
          </div>
        </div>
      </section>

      <section className="es-vb-card es-vb-form" aria-labelledby="vb-social">
        <h2 id="vb-social" className="es-vb-card__title">Social media links</h2>
        <p className="es-vb-card__lede">Manage your social media links. Shown with your listing once you are booked.</p>
        <div className="es-vb-socials">
          {SOCIAL_FIELDS.map((s) => (
            <SocialField key={s.key} icon={s.key} label={s.label} placeholder={s.placeholder}
              value={socials[s.key] || ''} onChange={(v) => setSocials((x) => ({ ...x, [s.key]: v }))} />
          ))}
          <SocialField icon="website" label="Website" placeholder="https://yourwebsite.com" type="url"
            value={form.website} onChange={(v) => setForm((f) => ({ ...f, website: v }))} />
        </div>
      </section>

      {questions.length > 0 && (
        <section className="es-vb-card es-vb-form" aria-labelledby="vb-qs">
          <h2 id="vb-qs" className="es-vb-card__title">A few questions</h2>
          <p className="es-vb-card__lede">From the organizer.</p>
          <div className="fx-stack fx-stack--sm">
            {questions.map((q) => (q.type === 'yesno' ? (
              <fieldset key={q.id} className="es-vd-yesno">
                <legend className="es-label"><span>{q.label}{q.required && <span className="es-req" aria-hidden="true">*</span>}</span></legend>
                <div className="fx-row gap-3">
                  {['Yes', 'No'].map((v) => (
                    <label key={v} className="fx-row items-center gap-1 text-sm">
                      <input type="radio" name={`vb-q-${q.id}`} value={v} checked={answers[q.id] === v} onChange={() => setAnswers((a) => ({ ...a, [q.id]: v }))} />{v}
                    </label>
                  ))}
                </div>
                {shown(`q-${q.id}`) && <p className="text-xs text-danger">{shown(`q-${q.id}`)}</p>}
              </fieldset>
            ) : q.type === 'long' ? (
              <TextareaField key={q.id} label={q.label} name={`vb-q-${q.id}`} required={q.required} optional={!q.required} rows={3} maxLength={1000}
                value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} error={shown(`q-${q.id}`)} />
            ) : (
              <Field key={q.id} label={q.label} name={`vb-q-${q.id}`} required={q.required} optional={!q.required} maxLength={200}
                value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} error={shown(`q-${q.id}`)} />
            )))}
          </div>
        </section>
      )}

      <DocumentsCard base={base} spec={docSpec} documents={booking.documents} onChange={onBooking} />

      <FormError error={error} />
      {tried && Object.keys(errors).length > 0 && (
        <p role="alert" className="es-vb-missing"><NavIcon name="alert" size={16} />Fill in the fields marked above to continue.</p>
      )}
      <div className="es-vb-actions es-vb-actions--end">
        <button type="submit" className="es-vb-btn es-vb-btn--sun" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Saving…' : nextLabel}<NavIcon name="arrow" size={20} />
        </button>
      </div>
    </form>
  );
}

function SocialField({ icon, label, placeholder, value, onChange, type = 'text' }) {
  const id = `vb-social-${icon}`;
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="es-label"><span>{label}</span></label>
      <span className="es-vb-social">
        <span className="es-vb-social__icon" aria-hidden="true"><SocialIcon name={icon} /></span>
        <input id={id} type={type} className="es-input" placeholder={placeholder} maxLength={300} value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </div>
  );
}

/** The square "Logo" tile of the reference: click to upload, shows the logo once there. */
function LogoTile({ base, value, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function pick(file) {
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadLogo(base, file));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="es-vb-logo">
      <button type="button" className="es-vb-logo__tile" onClick={() => input.current?.click()} disabled={busy}
        aria-label={value?.url ? 'Replace your logo' : 'Upload your logo'}>
        {value?.url
          // eslint-disable-next-line @next/next/no-img-element -- the uploaded logo, from storage
          ? <img src={value.url} alt="" />
          : <span className="es-vb-logo__word">{busy ? 'Uploading…' : 'Logo'}</span>}
      </button>
      {value?.url && <button type="button" className="es-vb-link es-vb-link--danger" onClick={() => onChange(null)}>Remove logo</button>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Choose a logo file"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f); }} />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
