'use client';

import { useState } from 'react';
import { useApi } from '../../../../hooks/useApi';
import { formatMoney } from '../../../../utils/money';
import { SectionHeader, StatCard } from '../../../../components/ui/Page';
import { Segmented, SearchBox, Pagination } from '../../../../components/ui/Filters';
import DataTable from '../../../../components/ui/DataTable';
import { Loading, Empty, ErrorNotice } from '../../../../components/Feedback';

/**
 * Every order, both channels.
 *
 * Exists because `/manual-sales` filters `channel = 'manual'` — so until it was
 * added an organizer could see the cash taken at the door and NOTHING sold
 * online, which is the wrong half.
 *
 * The totals are for the WHOLE filtered set, computed in the database, not for
 * the rows on screen. They also used to be read from the wrong object — the
 * response's `meta` holds `{ totals, byChannel }`, and the page iterated `meta`
 * itself, so "totals" and "byChannel" were rendered as if they were currencies.
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
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('paid');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ status, limit: '25', page: String(page) });
  if (channel) query.set('channel', channel);
  if (search) query.set('q', search);

  const { data, error, loading } = useApi(`/events/${eventId}/orders?${query}`, { raw: true });
  const rows = data?.data || [];
  const totals = Object.entries(data?.meta?.totals || {});
  const filter = (setter) => (value) => { setter(value); setPage(1); };

  return (
    <div className="fx-stack">
      <SectionHeader title="Orders" lede="Every sale on this event, online and at the door." />

      {totals.length > 0 && totals.map(([currency, t]) => (
        <div key={currency} className="fx-grid fx-grid--4">
          <StatCard label={`Sales · ${currency}`} value={formatMoney(t.grossCents, currency)} note="What buyers paid" icon="money" />
          <StatCard label="To you" value={formatMoney(t.netCents, currency)} note="After Eventsli's commission" icon="bank" />
          <StatCard label="Orders" value={t.orders} note={`${data.meta.byChannel?.stripe ?? 0} card · ${data.meta.byChannel?.manual ?? 0} door`} icon="receipt" />
          <StatCard label="Tickets" value={t.tickets} note="In the orders shown" icon="ticket" />
        </div>
      ))}

      <div className="fx-stack fx-stack--sm">
        <div className="fx-row">
          <Segmented label="Channel" value={channel} onChange={filter(setChannel)} options={CHANNELS} />
          <Segmented label="Status" value={status} onChange={filter(setStatus)} options={STATUSES} />
        </div>
        <SearchBox label="Search orders" placeholder="Buyer name or email" value={search} onSearch={filter(setSearch)} />
      </div>

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={4} label="Loading orders" />
      ) : rows.length === 0 ? (
        <Empty
          title="No orders match."
          hint={status === 'paid' && !search && !channel
            ? 'Paid orders appear here the moment a ticket sells.'
            : 'Try another filter, or clear the search.'}
        />
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
              { key: 'tickets', label: 'Tickets', align: 'end', render: (o) => <span className="es-nums">{o.tickets}</span> },
              { key: 'paid', label: 'Paid', align: 'end', render: (o) => <span className="es-nums">{formatMoney(o.buyerPaidCents, o.currency)}</span> },
              { key: 'net', label: 'To you', align: 'end', render: (o) => <span className="es-nums text-muted">{formatMoney(o.organizerNetCents, o.currency)}</span> },
              {
                key: 'when',
                label: 'When',
                render: (o) => (o.paidAt || o.createdAt
                  ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(o.paidAt || o.createdAt))
                  : '—'),
              },
            ]}
          />
          <Pagination pagination={data.pagination} onPage={setPage} />
        </>
      )}
    </div>
  );
}
