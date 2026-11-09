'use client';

import { useState } from 'react';
import { useApi } from '../../../../hooks/useApi';
import { formatEventTime } from '../../../../lib/eventTime';
import { messageFor } from '../../../../utils/errors';
import { useToast } from '../../../../components/ui/Toast';
import { SectionHeader } from '../../../../components/ui/Page';
import { Kpi, KpiRow } from '../../../../components/ui/Kpi';
import { Segmented, SearchBox, Pagination } from '../../../../components/ui/Filters';
import DataTable from '../../../../components/ui/DataTable';
import NavIcon from '../../../../components/shell/NavIcon';
import { StackedEmpty } from '../../../../components/ui/SplitEmpty';
import { ScannerArt, PeopleArt } from '../../../../components/ui/Illustrations';
import { percent } from '../../../../components/charts/chartMath';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { useEventContext } from '../EventContext';
import { fetchDoorList, doorListCsv, saveCsv } from './doorListCsv';

/**
 * The door list — one row per ticket.
 *
 * NO QR CODES, and that is the API's decision rather than an omission. This
 * list can be screenshotted and shared, so the credential that admits someone
 * does not belong in it. The gate reads codes; this answers "who is coming, and
 * who is in". The same holds for the CSV download (doorListCsv.js).
 *
 * The admission time is `checkedInAt`, on the event's clock with the zone
 * named — it was printed in the viewer's zone, so an organizer checking the
 * door from another city read every arrival hours off.
 *
 * The search is name or email ONLY — that is what the API matches. A
 * placeholder offering "ticket code" would promise a search that finds nothing.
 */
const CHECKED = [
  { value: '', label: 'Everyone' },
  { value: 'true', label: 'In' },
  { value: 'false', label: 'Not yet' },
  // Offline conflicts: two check-in phones with no signal both let the same
  // ticket in. Both people are inside; this is the list to follow up from.
  { value: 'conflict', label: 'Let in twice' },
];

export default function Attendees({ eventId }) {
  const event = useEventContext()?.event;
  const timezone = event?.timezone;
  const toast = useToast();
  const [checkedIn, setCheckedIn] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const query = new URLSearchParams({ limit: '50', page: String(page) });
  if (checkedIn) query.set('checkedIn', checkedIn);
  if (search) query.set('q', search);

  const { data, error, loading, reload } = useApi(`/events/${eventId}/attendees?${query}`, { raw: true });
  const rows = data?.data || [];
  const meta = data?.meta;
  const share = meta ? percent(meta.admitted, meta.valid + meta.admitted) : null;
  const filtered = Boolean(search || checkedIn);

  async function download() {
    setExporting(true);
    try {
      const all = await fetchDoorList(eventId, { checkedIn, search });
      const slug = (event?.slug || 'event').replace(/[^a-z0-9-]/gi, '');
      saveCsv(doorListCsv(all, timezone), `door-list-${slug}.csv`);
      toast.success(`Downloaded ${all.length} ${all.length === 1 ? 'ticket' : 'tickets'}.`);
    } catch (err) {
      toast.error(messageFor(err), { title: 'The download did not finish' });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fx-stack">
      <SectionHeader
        icon="scan"
        title="Door list"
        lede="Everyone holding a ticket, and whether they have walked in yet."
        art={<ScannerArt />}
      />

      {/* The door at a glance: everyone holding a ticket, how many are in,
          and how many are still to come — the three numbers a door manager
          reads off this page during the night. */}
      {meta && (
        <KpiRow label="The door at a glance">
          <Kpi icon="ticket" label="Tickets" value={(meta.valid + meta.admitted).toLocaleString()} note="Holding a valid ticket" featured />
          <Kpi icon="check" label="Checked in" value={meta.admitted.toLocaleString()} note={share === null ? 'Nobody yet' : `${share}% of tickets`} tone="success" />
          <Kpi icon="clock" label="Still to arrive" value={meta.valid.toLocaleString()} note={meta.valid ? 'Not scanned yet' : '—'} />
        </KpiRow>
      )}

      <div className="es-doorbar">
        <div className="es-toolbar es-doorbar__filters">
          <Segmented label="Filter" value={checkedIn} onChange={(v) => { setCheckedIn(v); setPage(1); }} options={CHECKED} />
          <SearchBox label="Search the door list" placeholder="Name or email" value={search} onSearch={(v) => { setSearch(v); setPage(1); }} />
        </div>
        <button type="button" className="es-iconbtn" onClick={reload} disabled={loading} aria-label="Refresh the door list" title="Refresh">
          <NavIcon name="refresh" size={20} />
        </button>
        <button
          type="button"
          className="es-iconbtn"
          onClick={download}
          disabled={exporting || !rows.length}
          aria-label={exporting ? 'Preparing the download' : 'Download the door list as a CSV file'}
          title="Download CSV"
        >
          <NavIcon name="download" size={20} />
        </button>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={5} label="Loading the door list" />
      ) : rows.length === 0 ? (
        <StackedEmpty art={<PeopleArt className="es-art--people" />} title="Nobody matches.">
          {filtered ? 'Try another filter, or clear the search.' : 'No one is holding a ticket yet. Tickets appear here once they sell.'}
        </StackedEmpty>
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
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    <span className="es-pill es-pill--accent">
                      In{a.checkedInAt ? ` · ${formatEventTime(a.checkedInAt, timezone, { date: false })}` : ''}
                    </span>
                    {a.conflict && (
                      <span className="es-pill es-pill--warning" title="Two check-in phones with no signal both let this ticket in. Both people may be inside.">
                        Let in at two doors
                      </span>
                    )}
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
