'use client';

import Link from 'next/link';
import { formatMoney } from '../../../utils/money';
import { formatEventTime } from '../../../lib/eventTime';
import { Panel } from '../../../components/ui/Page';

/**
 * The credit notes that correct this invoice or were applied to it
 * (20261123110000), each with what it took off here and what is left on it.
 * A credit note with credit left opens on a page where it can be recorded as
 * paid back.
 */
export default function CreditNotesPanel({ invoice, creditNotes, timezone }) {
  if (!creditNotes?.length) return null;
  const money = (c) => formatMoney(c, invoice.currency);
  return (
    <Panel icon="receipt" title="Credit notes" description="Issued when a sale on an invoice was voided or refunded after it was raised.">
      <ul className="fx-stack fx-stack--sm text-sm">
        {creditNotes.map((n) => (
          <li key={n.id} className="fx-row fx-row--between border-t border-border-base pt-2 first:border-0 first:pt-0">
            <span className="fx-stack gap-0.5 fx-min0">
              <Link href={`/admin/credit-notes/${n.id}`} className="font-mono text-accent fx-break">{n.number}</Link>
              <span className="text-muted">
                {n.kind === 'refund' ? 'Sale refunded' : 'Sale voided'} · {formatEventTime(n.issuedAt, timezone, { time: false })} · {money(n.amountCents)}
                {n.invoiceId !== invoice.id ? ' · carried from an earlier invoice' : ''}
              </span>
              {n.reason && <span className="text-subtle">{n.reason}</span>}
            </span>
            <span className="es-nums text-right">
              <span className="block text-ink">{n.appliedCents > 0 ? `−${money(n.appliedCents)} here` : 'Nothing here'}</span>
              {n.remainingCents > 0 && <span className="block text-xs text-muted">{money(n.remainingCents)} credit left</span>}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
