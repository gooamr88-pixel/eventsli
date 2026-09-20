'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { formatMoney } from '../../utils/money';
import { safeExternalUrl } from '../../utils/safeUrl';
import { formatEventTime } from '../../lib/eventTime';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/Confirm';
import { PageHeader } from '../../components/ui/Page';
import { Segmented, Pagination } from '../../components/ui/Filters';
import DataTable from '../../components/ui/DataTable';
import InvoiceStatus from '../../components/ui/InvoiceStatus';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';

/**
 * Commission invoices, across every event.
 *
 * Settling one is the act that reopens that event's gate — there is no separate
 * unlock, because a settlement you can forget to act on is a settlement that
 * leaves a door shut. The API reports `gateReopened` and this screen says so,
 * since the person clicking it is usually on the phone to the organizer.
 *
 * OVERDUE is the filter that matters most, and it was missing: the hourly job
 * moves unpaid invoices to `overdue`, and those — the ones shutting gates —
 * matched no filter here and showed as a raw grey word.
 *
 * Proof is EVIDENCE, not authority: an invoice with a receipt attached is still
 * unpaid. The link opens in a new tab because checking it is the whole job.
 */
const STATUSES = [
  { value: '', label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'open', label: 'Unpaid' },
  { value: 'submitted', label: 'Receipt sent' },
  { value: 'paid', label: 'Settled' },
];

export default function Invoices() {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);

  const query = new URLSearchParams({ limit: '25', page: String(page) });
  if (status) query.set('status', status);
  const { data, error, loading, reload } = useApi(`/admin/invoices?${query}`, { raw: true });
  const rows = data?.data || [];

  async function settle(invoice) {
    const answer = await confirm({
      title: `Settle ${invoice.number}?`,
      body: (
        <>
          <p>
            Confirm you have received {formatMoney(invoice.amountCents, invoice.currency)}. This marks it paid and
            reopens that event&rsquo;s gate.
          </p>
          <p>Check the receipt first — submitting one did not reopen anything on its own.</p>
        </>
      ),
      confirmLabel: 'Money received — settle it',
      reason: { label: 'Note for the audit log', minLength: 0, maxLength: 500, hint: 'Optional — e.g. the transfer reference.' },
    });
    if (!answer) return;

    setBusyId(invoice.id);
    try {
      const result = await post(`/admin/invoices/${invoice.id}/settle`, {
        note: answer.reason || undefined,
      }, { noRedirect: true });
      toast.success(result?.gateReopened
        ? 'Scanning is back on for that event — nothing else to do.'
        : 'Something else is still outstanding, so scanning stays off.', { title: `${invoice.number} settled` });
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Money"
        title="Commission invoices"
        lede="Raised against door sales only. Card sales settle themselves — the money passed through us and the fee was already taken."
      />

      <Segmented label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUSES} />

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={4} label="Loading invoices" />
      ) : rows.length === 0 ? (
        <Empty
          title="No invoices in this state."
          hint={status === 'overdue' ? 'No gate is shut by an unpaid invoice right now.' : 'Try another filter — an invoice only appears once an event has door sales.'}
        />
      ) : (
        <>
          <DataTable
            caption="Commission invoices"
            rows={rows}
            columns={[
              {
                key: 'event',
                label: 'Event',
                primary: true,
                render: (i) => (
                  <span className="fx-stack fx-stack--sm gap-0.5">
                    {i.event?.id
                      ? <Link href={`/admin/events/${i.event.id}`} className="fx-break text-ink hover:text-accent">{i.event.title}</Link>
                      : <span className="text-ink">Event</span>}
                    <span className="text-sm text-muted">{i.organizer?.name} · {i.number}</span>
                  </span>
                ),
              },
              { key: 'sales', label: 'Door sales', align: 'end', render: (i) => <span className="es-nums">{i.orderCount}</span> },
              { key: 'amount', label: 'Amount', align: 'end', render: (i) => <span className="es-nums text-ink">{formatMoney(i.amountCents, i.currency)}</span> },
              {
                key: 'due',
                label: 'Due',
                render: (i) => (
                  <span className="fx-stack fx-stack--sm gap-0.5">
                    {/* Your own clock, with the zone named — the list spans events in several zones. */}
                    <span className="whitespace-nowrap">{formatEventTime(i.dueAt)}</span>
                    <InvoiceStatus invoice={i} />
                  </span>
                ),
              },
              {
                key: 'actions',
                label: 'Actions',
                hideLabel: true,
                align: 'end',
                render: (i) => (
                  <span className="fx-row justify-end">
                    {/* Was an inline `/^https?:\/\//i` test here — the same rule,
                        written in this one place. `safeExternalUrl` also strips
                        the control characters a browser strips before acting on
                        a URL, which a `startsWith`-shaped check cannot see. */}
                    {safeExternalUrl(i.proofUrl) && (
                      <a href={safeExternalUrl(i.proofUrl)} target="_blank" rel="noreferrer noopener" className="es-btn es-btn--ghost es-btn--sm">
                        Receipt <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    )}
                    {!['paid', 'waived'].includes(i.status) && (
                      <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={busyId === i.id} onClick={() => settle(i)}>
                        {busyId === i.id ? 'Settling…' : 'Settle'}
                      </button>
                    )}
                  </span>
                ),
              },
            ]}
          />
          <Pagination pagination={data.pagination} onPage={setPage} />
        </>
      )}
    </div>
  );
}
