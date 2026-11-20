'use client';

import { useState } from 'react';
import { put } from '../../../../utils/apiClient';
import { useToast } from '../../../../components/ui/Toast';
import { Panel } from '../../../../components/ui/Page';
import Field, { TextareaField } from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { STARTER_VENDOR_TERMS } from '../../../../components/vendors/vendorUi';

/**
 * The public vendor page and its application form (2026-11-20): on/off, a
 * closing date, the categories wanted, the organizer's own questions (up to
 * 10), the terms vendors sign, offline payment instructions and what booked
 * vendors are told about the day.
 */
export default function VendorProgram({ eventId, state, slug }) {
  if (state.error) return <ErrorNotice error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading variant="card" label="Loading the vendor page" />;
  return <ProgramForm eventId={eventId} program={state.data} slug={slug} onSaved={state.reload} />;
}

const toLocalDate = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

function ProgramForm({ eventId, program, slug, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    isOpen: program.isOpen,
    headline: program.headline || '',
    intro: program.intro || '',
    closeDate: toLocalDate(program.applicationsCloseAt),
    categories: program.categories.join('\n'),
    contactEmail: program.contactEmail || '',
    defaultTerms: program.defaultTerms || STARTER_VENDOR_TERMS,
    paymentInstructions: program.paymentInstructions || '',
    vendorInfo: program.vendorInfo || '',
  }));
  const [questions, setQuestions] = useState(() => program.questions.map((q) => ({ ...q })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setQ = (i, patchQ) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patchQ } : q)));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await put(`/events/${eventId}/vendors/program`, {
        isOpen: form.isOpen,
        headline: form.headline.trim() || null,
        intro: form.intro.trim() || null,
        // The end of the chosen day, so "closes on the 1st" includes the 1st.
        applicationsCloseAt: form.closeDate ? new Date(`${form.closeDate}T23:59:00`).toISOString() : null,
        categories: form.categories.split('\n').map((c) => c.trim()).filter(Boolean),
        questions: questions.filter((q) => q.label.trim()).map((q) => ({ ...q, label: q.label.trim() })),
        contactEmail: form.contactEmail.trim() || null,
        defaultTerms: form.defaultTerms.trim() || null,
        paymentInstructions: form.paymentInstructions.trim() || null,
        vendorInfo: form.vendorInfo.trim() || null,
      }, { noRedirect: true });
      toast.success(form.isOpen ? 'Saved. Your vendor page is live.' : 'Saved. Your vendor page is off.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="fx-stack">
      <Panel icon="globe" title="Public vendor page" description="Where businesses see your spaces and apply. Each application lands in New and in your inbox.">
        <div className="fx-stack fx-stack--sm">
          <label className="es-sp-switch">
            <input type="checkbox" checked={form.isOpen} onChange={(e) => setForm((f) => ({ ...f, isOpen: e.target.checked }))} />
            <span>
              <b>{form.isOpen ? 'On — businesses can find the page and apply' : 'Off — no public page, no applications'}</b>
              {slug && <span className="block text-xs text-subtle">Address: /e/{slug}/vendors (shown on your event page as “Become a vendor” while on).</span>}
            </span>
          </label>
          <div className="fx-grid fx-grid--2">
            <Field label="Headline" name="vp-headline" optional maxLength={120} value={form.headline} onChange={set('headline')} placeholder="Sell at our market" />
            <Field label="Applications close" name="vp-close" type="date" optional value={form.closeDate} onChange={set('closeDate')}
              hint="The page stays up as a vendor list; the form closes at the end of this day." />
          </div>
          <TextareaField label="Introduction" name="vp-intro" optional rows={4} maxLength={3000} value={form.intro} onChange={set('intro')}
            hint="How many visitors, what kind of vendors you want, what the spaces are like." />
          <div className="fx-grid fx-grid--2">
            <TextareaField label="Categories" name="vp-cats" optional rows={4} value={form.categories} onChange={set('categories')}
              hint="One per line, e.g. Food · Drinks · Merch · Art. Applicants choose one." />
            <Field label="Send applications to" name="vp-email" type="email" optional value={form.contactEmail} onChange={set('contactEmail')}
              hint="Leave empty to use your account’s email." />
          </div>
        </div>
      </Panel>

      <Panel icon="list" title="Your questions" description="Asked on the application form, after the business details. Up to 10.">
        <div className="fx-stack fx-stack--sm">
          {questions.length === 0 && <p className="text-sm text-muted">No extra questions. Add things like “Do you need power?” or “Link to your menu”.</p>}
          <ol className="es-vd-questions">
            {questions.map((q, i) => (
              <li key={q.id || i} className="es-vd-question">
                <input className="es-input es-input--sm" aria-label={`Question ${i + 1}`} maxLength={200} placeholder="Do you need power?"
                  value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} />
                <select className="es-input es-input--sm" aria-label={`Question ${i + 1} answer type`} value={q.type} onChange={(e) => setQ(i, { type: e.target.value })}>
                  <option value="text">Short answer</option>
                  <option value="long">Long answer</option>
                  <option value="yesno">Yes / No</option>
                </select>
                <label className="fx-row items-center gap-1 text-sm">
                  <input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} />Required
                </label>
                <button type="button" className="es-btn es-btn--ghost es-btn--sm" aria-label={`Remove question ${i + 1}`}
                  onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}><NavIcon name="trash" size={16} /></button>
              </li>
            ))}
          </ol>
          {questions.length < 10 && (
            <div className="fx-row">
              <button type="button" className="es-btn es-btn--secondary es-btn--sm"
                onClick={() => setQuestions((qs) => [...qs, { id: `q${Date.now().toString(36)}`, label: '', type: 'text', required: false }])}>
                <NavIcon name="plus" size={16} />Add a question
              </button>
            </div>
          )}
        </div>
      </Panel>

      <Panel icon="pencil" title="Vendor terms" description="What every offer starts from. You can change it per vendor before sending.">
        <TextareaField label="Terms" name="vp-terms" rows={10} maxLength={20000} value={form.defaultTerms} onChange={set('defaultTerms')}
          hint="A plain starting point, not legal advice. Have it checked for your country before you rely on it." />
      </Panel>

      <div className="fx-grid fx-grid--2">
        <Panel icon="bank" title="Paying without a card" description="Shown to vendors once they accept. Record the payment when it arrives.">
          <TextareaField label="Payment instructions" name="vp-pay" optional rows={4} maxLength={2000} value={form.paymentInstructions} onChange={set('paymentInstructions')} />
        </Panel>
        <Panel icon="info" title="For the day" description="Sent to vendors when they are booked, and shown in their booking.">
          <TextareaField label="Vendor information" name="vp-info" optional rows={4} maxLength={4000} value={form.vendorInfo} onChange={set('vendorInfo')}
            hint="Load-in time, entrance, parking, power, contact on the day." />
        </Panel>
      </div>

      <FormError error={error} />
      <div className="fx-row"><SubmitButton busy={busy}>Save vendor page</SubmitButton></div>
    </form>
  );
}
