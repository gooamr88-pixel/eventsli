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
  const settled = data.invoices.filter((i) => ['paid', 'waived'].includes(i.status)).length;

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Commission on door sales"
        lede="Sales you took yourself never passed through Eventsli, so our commission on them is invoiced to you. Card sales are already settled and do not appear here."
      />

      <KpiRow label="Commission at a glance" tiles>
        <Kpi
          icon="percent"
          label="Outstanding"
          value={formatMoney(data.owedCents, data.currency)}
          note={overdue ? `${overdue} overdue` : 'Nothing overdue'}
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
    </div>
  );
}

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
      <Panel title={`Invoice ${invoice.number}`} action={<InvoiceStatus invoice={invoice} />}>
        <div className="fx-row fx-row--between">
          <p className="text-sm text-muted">
            {invoice.orderCount} door {invoice.orderCount === 1 ? 'sale' : 'sales'}
            {!closed && <> · due {formatEventTime(invoice.dueAt, timezone)}</>}
            {!closed && invoice.originalDueAt && <> (moved from {formatEventTime(invoice.originalDueAt, timezone, { time: false })})</>}
          </p>
          <p className="es-nums text-right">
            <span className="block text-lg text-ink">{money(closed ? invoice.amountCents : invoice.balanceCents)}</span>
            {!closed && invoice.paidCents > 0 && (
              <span className="block text-xs text-muted">of {money(invoice.amountCents)} · {money(invoice.paidCents)} received</span>
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
