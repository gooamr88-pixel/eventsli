'use client';

import { useState } from 'react';
import { post } from '../../../../utils/apiClient';
import { formatMoney } from '../../../../utils/money';
import { formatEventTime } from '../../../../lib/eventTime';
import { describeGate } from '../../../../lib/gateState';
import { SETTLED_STATUSES } from '../../../../lib/invoiceStatus';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { SectionHeader, Panel } from '../../../../components/ui/Page';
import { Kpi, KpiRow } from '../../../../components/ui/Kpi';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, ErrorNotice, Notice } from '../../../../components/Feedback';
import { StackedEmpty } from '../../../../components/ui/SplitEmpty';
import { InvoiceArt } from '../../../../components/ui/Illustrations';
import InvoiceStatus from '../../../../components/ui/InvoiceStatus';
import { HISTORY_LABELS } from '../../../../admin/invoices/[id]/invoiceHistory';
import { useEventContext } from '../EventContext';

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
 * Every invoice shows what is left to pay (after any payments Eventsli has
 * recorded), and its history: each payment received, a receipt turned down and
 * why, a new due date, a waiver. Nothing an admin does to an invoice is hidden
 * from the organizer except internal notes.
 *
 * Due dates are on the event's clock: the gate locks at that moment at the venue.
 *
 * CREDIT NOTES (20261123110000). A sale an invoice already covered that is
 * then voided or refunded issues a credit note; it comes off what the invoice
 * asks for, and anything left is a credit balance the next invoice deducts.
 * No invoice is issued until the organizer's billing details are complete, so
 * the page says what is missing and where to add it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Commission({ eventId }) {
  const timezone = useEventContext()?.event?.timezone;
  const { data, error, loading, reload } = useApi(`/events/${eventId}/commission`);

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (loading && !data) return <Loading variant="stats" rows={2} label="Loading commission" />;

  const gate = data.gate;
  const door = describeGate(gate, { timezone, audience: 'organizer' });
  const open = data.invoices.filter((i) => !SETTLED_STATUSES.includes(i.status));
  const overdue = open.filter((i) => i.isOverdue).length;
  const payable = open.filter((i) => ['open', 'overdue'].includes(i.status));
  const settled = data.invoices.filter((i) => ['paid', 'waived', 'credited'].includes(i.status)).length;
  const creditNotes = data.creditNotes || [];
  const missing = data.billing?.organizerMissing || [];
  const inCredit = data.owedCents < 0;

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Commission on door sales"
        lede="Sales you took yourself never passed through Eventsli, so our commission on them is invoiced to you. Card sales are already settled and do not appear here."
      />

      <KpiRow label="Commission at a glance" tiles>
        <Kpi
          icon="percent"
          label={inCredit ? 'In credit' : 'Outstanding'}
          value={formatMoney(Math.abs(data.owedCents), data.currency)}
          note={inCredit ? 'Comes off your next invoice' : overdue ? `${overdue} overdue` : 'Nothing overdue'}
          tone={overdue ? 'danger' : undefined}
          featured={!overdue}
        />
        <Kpi icon="receipt" label="Invoices" value={data.invoices.length} note={`${settled} settled`} />
        <Kpi
          icon="scan"
          label="Scanning"
          value={door.locked ? 'Switched off' : 'Working'}
          note={door.detail || (door.locked ? null : 'No invoice is overdue')}
          tone={door.locked ? 'danger' : door.tone === 'warning' ? 'warning' : 'success'}
        />
      </KpiRow>

      {door.locked && (
        <Notice tone="danger" title={door.title}>
          <p>{door.detail}</p>
          {gate?.reason === 'commission_overdue' && <p>Pay by bank transfer and submit the receipt below.</p>}
        </Notice>
      )}

      {payable.length > 0 && (
        <Panel icon="coins" title="How to pay">
          {data.paymentInstructions
            ? <p className="whitespace-pre-line text-sm text-ink">{data.paymentInstructions}</p>
            : <p className="text-sm text-muted">Pay by bank transfer using the details Eventsli gave you. If you do not have them, reply to the invoice email and we will send them.</p>}
          <p className="text-sm text-muted">
            Use the invoice number{payable.length === 1 ? <> — <span className="font-mono text-ink">{payable[0].number}</span> —</> : ''} as the payment reference, then submit the receipt below.
          </p>
        </Panel>
      )}

      {missing.length > 0 && (
        <Notice tone="warning" title="Add your billing details so Eventsli can invoice you.">
          <p>
            An invoice has to show who it is addressed to. Missing: {missing.map((f) => BILLING_FIELD[f] || f).join(', ')}.
            {' '}No invoice is issued until they are complete.
          </p>
          <p><a href="/organizer/profile#billing" className="es-ai-link">Add billing details</a></p>
        </Notice>
      )}

      {data.creditBalanceCents > 0 && (
        <Notice tone="info" title={`You have ${formatMoney(data.creditBalanceCents, data.currency)} in credit.`}>
          <p>From sales you voided or refunded after their commission was invoiced and paid. It comes off your next invoice, or Eventsli pays it back to you.</p>
        </Notice>
      )}

      {data.uninvoicedCents > 0 && (
        <Notice tone="info" title={`${formatMoney(data.uninvoicedCents, data.currency)} is not invoiced yet.`}>
          <p>Commission on door sales since your last invoice. Eventsli emails you an invoice for it — nothing is due until then.</p>
        </Notice>
      )}

      {data.invoices.length === 0 ? (
        <StackedEmpty art={<InvoiceArt />} title="No invoices yet.">
          Eventsli invoices the commission on your door sales and emails you when an invoice is raised.
        </StackedEmpty>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {data.invoices.map((invoice) => (
            <InvoiceCard key={invoice.id} eventId={eventId} invoice={invoice} timezone={timezone} onChanged={reload} />
          ))}
        </ul>
      )}

      {creditNotes.length > 0 && (
        <Panel icon="receipt" title="Credit notes">
          <p className="text-sm text-muted">Issued when a sale an invoice already covered was voided or refunded. Each one takes that sale&rsquo;s commission off what you owe.</p>
          <ul className="fx-stack fx-stack--sm text-sm">
            {creditNotes.map((n) => (
              <li key={n.id} className="fx-row fx-row--between border-t border-border-base pt-2">
                <span className="fx-stack gap-0.5 fx-min0">
                  <span className="font-mono text-ink fx-break">{n.number}</span>
                  <span className="text-muted">
                    {n.kind === 'refund' ? 'Refunded sale' : 'Voided sale'} · {formatEventTime(n.issuedAt, timezone, { time: false })}
                    {n.remainingCents > 0 ? ` · ${formatMoney(n.remainingCents, n.currency)} still to use` : ''}
                  </span>
                </span>
                <span className="fx-row items-center gap-2">
                  <span className="es-nums text-ink">−{formatMoney(n.amountCents, n.currency)}</span>
                  <a href={`/organizer/events/${eventId}/commission/credit-notes/${n.id}`} className="es-btn es-btn--ghost es-btn--sm">View</a>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/** invoice_billing_check's field names, as the organizer's profile labels them. */
const BILLING_FIELD = {
  legal_name: 'organization name',
  billing_address: 'billing address',
  country: 'country',
  tax_status: 'whether you are registered for tax',
  tax_id: 'tax number',
  email: 'account email',
};

function InvoiceCard({ eventId, invoice, timezone, onChanged }) {
  const toast = useToast();
  const [proofUrl, setProofUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const money = (cents) => formatMoney(cents, invoice.currency);
  const closed = SETTLED_STATUSES.includes(invoice.status);
  const awaitingReview = invoice.status === 'submitted';
  const received = (invoice.payments || []).filter((p) => !p.reversedAt);

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
        action={(
          <span className="fx-row items-center gap-2">
            {/* The invoice as a document — print or Save as PDF (20261123100000). */}
            <a href={`/organizer/events/${eventId}/commission/invoices/${invoice.id}`} className="es-btn es-btn--ghost es-btn--sm">View / download</a>
            <InvoiceStatus invoice={invoice} />
          </span>
        )}
      >
        <div className="fx-row fx-row--between">
          <p className="text-sm text-muted">
            {invoice.orderCount} door {invoice.orderCount === 1 ? 'sale' : 'sales'}
            {!closed && <> · due {formatEventTime(invoice.dueAt, timezone)}</>}
            {!closed && invoice.originalDueAt && <> (moved from {formatEventTime(invoice.originalDueAt, timezone, { time: false })})</>}
          </p>
          <p className="es-nums text-right">
            <span className="block text-lg text-ink">{money(closed ? invoice.amountCents : invoice.balanceCents)}</span>
            {!closed && (invoice.paidCents > 0 || invoice.creditedCents > 0) && (
              <span className="block text-xs text-muted">
                of {money(invoice.amountCents)}
                {invoice.paidCents > 0 ? ` · ${money(invoice.paidCents)} received` : ''}
                {invoice.creditedCents > 0 ? ` · ${money(invoice.creditedCents)} credited` : ''}
              </span>
            )}
          </p>
        </div>

        {invoice.status === 'void' ? (
          <p className="text-sm text-muted">Cancelled{invoice.voidReason ? ` — ${invoice.voidReason}` : ''}. Nothing is due on it.</p>
        ) : invoice.status === 'waived' ? (
          <p className="text-sm text-muted">
            {invoice.paidCents > 0 ? `${money(invoice.paidCents)} paid, the rest waived` : 'Waived'}
            {invoice.waiveReason ? ` — ${invoice.waiveReason}` : ''}. Nothing further to do.
          </p>
        ) : invoice.status === 'credited' ? (
          <p className="text-sm text-muted">
            Credit notes took off the whole amount — the sales on it were voided or refunded. Nothing is due.
          </p>
        ) : closed ? (
          <p className="text-sm text-muted">
            Settled{invoice.confirmedAt ? ` ${formatEventTime(invoice.confirmedAt, timezone, { time: false })}` : ''}. Nothing further to do.
          </p>
        ) : awaitingReview ? (
          <Notice tone="info" title="Receipt received — we are checking it.">
            <p>We will confirm the transfer, or tell you if something is missing.</p>
          </Notice>
        ) : (
          <>
            {invoice.receiptRejectionReason && (
              <Notice tone="warning" title="We could not accept your last receipt.">
                <p>{invoice.receiptRejectionReason}</p>
              </Notice>
            )}
            <form onSubmit={submitProof} className="fx-stack fx-stack--sm border-t border-border-base pt-3">
              <Field
                label="Link to your transfer receipt"
                type="url"
                required
                placeholder="https://…"
                hint={`Pay ${money(invoice.balanceCents)} by bank transfer first, with ${invoice.number} as the reference, then paste a link to the receipt.`}
                value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)}
              />
              <FormError error={error} />
              <div>
                <SubmitButton busy={busy} busyLabel="Sending…" disabled={proofUrl.trim().length < 8}>Submit receipt</SubmitButton>
              </div>
            </form>
          </>
        )}

        {received.length > 0 && (
          <ul className="fx-stack fx-stack--sm border-t border-border-base pt-3 text-sm">
            {received.map((p) => (
              <li key={p.id} className="fx-row fx-row--between">
                <span className="text-muted">Received {formatEventTime(p.receivedAt, timezone, { time: false })}{p.method ? ` · ${p.method}` : ''}</span>
                <span className="es-nums text-ink">{money(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}

        {(invoice.history || []).length > 1 && (
          <div className="border-t border-border-base pt-3">
            <button type="button" className="es-ai-link text-sm" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? 'Hide history' : 'Show history'}
            </button>
            {showHistory && (
              <ol className="fx-stack fx-stack--sm pt-2 text-sm">
                {[...invoice.history].reverse().map((h) => (
                  <li key={h.id} className="fx-stack gap-0.5">
                    <span className="text-ink">
                      {HISTORY_LABELS[h.kind] || h.kind}
                      {h.amountCents !== null ? ` · ${money(h.amountCents)}` : ''}
                      {h.kind === 'due_changed' && h.detail?.to ? ` → ${formatEventTime(h.detail.to, timezone)}` : ''}
                    </span>
                    {h.note && <span className="text-muted">{h.note}</span>}
                    <span className="text-xs text-subtle">{formatEventTime(h.at, timezone)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Panel>
    </li>
  );
}
