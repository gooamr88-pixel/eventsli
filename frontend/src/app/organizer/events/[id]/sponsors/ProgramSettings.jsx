'use client';

import { useState } from 'react';
import { put } from '../../../../utils/apiClient';
import { useToast } from '../../../../components/ui/Toast';
import { Panel } from '../../../../components/ui/Page';
import Field, { TextareaField } from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, ErrorNotice } from '../../../../components/Feedback';

/** A starting agreement, plain and editable. Not legal advice; the page says so. */
export const STARTER_TERMS = `SPONSORSHIP AGREEMENT

1. The sponsor pays the amount in this proposal by the due dates shown.
2. The organizer provides the benefits listed in this proposal at the event.
3. The sponsor supplies its logo and brand details before the event, and grants the organizer the right to show them to promote the event.
4. If the event is cancelled by the organizer, the organizer refunds what the sponsor has paid for benefits not delivered.
5. If the sponsor withdraws after signing, payments already made are not refundable unless the organizer agrees otherwise in writing.
6. Neither party will use the other's name or brand except as this agreement allows.`;

/**
 * The public "Become a sponsor" page and the defaults every proposal starts
 * from (2026-11-20). Off until switched on: no page, no inquiries.
 */
export default function ProgramSettings({ eventId, state, slug }) {
  if (state.error) return <ErrorNotice error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading variant="card" label="Loading the sponsor page" />;
  return <ProgramForm eventId={eventId} program={state.data} slug={slug} onSaved={state.reload} />;
}

function ProgramForm({ eventId, program, slug, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    isOpen: program.isOpen,
    headline: program.headline || '',
    intro: program.intro || '',
    contactEmail: program.contactEmail || '',
    defaultTerms: program.defaultTerms || STARTER_TERMS,
    paymentInstructions: program.paymentInstructions || '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await put(`/events/${eventId}/sponsorship/program`, {
        isOpen: form.isOpen,
        headline: form.headline.trim() || null,
        intro: form.intro.trim() || null,
        contactEmail: form.contactEmail.trim() || null,
        defaultTerms: form.defaultTerms.trim() || null,
        paymentInstructions: form.paymentInstructions.trim() || null,
      }, { noRedirect: true });
      toast.success(form.isOpen ? 'Saved. Your sponsor page is live.' : 'Saved. Your sponsor page is off.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const publicPath = slug ? `/e/${slug}/sponsor` : null;

  return (
    <form onSubmit={submit} className="fx-stack">
      <Panel icon="globe" title="Public sponsor page" description="A page where brands see your packages and ask to sponsor. Each inquiry lands in your Leads and in your inbox.">
        <div className="fx-stack fx-stack--sm">
          <label className="es-sp-switch">
            <input type="checkbox" checked={form.isOpen} onChange={(e) => setForm((f) => ({ ...f, isOpen: e.target.checked }))} />
            <span>
              <b>{form.isOpen ? 'On — brands can find the page and send inquiries' : 'Off — no public page, no inquiries'}</b>
              {publicPath && <span className="block text-xs text-subtle">Address: {publicPath} (shown on your event page as “Become a sponsor” while on).</span>}
            </span>
          </label>
          <Field label="Headline" name="pr-headline" optional maxLength={120} value={form.headline} onChange={set('headline')}
            placeholder="Partner with us" />
          <TextareaField label="Introduction" name="pr-intro" optional rows={4} maxLength={3000} value={form.intro} onChange={set('intro')}
            hint="Who comes to your event, how many, and why a brand should be there." />
          <Field label="Send inquiries to" name="pr-email" type="email" optional value={form.contactEmail} onChange={set('contactEmail')}
            hint="Leave empty to use your account’s email." />
        </div>
      </Panel>

      <Panel icon="pencil" title="Sponsorship agreement" description="The text every new proposal starts from. You can change it for each sponsor before sending.">
        <TextareaField label="Agreement" name="pr-terms" rows={12} maxLength={20000} value={form.defaultTerms} onChange={set('defaultTerms')}
          hint="A plain starting point, not legal advice. Have it checked for your country before you rely on it." />
      </Panel>

      <Panel icon="bank" title="Paying without a card" description="Shown to sponsors once they have signed. When their payment arrives, record it on the deal.">
        <TextareaField label="Payment instructions" name="pr-pay" optional rows={4} maxLength={2000} value={form.paymentInstructions} onChange={set('paymentInstructions')}
          hint="e.g. bank name, account holder, account number, and the reference to quote." />
      </Panel>

      <FormError error={error} />
      <div className="fx-row"><SubmitButton busy={busy}>Save sponsor page</SubmitButton></div>
    </form>
  );
}
