'use client';

import { useState } from 'react';
import { useApi } from '../../../../hooks/useApi';
import { formatMoney } from '../../../../utils/money';
import { formatEventTime } from '../../../../lib/eventTime';
import { SectionHeader } from '../../../../components/ui/Page';
import { Kpi, KpiRow } from '../../../../components/ui/Kpi';
import { Segmented, SearchBox, Pagination } from '../../../../components/ui/Filters';
import DataTable from '../../../../components/ui/DataTable';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import SplitEmpty from '../../../../components/ui/SplitEmpty';
import { OrderTicketArt } from '../../../../components/ui/Illustrations';
import { useEventContext } from '../EventContext';
import NavIcon from '../../../../components/shell/NavIcon';
import { useToast } from '../../../../components/ui/Toast';
import { messageFor } from '../../../../utils/errors';
import OrdersReport from './OrdersReport';
import { downloadOrdersXlsx } from './ordersXlsx';

/**
 * Every order, both channels.
 *
 * Exists because `/manual-sales` filters `channel = 'manual'` — so until it was
 * added an organizer could see the cash taken at the door and NOTHING sold
 * online, which is the wrong half.
 *
 * The totals are for the WHOLE filtered set, summed in the database, not for
 * the rows on screen. "To you" is what the organizer keeps: a door sale's
 * commission is owed to Eventsli, so it comes off here as it does on the
 * dashboard. Times are on the event's clock, with the zone named.
 */
const CHANNELS = [
  { value: '', label: 'Every channel' },
  { value: 'stripe', label: 'Card' },
  { value: 'manual', label: 'At the door' },
];
const STATUSES = [
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Unfinished' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'Any' },
];

export default function Orders({ eventId }) {
  const event = useEventContext()?.event;
  const timezone = event?.timezone;
  const toast = useToast();
  // The filters as they were when "PDF" was pressed — a snapshot, so the
  // report does not refetch while it is open.
  const [report, setReport] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('paid');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ status, limit: '25', page: String(page) });
  if (channel) query.set('channel', channel);
  if (search) query.set('q', search);

  const { data, error, loading, reload } = useApi(`/events/${eventId}/orders?${query}`, { raw: true });
  const rows = data?.data || [];
  const totals = Object.entries(data?.meta?.totals || {});
  const filter = (setter) => (value) => { setter(value); setPage(1); };
  const hasRows = rows.length > 0;

  /** Every order under the filters on screen, as a styled .xlsx (ordersXlsx.js). */
  async function downloadExcel() {
    setExporting(true);
    try {
      const count = await downloadOrdersXlsx({ eventId, event, filters: { status, channel, search } });
      toast.success(`Downloaded ${count} ${count === 1 ? 'order' : 'orders'} to Excel.`);
    } catch (err) {
      toast.error(messageFor(err), { title: 'The download did not finish' });
    } finally {
      setExporting(false);
    }
  }

  // Both act on every order under the filters on screen, not just this page.
  const exportActions = (
    <div className="fx-row flex-wrap gap-2" role="group" aria-label="Export orders">
      <button
        type="button"
        className="es-btn es-btn--secondary"
        onClick={downloadExcel}
        disabled={exporting || !hasRows}
        aria-label={exporting ? 'Preparing the Excel file' : 'Download these orders as an Excel file'}
      >
        <NavIcon name={exporting ? 'refresh' : 'grid'} size={18} />
        {exporting ? 'Preparing…' : 'Excel'}
      </button>
      <button
        type="button"
        className="es-btn es-btn--secondary"
        onClick={() => setReport({ status, channel, search })}
        disabled={!hasRows}
        aria-label="Open a sales report of these orders to save as PDF"
      >
        <NavIcon name="printer" size={18} />
        PDF
      </button>
    </div>
  );

  return (
    <div className="fx-stack">
      <SectionHeader title="Orders" lede="Every sale on this event, online and at the door." actions={exportActions} />

      {report && <OrdersReport eventId={eventId} event={event} filters={report} onClose={() => setReport(null)} />}

      {totals.length > 0 && totals.map(([currency, t]) => (
        <KpiRow key={currency} label={`Sales in ${currency}`}>
          <Kpi icon="coins" label={`Sales · ${currency}`} value={formatMoney(t.grossCents, currency)} note="What buyers paid" />
          <Kpi icon="bank" label="To you" value={formatMoney(t.netCents, currency)} note="After commission, door sales included" tone="success" />
          <Kpi icon="receipt" label="Orders" value={t.orders} note={`${data.meta.byChannel?.stripe ?? 0} card · ${data.meta.byChannel?.manual ?? 0} door`} />
          <Kpi icon="ticket" label="Tickets" value={t.tickets} note="In the orders shown" />
        </KpiRow>
      ))}

      <div className="es-toolbar es-toolbar--stack">
        <div className="fx-row es-filtergroups">
          <Segmented label="Channel" showLabel value={channel} onChange={filter(setChannel)} options={CHANNELS} />
          <Segmented label="Status" showLabel value={status} onChange={filter(setStatus)} options={STATUSES} />
        </div>
        <SearchBox label="Search orders" placeholder="Buyer name or email" value={search} onSearch={filter(setSearch)} />
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={4} label="Loading orders" />
      ) : rows.length === 0 ? (
        /* "Yet" only on the default view. Under a filter or a search the
           orders may well exist — saying "none yet" there would be wrong. */
        status === 'paid' && !search && !channel ? (
          <SplitEmpty art={<OrderTicketArt />} title="No orders yet">
            Paid orders will appear here as soon as someone buys a ticket.
          </SplitEmpty>
        ) : (
          <SplitEmpty art={<OrderTicketArt />} title="No orders match">
            Try another filter, or clear the search.
          </SplitEmpty>
        )
      ) : (
        <>
          <DataTable
            caption="Orders"
            rows={rows}
            columns={[
              {
                key: 'buyer',
                label: 'Buyer',
                primary: true,
                render: (o) => (
                  <span className="fx-stack fx-stack--sm gap-0.5">
                    <span className="fx-break text-ink">{o.buyer.name || 'No name given'}</span>
                    <span className="fx-break text-sm text-muted">
                      {o.buyer.email || 'No email'}
                      {o.buyer.hasAccount && ' · has an account'}
                    </span>
                  </span>
                ),
              },
              {
                key: 'channel',
                label: 'Channel',
                render: (o) => <span className="es-pill">{o.channel === 'manual' ? `Door · ${o.manual?.method || 'manual'}` : 'Card'}</span>,
              },
              // Whose guest the buyer said they are (2026-11-23) — shown once any order has one.
              ...(rows.some((o) => o.guestOf) ? [{
                key: 'guestOf',
                label: 'Guest of',
                render: (o) => (o.guestOf ? <span className="es-pill">{o.guestOf.name}</span> : <span className="text-subtle">—</span>),
              }] : []),
              { key: 'tickets', label: 'Tickets', align: 'end', render: (o) => <span className="es-nums">{o.tickets}</span> },
              { key: 'paid', label: 'Paid', align: 'end', render: (o) => <span className="es-nums">{formatMoney(o.buyerPaidCents, o.currency)}</span> },
              { key: 'net', label: 'To you', align: 'end', render: (o) => <span className="es-nums text-muted">{formatMoney(o.organizerNetCents, o.currency)}</span> },
              {
                key: 'when',
                label: 'When',
                wide: true,
                render: (o) => <span className="whitespace-nowrap">{formatEventTime(o.paidAt || o.createdAt, timezone)}</span>,
              },
            ]}
          />
          <Pagination pagination={data.pagination} onPage={setPage} />
        </>
      )}
    </div>
  );
}
