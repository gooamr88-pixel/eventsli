'use client';

import { useState } from 'react';
import { useApi } from '../../../hooks/useApi';
import { Segmented, SearchBox, Pagination } from '../../ui/Filters';
import { StatCard } from '../../ui/Page';
import { Loading, Empty, ErrorNotice } from '../../Feedback';
import NavIcon from '../../shell/NavIcon';
import { spanLabel } from '../../../lib/demoTime';
import DemoBookingDialog from './DemoBookingDialog';
import { STATUS } from './demoStatus';

/**
 * The bookings, newest work first (2026-11-19). Times read on the HOST's
 * clock (the settings' zone), the one the team works to; the booker's own
 * zone is in the booking.
 */

export default function DemoBookings({ openId }) {
  const [view, setView] = useState('upcoming');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(openId || null);
  const settings = useApi('/admin/demo/settings');
  const hosts = useApi('/admin/demo/hosts');
  const { data, error, loading, reload } = useApi(`/admin/demo/bookings?view=${view}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const zone = settings.data?.settings?.timezone || 'UTC';
  const counts = data?.counts;
  const hostName = (id) => hosts.data?.hosts?.find((h) => h.id === id)?.name;

  return (
    <div className="fx-stack">
      {counts && (
        <div className="es-statgrid">
          <StatCard icon="calendar" label="Upcoming" value={counts.upcoming} />
          <StatCard icon="clock" label="Next 7 days" value={counts.nextWeek} />
          <StatCard icon="check" label="Done" value={counts.completed} />
          <StatCard icon="ban" label="Missed" value={counts.noShow} note={`${counts.cancelled} cancelled`} />
        </div>
      )}

      <div className="es-demo-admin__filters">
        <Segmented
          label="Show"
          value={view}
          onChange={(v) => { setView(v); setPage(1); }}
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'past', label: 'Past' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'all', label: 'All' },
          ]}
        />
        <SearchBox label="Search bookings" placeholder="Name, email or event" value={q} onSearch={(v) => { setQ(v); setPage(1); }} />
      </div>

      {loading ? <Loading variant="list" rows={4} label="Loading bookings" />
        : error ? <ErrorNotice error={error} onRetry={reload} />
          : data.bookings.length === 0 ? (
            <Empty
              title={q ? 'No bookings match' : view === 'upcoming' ? 'No upcoming demos' : 'Nothing here yet'}
              hint={view === 'upcoming' && !q ? 'New bookings from the public Book a demo page appear here.' : undefined}
            />
          ) : (
            <ul className="es-demo-admin__list">
              {data.bookings.map((b) => (
                <li key={b.id}>
                  <button type="button" className="es-demo-admin__row" onClick={() => setOpen(b.id)}>
                    <span className="es-demo-admin__when">
                      <NavIcon name="calendar" size={18} />
                      {spanLabel(b.startsAt, b.endsAt, zone)}
                    </span>
                    <span className="es-demo-admin__who">
                      <b>{b.name}</b>
                      <span>{[b.company, b.email].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="es-demo-admin__meta">
                      {b.assignedTo && hostName(b.assignedTo) && <span className="es-demo-admin__host">{hostName(b.assignedTo)}</span>}
                      <span className={`es-pill ${STATUS[b.status][1]}`}>{STATUS[b.status][0]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

      <Pagination pagination={data?.pagination} onPage={setPage} />

      {open && (
        <DemoBookingDialog
          id={open}
          zone={zone}
          hosts={hosts.data?.hosts || []}
          onClose={() => setOpen(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
