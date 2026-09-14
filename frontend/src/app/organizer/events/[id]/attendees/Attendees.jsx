'use client';

import { useState } from 'react';
import { useApi } from '../../../../hooks/useApi';
import { SectionHeader, Panel } from '../../../../components/ui/Page';
import { Segmented, SearchBox, Pagination } from '../../../../components/ui/Filters';
import DataTable from '../../../../components/ui/DataTable';
import Ring from '../../../../components/charts/Ring';
import { percent } from '../../../../components/charts/chartMath';
import { Loading, Empty, ErrorNotice } from '../../../../components/Feedback';

/**
 * The door list — one row per ticket.
 *
 * NO QR CODES, and that is the API's decision rather than an omission. This
 * list can be screenshotted and shared, so the credential that admits someone
 * does not belong in it. The gate reads codes; this answers "who is coming, and
 * who is in".
 *
 * The admission time is `checkedInAt`. The page used to read `scannedAt`, which
 * the API never sends — so every guest read "Not yet" however long they had been
 * inside.
 */
const CHECKED = [
  { value: '', label: 'Everyone' },
  { value: 'true', label: 'In' },
  { value: 'false', label: 'Not yet' },
];

export default function Attendees({ eventId }) {
  const [checkedIn, setCheckedIn] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ limit: '50', page: String(page) });
  if (checkedIn) query.set('checkedIn', checkedIn);
  if (search) query.set('q', search);

  const { data, error, loading } = useApi(`/events/${eventId}/attendees?${query}`, { raw: true });
  const rows = data?.data || [];
  const meta = data?.meta;
  const share = meta ? percent(meta.admitted, meta.valid + meta.admitted) : null;

  return (
    <div className="fx-stack">
      <SectionHeader title="Door list" lede="Everyone holding a ticket, and whether they have walked in yet." />

      {meta && (
        <Panel>
          <Ring
            fraction={meta.valid + meta.admitted ? meta.admitted / (meta.valid + meta.admitted) : 0}
            value={share === null ? '—' : `${share}%`}
            caption={`${meta.admitted} in · ${meta.valid} still to arrive`}
          />
        </Panel>
      )}

      <div className="fx-stack fx-stack--sm">
        <Segmented label="Filter" value={checkedIn} onChange={(v) => { setCheckedIn(v); setPage(1); }} options={CHECKED} />
        <SearchBox label="Search the door list" placeholder="Name or email" value={search} onSearch={(v) => { setSearch(v); setPage(1); }} />
      </div>

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={5} label="Loading the door list" />
      ) : rows.length === 0 ? (
        <Empty title="Nobody matches." hint={search || checkedIn ? 'Try another filter, or clear the search.' : 'Tickets appear here once they sell.'} />
      ) : (
        <>
          <DataTable
            caption="Door list"
            rowKey={(a) => a.ticketId}
            rows={rows}
            columns={[
              {
                key: 'guest',
                label: 'Guest',
                primary: true,
                render: (a) => (
                  <span className="fx-stack fx-stack--sm gap-0.5">
                    <span className="fx-break text-ink">{a.name || 'No name given'}</span>
                    <span className="fx-break text-sm text-muted">
                      {a.email || 'No email'}
                      {a.transferred && ` · transferred from ${a.transferred.from}`}
                    </span>
                  </span>
                ),
              },
              { key: 'seat', label: 'Seat', render: (a) => [a.table && `Table ${a.table}`, a.seat].filter(Boolean).join(' · ') || '—' },
              { key: 'tier', label: 'Ticket', render: (a) => a.tier || (a.channel === 'manual' ? 'Door sale' : '—') },
              {
                key: 'status',
                label: 'At the door',
                align: 'end',
                render: (a) => (a.checkedIn ? (
                  <span className="es-pill es-pill--accent">
                    In{a.checkedInAt ? ` · ${new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(new Date(a.checkedInAt))}` : ''}
                  </span>
                ) : a.status === 'void' ? (
                  <span className="es-pill es-pill--danger">Void</span>
                ) : (
                  <span className="es-pill">Not yet</span>
                )),
              },
            ]}
          />
          <Pagination pagination={data.pagination} onPage={setPage} />
        </>
      )}

      <p className="text-sm text-subtle">
        Entry codes are not shown here — this list can be screenshotted and shared. Scanning happens at the gate.
      </p>
    </div>
  );
}
