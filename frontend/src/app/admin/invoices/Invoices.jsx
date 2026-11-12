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
import { Segmented, SearchBox, Pagination } from '../../components/ui/Filters';
import DataTable from '../../components/ui/DataTable';
import InvoiceStatus from '../../components/ui/InvoiceStatus';
import { Kpi, KpiRow } from '../../components/ui/Kpi';
import { StackedEmpty } from '../../components/ui/SplitEmpty';
import { InvoiceArt } from '../../components/ui/Illustrations';
import { Loading, ErrorNotice } from '../../components/Feedback';
import NavIcon from '../../components/shell/NavIcon';
import ReadyToInvoice from './ReadyToInvoice';

/** "Issued in the last N days". The cut-off is worked out in the change
 *  handler, not during render — `Date.now()` in render is refused here. */
const ISSUED = [
  { value: '', label: 'Any date' },
  { value: '30', label: 'Issued in the last 30 days' },
  { value: '90', label: 'Issued in the last 90 days' },
  { value: '365', label: 'Issued in the last year' },
];

/** One figure per currency, side by side — CAD and USD are never summed. */
function perCurrency(byCurrency, key) {
  const entries = Object.entries(byCurrency || {});
  if (!entries.length) return formatMoney(0, 'CAD');
  return entries.map(([currency, t]) => formatMoney(t[key], currency)).join(' · ');
}

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
  { value: 'waived', label: 'Waived' },
  { value: 'void', label: 'Void' },
];

export default function Invoices({ initialStatus = '', eventId = '' }) {
  const toast = useToast();
  const confirm = useConfirm();
  // From `?status=` — the receipt email links straight to the review queue.
  const [status, setStatus] = useState(STATUSES.some((s) => s.value === initialStatus) ? initialStatus : '');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const [issued, setIssued] = useState({ days: '', since: '' });
  const [organizerId, setOrganizerId] = useState('');
  const [search, setSearch] = useState('');

  const query = new URLSearchParams({ limit: '25', page: String(page) });
  if (status) query.set('status', status);
  if (issued.since) query.set('issuedSince', issued.since);
  if (organizerId) query.set('organizerId', organizerId);
  if (search) query.set('q', search);
  if (eventId) query.set('eventId', eventId);
  const { data, error, loading, reload } = useApi(`/admin/invoices?${query}`, { raw: true });
  // For the organizer picker: everyone who sells, by name. 200 is the API's
  // page ceiling; past that the search box is the better tool anyway.
  const organizers = useApi('/admin/organizers?limit=200&sort=display_name&order=asc', { raw: true });
  const rows = data?.data || [];
  const totals = data?.meta?.totals;
  const filtered = Boolean(status || issued.since || organizerId || search || eventId);

  function pickIssued(days) {
    setIssued({ days, since: days ? new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString() : '' });
    setPage(1);
  }

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
      const told = result?.organizerNotified ? ' The organizer has been emailed a confirmation.' : '';
      toast.success(result?.gateReopened
        ? `Scanning is on for that event — nothing else to do.${told}`
        : `Something else is still outstanding, so scanning stays off.${told}`, { title: `${invoice.number} settled` });
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
        icon="receipt"
        title="Commission invoices"
        lede="Raised against door sales only. Card sales settle themselves — the money passed through us and the fee was already taken."
      />

      {/* Every invoice, whatever the filters below — see invoiceTotals() in
          the API. Hidden until the API that sends them is deployed. */}
      {totals && (
        <KpiRow label="Invoices at a glance" tiles>
          <Kpi icon="receipt" label="Total invoices" value={totals.count.toLocaleString()} />
          <Kpi icon="coins" label="Total amount" value={perCurrency(totals.byCurrency, 'totalCents')} note="Waived invoices left out" />
          <Kpi icon="card" label="Unpaid" value={perCurrency(totals.byCurrency, 'unpaidCents')} note="Open, receipt sent or overdue" />
          <Kpi icon="check" label="Settled" value={perCurrency(totals.byCurrency, 'settledCents')} iconTone="success" />
        </KpiRow>
      )}

      <ReadyToInvoice onRaised={reload} />

      <Segmented label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUSES} />

      <div className="es-invfilters">
        <label className="es-selectfield">
          <span className="sr-only">Issued</span>
          <NavIcon name="calendar" size={20} />
          <select className="es-input" value={issued.days} onChange={(e) => pickIssued(e.target.value)}>
            {ISSUED.map((o) => <option key={o.value || 'any'} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="es-selectfield">
          <span className="sr-only">Organizer</span>
          <NavIcon name="users" size={20} />
          <select className="es-input" value={organizerId} onChange={(e) => { setOrganizerId(e.target.value); setPage(1); }}>
            <option value="">All organizers</option>
            {(organizers.data?.data || []).map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}
          </select>
        </label>
        <SearchBox label="Search invoices" placeholder="Event title or invoice number" value={search} onSearch={(v) => { setSearch(v); setPage(1); }} />
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={4} label="Loading invoices" />
      ) : rows.length === 0 ? (
        <StackedEmpty art={<InvoiceArt badge="percent" />} title={filtered ? 'No invoices in this state.' : 'No invoices yet.'}>
          {status === 'overdue'
            ? 'No gate is shut by an unpaid invoice right now.'
            : 'Try another filter — an invoice only appears once an event has door sales.'}
        </StackedEmpty>
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
                    <span className="text-sm text-muted">
                      {i.organizer?.name} · <Link href={`/admin/invoices/${i.id}`} className="font-mono text-accent">{i.number}</Link>
                    </span>
                  </span>
                ),
              },
              { key: 'sales', label: 'Door sales', align: 'end', render: (i) => <span className="es-nums">{i.orderCount}</span> },
              {
                key: 'amount',
                label: 'Amount',
                align: 'end',
                render: (i) => (
                  <span className="fx-stack fx-stack--sm items-end gap-0.5">
                    <span className="es-nums text-ink">{formatMoney(i.amountCents, i.currency)}</span>
                    {i.balanceCents > 0 && i.balanceCents !== i.amountCents && (
                      <span className="es-nums text-xs text-muted">{formatMoney(i.balanceCents, i.currency)} to pay</span>
                    )}
                  </span>
                ),
              },
              {
                key: 'due',
                label: 'Due',
                wide: true,
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
                    <Link href={`/admin/invoices/${i.id}`} className="es-btn es-btn--ghost es-btn--sm">Manage</Link>
                    {!['paid', 'waived', 'void'].includes(i.status) && (
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
