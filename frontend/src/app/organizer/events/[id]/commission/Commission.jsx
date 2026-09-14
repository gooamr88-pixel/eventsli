'use client';

import { useState } from 'react';
import { post } from '../../../../utils/apiClient';
import { formatMoney } from '../../../../utils/money';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { SectionHeader, StatCard, Panel } from '../../../../components/ui/Page';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, Empty, ErrorNotice, Notice } from '../../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What the organizer owes Eventsli on door sales, and what happens if it is not
 * paid (BRD §18).
 *
 * THE TWO CHANNELS ANSWER DIFFERENT QUESTIONS. On the card path the money passed
 * through Stripe and our fee was already taken, so there is nothing to collect.
 * On the manual path the money never came near us: the commission is a
 * RECEIVABLE. So this page exists for door sales only, and always shows the debt
 * and its consequence together.
 *
 * SUBMITTING PROOF DOES NOT REOPEN THE GATE. Only settlement does, and settlement
 * is an admin's act — otherwise the proof would be decorative.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Commission({ eventId }) {
  const { data, error, loading, reload } = useApi(`/events/${eventId}/commission`);

  if (error) return <ErrorNotice error={error} />;
  if (loading && !data) return <Loading variant="stats" rows={2} label="Loading commission" />;

  const gate = data.gate;
  const overdue = data.invoices.filter((i) => i.isOverdue && !['paid', 'waived'].includes(i.status)).length;

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Commission on door sales"
        lede="Sales you took yourself never passed through Eventsli, so our commission on them is invoiced to you. Card sales are already settled and do not appear here."
      />

      <div className="fx-grid fx-grid--2">
        <StatCard
          label="Outstanding"
          value={formatMoney(data.owedCents, data.currency)}
          note={overdue ? `${overdue} overdue` : 'Nothing overdue'}
          icon="percent"
        />
        <StatCard
          label="Scanning"
          value={gate?.override ? 'Allowed for now' : gate?.locked ? 'Switched off' : 'Working'}
          note={gate?.locked ? 'It reopens by itself once the invoice is settled' : gate?.override ? 'A temporary override from Eventsli' : 'No invoice is overdue'}
          icon="scan"
        />
      </div>

      {gate?.locked && !gate?.override && (
        <Notice tone="danger" title="Nobody can be admitted until this is settled.">
          <p>Pay by bank transfer and submit the receipt below. Scanning reopens by itself as soon as Eventsli confirms the transfer.</p>
        </Notice>
      )}

      {data.invoices.length === 0 ? (
        <Empty title="No invoices." hint="One is raised once you have recorded sales at the door." />
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {data.invoices.map((invoice) => (
            <InvoiceCard key={invoice.id} eventId={eventId} invoice={invoice} onChanged={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InvoiceCard({ eventId, invoice, onChanged }) {
  const toast = useToast();
  const [proofUrl, setProofUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const settled = ['paid', 'waived'].includes(invoice.status);
  const awaitingReview = invoice.status === 'submitted';

  async function submitProof(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/invoices/${invoice.id}/proof`, { proofUrl: proofUrl.trim() }, { noRedirect: true });
      toast.success('Receipt sent. We will confirm the transfer.');
      onChanged();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <li>
      <Panel
        title={`Invoice ${invoice.number}`}
        action={<InvoiceStatus status={invoice.status} overdue={invoice.isOverdue} />}
      >
        <div className="fx-row fx-row--between">
          <p className="text-sm text-muted">
            {invoice.orderCount} door {invoice.orderCount === 1 ? 'sale' : 'sales'} · due {when(invoice.dueAt)}
          </p>
          <p className="es-nums text-lg text-ink">{formatMoney(invoice.amountCents, invoice.currency)}</p>
        </div>

        {settled ? (
          <p className="text-sm text-muted">Settled{invoice.confirmedAt ? ` ${when(invoice.confirmedAt)}` : ''}. Nothing further to do.</p>
        ) : awaitingReview ? (
          <Notice tone="info" title="Receipt received — we are checking it.">
            <p>Scanning stays as it is until we confirm the transfer. There is no separate unlock step.</p>
          </Notice>
        ) : (
          <form onSubmit={submitProof} className="fx-stack fx-stack--sm border-t border-border-base pt-3">
            <Field
              label="Link to your transfer receipt"
              type="url"
              required
              placeholder="https://…"
              hint="Pay by bank transfer first, then paste a link to the receipt."
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
            />
            <FormError error={error} />
            <div>
              <SubmitButton busy={busy} busyLabel="Sending…" disabled={proofUrl.trim().length < 8}>Submit receipt</SubmitButton>
            </div>
          </form>
        )}
      </Panel>
    </li>
  );
}

function InvoiceStatus({ status, overdue }) {
  if (overdue && ['open', 'submitted'].includes(status)) return <span className="es-pill es-pill--danger">Overdue</span>;
  const [label, tone] = {
    open: ['Unpaid', 'es-pill--warning'],
    submitted: ['In review', ''],
    paid: ['Paid', 'es-pill--accent'],
    waived: ['Waived', ''],
    overdue: ['Overdue', 'es-pill--danger'],
  }[status] || [status, ''];
  return <span className={`es-pill ${tone}`}>{label}</span>;
}

function when(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso));
}
