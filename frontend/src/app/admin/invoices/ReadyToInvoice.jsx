'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/Confirm';
import { Panel } from '../../components/ui/Page';
import DataTable from '../../components/ui/DataTable';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DOOR COMMISSION NOBODY HAS INVOICED YET — and the button that invoices it.
 *
 * Raising an invoice is an admin's act, and until this panel existed no screen
 * offered it: the API had `POST /admin/events/:id/invoices`, nothing called it,
 * and so no invoice was ever raised. Door commission accrued as a receivable
 * that nobody was ever asked to pay, the organizer was never emailed, and the
 * overdue lock had nothing to lock on.
 *
 * Raising one emails the organizer the invoice (amount, due date, how to pay)
 * and starts the clock: if it is not settled by the due date — at most the
 * platform's "days to pay", and never later than the configured hours before
 * doors — scanning for that event switches off.
 *
 * Soonest event first. An event that still has an unpaid invoice is listed
 * but cannot be raised again: one open invoice per event, so its newer sales
 * go on the next one, once the current one is settled.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ReadyToInvoice({ onRaised }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi('/admin/invoices/ready');
  const [busyId, setBusyId] = useState(null);

  const rows = Array.isArray(data) ? data : [];
  const raisable = rows.filter((r) => r.canRaise).length;

  async function raise(row) {
    const ok = await confirm({
      title: `Invoice ${row.organizer?.name || 'the organizer'}?`,
      body: (
        <>
          <p>
            Raises an invoice for {formatMoney(row.uninvoicedCents, row.currency)} — commission on
            {' '}{row.doorSales} door {row.doorSales === 1 ? 'sale' : 'sales'} for <strong>{row.event.title}</strong> — and emails it to the organizer.
          </p>
          <p>If it is not settled by its due date, scanning for that event switches off.</p>
        </>
      ),
      confirmLabel: 'Raise and send',
    });
    if (!ok) return;

    setBusyId(row.event.id);
    try {
      const result = await post(`/admin/events/${row.event.id}/invoices`, {}, { noRedirect: true });
      toast.success(
        result?.organizerNotified
          ? 'The organizer has been emailed the invoice.'
          : 'Raised, but the email did not go — the organizer can still see it on their Commission page.',
        { title: `${result?.number || 'Invoice'} raised` },
      );
      reload();
      onRaised?.();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusyId(null);
    }
  }

  // Quiet when there is nothing to do or it could not load: this panel sits
  // above the invoice list, which has its own error state.
  if (error || (loading && !data) || rows.length === 0) return null;

  return (
    <Panel
      icon="coins"
      title="Ready to invoice"
      description={raisable
        ? `${raisable} ${raisable === 1 ? 'event has' : 'events have'} door commission nobody has been invoiced for.`
        : 'Door commission waiting for an unpaid invoice to be settled first.'}
    >
      <DataTable
        caption="Door commission not yet invoiced"
        rows={rows.map((r) => ({ ...r, id: `${r.event.id}:${r.currency}` }))}
        columns={[
          {
            key: 'event',
            label: 'Event',
            primary: true,
            render: (r) => (
              <span className="fx-stack fx-stack--sm gap-0.5">
                <Link href={`/admin/events/${r.event.id}`} className="fx-break text-ink hover:text-accent">{r.event.title}</Link>
                <span className="text-sm text-muted">
                  {r.organizer?.name} · {formatEventTime(r.event.startsAt, r.event.timezone, { time: false })}
                </span>
              </span>
            ),
          },
          { key: 'sales', label: 'Door sales', align: 'end', render: (r) => <span className="es-nums">{r.doorSales}</span> },
          {
            key: 'amount',
            label: 'Not invoiced',
            align: 'end',
            render: (r) => <span className="es-nums text-ink">{formatMoney(r.uninvoicedCents, r.currency)}</span>,
          },
          {
            key: 'actions',
            label: 'Actions',
            hideLabel: true,
            align: 'end',
            render: (r) => (r.canRaise ? (
              <button
                type="button"
                className="es-btn es-btn--primary es-btn--sm"
                disabled={busyId === r.event.id}
                onClick={() => raise(r)}
              >
                {busyId === r.event.id ? 'Raising…' : 'Raise invoice'}
              </button>
            ) : (
              <span className="text-sm text-muted">After the open invoice</span>
            )),
          },
        ]}
      />
    </Panel>
  );
}
