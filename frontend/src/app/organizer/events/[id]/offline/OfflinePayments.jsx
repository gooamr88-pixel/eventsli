'use client';

import { useState } from 'react';
import { post } from '../../../../utils/apiClient';
import { describeError } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import { formatEventTime } from '../../../../lib/eventTime';
import { centsToInput, parseMoneyToCents } from '../../../../lib/moneyInput';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { useConfirm } from '../../../../components/ui/Confirm';
import { SectionHeader, Panel } from '../../../../components/ui/Page';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice, Notice } from '../../../../components/Feedback';
import { useEventContext } from '../EventContext';
import OrderUndo from './OrderUndo';
import { useOrganizerEvents } from '../../../nav/OrganizerEvents';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * OFFLINE PAYMENTS (phase 2) — buyers who reserved online and pay you directly.
 *
 * Awaiting first: each shows what to expect, the reference the buyer was told
 * to quote, and the deadline after which the seats go back on sale on their
 * own. "Mark as paid" asks for the amount received and records EXACTLY the
 * amount owed — the server refuses more or less, and a second click (or a
 * colleague clicking at the same moment) returns the first answer. Only then
 * are the tickets issued and emailed.
 *
 * Everything that happens here is in the payment log at the bottom.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STATUS = {
  awaiting: ['Awaiting payment', 'es-pill--warning'],
  paid: ['Paid', 'es-pill--accent'],
  expired: ['Expired', ''],
  cancelled: ['Cancelled', ''],
  voided: ['Voided', 'es-pill--danger'],
  refunded: ['Refunded', 'es-pill--danger'],
};

const ACTIONS = {
  'offline.reserved': 'Reserved by the buyer',
  'offline.confirmed': 'Marked as paid',
  'offline.proof_uploaded': 'Receipt uploaded by the buyer',
  'offline.buyer_sent': 'Buyer says the payment was sent',
  'offline.cancelled': 'Reservation cancelled',
  'offline.expired': 'Expired unpaid',
  'order.voided': 'Order voided',
  'order.refunded': 'Order refunded',
  'door_sale.recorded': 'Door sale recorded',
};

export default function OfflinePayments({ eventId }) {
  const event = useEventContext()?.event;
  const list = useApi(`/events/${eventId}/offline-payments`);
  const audit = useApi(`/events/${eventId}/payment-audit`);
  // The sidebar's count of payments awaiting approval moves with them.
  const sidebar = useOrganizerEvents();
  const reload = () => { list.reload(); audit.reload(); sidebar.reload?.(); };

  if (list.error) return <ErrorNotice error={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading variant="list" rows={4} label="Loading offline payments" />;

  const payments = list.data.payments || [];
  const awaiting = payments.filter((p) => p.status === 'awaiting');
  const rest = payments.filter((p) => p.status !== 'awaiting');
  const tz = event?.timezone;

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Offline payments"
        lede="Buyers who reserved online and pay you directly. Mark each one paid when the money arrives — their tickets are issued then."
      />

      {!list.data.enabled && (
        <Notice tone="info" title="Offline checkout is not switched on for Eventsli yet.">
          <p>Until it is, buyers cannot reserve and pay you online. Sales you take yourself still go under Door sales.</p>
        </Notice>
      )}

      <Panel icon="clock" title={`Awaiting payment (${awaiting.length})`} description="Unpaid reservations end automatically at their deadline.">
        {awaiting.length === 0 ? (
          <p className="text-sm text-muted">Nothing is waiting for payment.</p>
        ) : (
          <ul className="fx-stack fx-stack--sm">
            {awaiting.map((p) => <AwaitingRow key={p.id} eventId={eventId} payment={p} tz={tz} onDone={reload} />)}
          </ul>
        )}
      </Panel>

      {rest.length > 0 && (
        <Panel icon="receipt" title="Earlier reservations">
          <ul className="fx-stack fx-stack--sm">
            {rest.map((p) => (
              <li key={p.id} className="fx-row fx-row--between gap-2 border-t border-border-base pt-2 text-sm first:border-0 first:pt-0">
                <span className="fx-min0">
                  <span className="text-ink">{p.buyer.name || p.buyer.email || 'Buyer'}</span>
                  <span className="block text-xs text-subtle">
                    {p.reference} · {formatMoney(p.amountCents, p.currency)} · {p.method}
                    {p.closeReason ? ` · ${p.closeReason}` : ''}
                  </span>
                  {/* Who marked it paid, and when (2026-11-24). */}
                  {p.status === 'paid' && p.confirmedAt && (
                    <span className="block text-xs text-muted">
                      Confirmed by {personName(p.confirmedBy)} on {formatEventTime(p.confirmedAt, tz)}
                    </span>
                  )}
                  {p.proof?.url && (
                    <a href={p.proof.url} target="_blank" rel="noreferrer" className="text-xs text-accent">View the buyer’s receipt<span className="sr-only"> (opens in a new tab)</span></a>
                  )}
                </span>
                <span className="fx-row items-center gap-2">
                  <StatusPill status={p.status} />
                  {p.status === 'paid' && p.orderId && (
                    <OrderUndo eventId={eventId} order={{ orderId: p.orderId, amountCents: p.amountCents, currency: p.currency }} onDone={reload} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel icon="shield" title="Payment log" description="Every reservation, confirmation, cancellation, void and refund on this event — who did it and when. It cannot be edited.">
        {!audit.data ? <Loading variant="list" rows={3} label="Loading the log" /> : (audit.data.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="fx-stack fx-stack--sm text-sm">
            {audit.data.slice(0, 100).map((a) => (
              <li key={a.id} className="fx-row fx-row--between gap-2 border-t border-border-base pt-2 first:border-0 first:pt-0">
                <span className="fx-min0">
                  <span className="text-ink">{ACTIONS[a.action] || a.action}</span>
                  <span className="block text-xs text-subtle">
                    {/* The person, not only the role (2026-11-24): who confirmed it. */}
                    {a.actor ? `${personName(a.actor)} (${a.actorRole})` : a.actorRole}
                    {a.reason ? ` · ${a.reason}` : ''}{a.details?.reference_code ? ` · ${a.details.reference_code}` : ''}
                  </span>
                </span>
                <span className="text-right text-xs text-muted">
                  {a.amountCents !== null && <span className="es-nums block text-ink">{formatMoney(a.amountCents, a.currency)}</span>}
                  {formatEventTime(a.at, tz)}
                </span>
              </li>
            ))}
          </ul>
        ))}
      </Panel>
    </div>
  );
}

/** "Sara Ali (sara@…)", or whatever part is known. */
function personName(p) {
  if (!p) return 'someone';
  if (p.name && p.email) return `${p.name} (${p.email})`;
  return p.name || p.email || 'someone';
}

function StatusPill({ status }) {
  const [label, tone] = STATUS[status] || [status, ''];
  return <span className={`es-pill ${tone}`}>{label}</span>;
}

/** One unpaid reservation, with Mark as paid and Cancel. */
function AwaitingRow({ eventId, payment, tz, onDone }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(centsToInput(payment.amountCents, payment.currency));
  const [reference, setReference] = useState('');
  // One key per confirmation being entered: a double click sends the same one.
  const [confirmKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cents = parseMoneyToCents(amount, payment.currency);
  const exact = cents === payment.amountCents;

  async function markPaid(e) {
    e.preventDefault();
    if (!exact) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/offline-payments/${payment.id}/confirm`,
        { amountCents: cents, reference: reference.trim() || undefined, confirmKey }, { noRedirect: true });
      toast.success('Marked as paid. The tickets were issued and emailed to the buyer.');
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  async function cancel() {
    const answer = await confirm({
      title: 'Cancel this reservation?',
      tone: 'danger',
      body: <p>The seats go back on sale and the buyer is told by email. If they already paid you, return the money.</p>,
      confirmLabel: 'Cancel reservation',
      reason: { label: 'A note for the buyer (optional)', minLength: 0, maxLength: 300 },
    });
    if (!answer) return;
    try {
      await post(`/events/${eventId}/offline-payments/${payment.id}/cancel`, { reason: answer.reason || undefined }, { noRedirect: true });
      toast.success('Reservation cancelled.');
      onDone();
    } catch (err) {
      toast.error(describeError(err).recovery || 'That could not be cancelled.');
    }
  }

  return (
    <li className="rounded-(--es-radius-md) border border-border-base p-3">
      <div className="fx-row fx-row--between gap-2">
        <div className="fx-min0">
          <p className="text-ink">
            <b className="es-nums">{formatMoney(payment.amountCents, payment.currency)}</b> from {payment.buyer.name || payment.buyer.email || 'a buyer'}
          </p>
          <p className="text-xs text-subtle">
            Reference <b className="es-nums text-ink">{payment.reference}</b> · {payment.method}
            {payment.buyer.email ? ` · ${payment.buyer.email}` : ''}{payment.buyer.phone ? ` · ${payment.buyer.phone}` : ''}
          </p>
          <p className="text-xs text-muted"><NavIcon name="clock" size={12} /> Pay by {formatEventTime(payment.dueAt, tz)}</p>
          {/* The buyer pressed "I've sent the payment" (2026-11-24): check for it. */}
          {payment.buyerSentAt && (
            <p className="mt-1"><span className="es-pill es-pill--success">Buyer says sent · {formatEventTime(payment.buyerSentAt, tz)}</span></p>
          )}
          {/* Proof of payment (2026-11-24): the buyer's transfer receipt. */}
          {payment.proof ? (
            <p className="mt-1 text-xs">
              <NavIcon name="receipt" size={12} />{' '}
              {payment.proof.url
                ? <a href={payment.proof.url} target="_blank" rel="noreferrer" className="font-medium text-accent">View the receipt<span className="sr-only"> (opens in a new tab)</span></a>
                : <span className="text-ink">Receipt received</span>}
              <span className="text-muted"> · sent {formatEventTime(payment.proof.uploadedAt, tz)}</span>
            </p>
          ) : (
            <p className={`mt-1 text-xs ${payment.proofRequired ? 'text-danger' : 'text-subtle'}`}>
              {payment.proofRequired ? 'Receipt required for this method — not uploaded yet.' : 'No receipt uploaded yet.'}
            </p>
          )}
        </div>
        <div className="fx-row gap-1">
          <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => setOpen((o) => !o)}>Mark as paid</button>
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={cancel}>Cancel</button>
        </div>
      </div>

      {open && (
        <form onSubmit={markPaid} className="fx-stack fx-stack--sm mt-3 border-t border-border-base pt-3">
          <div className="fx-grid fx-grid--2">
            <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
              Amount received ({payment.currency})
              <input className="es-input es-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
            <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
              Their payment reference (optional)
              <input className="es-input" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} placeholder="e.g. the transfer ID" />
            </label>
          </div>
          {!exact && cents !== null && (
            <p className="text-sm text-danger" role="status">
              Mark it paid only for exactly {formatMoney(payment.amountCents, payment.currency)}. If more arrived, return the difference; if less, wait for the rest.
            </p>
          )}
          {error && <p className="text-sm text-danger" role="alert">{describeError(error).recovery || error.message}</p>}
          <div>
            <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy || !exact}>
              {busy ? 'Issuing tickets…' : 'Confirm payment and issue tickets'}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
