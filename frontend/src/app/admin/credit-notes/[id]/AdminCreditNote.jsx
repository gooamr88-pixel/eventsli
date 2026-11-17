'use client';

import { useState } from 'react';
import { post } from '../../../utils/apiClient';
import { formatMoney } from '../../../utils/money';
import { parseMoneyToCents, centsToInput } from '../../../lib/moneyInput';
import { useApi } from '../../../hooks/useApi';
import { useToast } from '../../../components/ui/Toast';
import { Panel } from '../../../components/ui/Page';
import FormError from '../../../components/forms/FormError';
import { Loading, ErrorNotice } from '../../../components/Feedback';
import CreditNoteDocument from '../../../components/invoices/CreditNoteDocument';

/**
 * A credit note for an admin: the document, and — while credit is left on it —
 * a form to record that Eventsli paid it back to the organizer. The server
 * refuses while the event has an unpaid invoice (the credit goes there first)
 * and for more than the organizer's account still holds, so a credit is never
 * both deducted and paid back.
 */
export default function AdminCreditNote({ creditNoteId }) {
  const { data, error, reload } = useApi(`/admin/credit-notes/${creditNoteId}`);

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return <Loading variant="card" label="Loading the credit note" />;
  const note = data.creditNote;
  return (
    <div className="fx-stack">
      {note.remainingCents > 0 && <RefundCredit note={note} onDone={reload} />}
      <CreditNoteDocument
        creditNote={note}
        event={data.event}
        invoiceNumber={note.invoiceNumber}
        backHref={note.invoiceId ? `/admin/invoices/${note.invoiceId}` : null}
        admin
      />
    </div>
  );
}

function RefundCredit({ note, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState(() => centsToInput(note.remainingCents, note.currency));
  const [method, setMethod] = useState('bank transfer');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cents = parseMoneyToCents(amount, note.currency);
  const tooMuch = cents !== null && cents > note.remainingCents;
  const ready = cents !== null && cents > 0 && !tooMuch && reference.trim().length >= 2;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/admin/credit-notes/${note.id}/refund`, { amountCents: cents, method, reference: reference.trim() }, { noRedirect: true });
      toast.success(`Recorded ${formatMoney(cents, note.currency)} paid back.`);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      icon="coins"
      title="Pay the credit back"
      description={`${formatMoney(note.remainingCents, note.currency)} is still on this credit note. Record it here once Eventsli has sent the money — otherwise it comes off the organizer's next invoice for this event.`}
    >
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
            Amount paid back ({note.currency})
            <input className="es-input es-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
            How
            <input className="es-input" value={method} maxLength={60} onChange={(e) => setMethod(e.target.value)} />
          </label>
          <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
            Reference of the transfer
            <input className="es-input" value={reference} maxLength={120} required onChange={(e) => setReference(e.target.value)} />
          </label>
        </div>
        {cents === null && amount.trim() && <p className="text-xs text-danger">Enter an amount like 25 or 25.50.</p>}
        {tooMuch && <p className="text-xs text-danger">That is more than the {formatMoney(note.remainingCents, note.currency)} left on this credit note.</p>}
        <FormError error={error} />
        <div>
          <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy || !ready}>
            Record {cents ? formatMoney(cents, note.currency) : 'payment'} paid back
          </button>
        </div>
      </form>
    </Panel>
  );
}
