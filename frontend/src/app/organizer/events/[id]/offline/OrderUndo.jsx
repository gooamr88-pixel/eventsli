'use client';

import { useState } from 'react';
import { post } from '../../../../utils/apiClient';
import { describeError } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import { useToast } from '../../../../components/ui/Toast';
import { useConfirm } from '../../../../components/ui/Confirm';

/**
 * Void or refund a paid order taken outside Stripe — a door sale or a
 * confirmed offline reservation (phase 2). One audited database step:
 * tickets void (the door refuses them), seats and tickets back on sale, and
 * the commission Eventsli was owed on it reversed.
 *
 *   Void    recorded in error — no money changed hands
 *   Refund  the buyer was paid back, by the organizer, outside Eventsli
 */
export default function OrderUndo({ eventId, order, onDone }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function run(kind) {
    const answer = await confirm({
      title: kind === 'refund' ? 'Record a refund?' : 'Void this sale?',
      tone: 'danger',
      body: (
        <p>
          {kind === 'refund'
            ? `Record that you returned ${formatMoney(order.amountCents, order.currency)} to the buyer.`
            : 'Use this when the sale was recorded by mistake and no money changed hands.'}
          {' '}The tickets stop working at the door, the seats go back on sale, and the commission on this sale is no longer owed.
          This cannot be undone.
        </p>
      ),
      confirmLabel: kind === 'refund' ? 'Record refund' : 'Void sale',
      reason: { label: 'Why?', minLength: 5, maxLength: 300 },
    });
    if (!answer) return;
    setBusy(true);
    try {
      const result = await post(`/events/${eventId}/orders/${order.orderId}/void`, { kind, reason: answer.reason }, { noRedirect: true });
      toast.success(result?.duplicate ? 'Already done.' : kind === 'refund' ? 'Refund recorded.' : 'Sale voided.');
      onDone?.();
    } catch (err) {
      toast.error(describeError(err).recovery || 'That could not be done.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="fx-row gap-1">
      <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy} onClick={() => run('refund')}>Refund</button>
      <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy} onClick={() => run('void')}>Void</button>
    </span>
  );
}
