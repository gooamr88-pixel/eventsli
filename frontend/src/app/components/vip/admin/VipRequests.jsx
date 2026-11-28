'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../../hooks/useApi';
import { useNowMinute } from '../../../hooks/useNowMinute';
import { Segmented, SearchBox, Pagination } from '../../ui/Filters';
import { StatCard } from '../../ui/Page';
import { Loading, Empty, ErrorNotice } from '../../Feedback';
import NavIcon from '../../shell/NavIcon';
import SocialIcon from '../../vendors/booking/SocialIcon';
import { usePolling } from '../VipComposer';
import { STATUS, when } from '../vipStatus';

/**
 * The console's list of VIP requests (2026-11-28): open work first, a dot
 * where the organizer wrote since the team last looked.
 */
export default function VipRequests() {
  const [view, setView] = useState('open');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const now = useNowMinute();
  const { data, error, loading, reload } = useApi(`/admin/vip/requests?view=${view}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  usePolling(reload, 30_000);
  const c = data?.counts;

  return (
    <div className="fx-stack">
      {c && (
        <div className="es-statgrid">
          <StatCard icon="bell" label="New" value={c.new} />
          <StatCard icon="chat" label="Waiting for a reply" value={c.waiting} />
          <StatCard icon="pulse" label="Confirmed or in progress" value={c.inProgress} note={`${c.open} open in all`} />
          <StatCard icon="phone" label="Unmatched chats" value={c.unmatched} href="/admin/vip?tab=inbox" />
        </div>
      )}

      <div className="es-demo-admin__filters">
        <Segmented
          label="Show"
          value={view}
          onChange={(v) => { setView(v); setPage(1); }}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'new', label: 'New' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />
        <SearchBox label="Search requests" placeholder="Reference, name, email or event" value={q} onSearch={(v) => { setQ(v); setPage(1); }} />
      </div>

      {loading ? <Loading variant="list" rows={4} label="Loading requests" />
        : error ? <ErrorNotice error={error} onRetry={reload} />
          : data.requests.length === 0 ? (
            <Empty title={q ? 'No requests match' : view === 'open' ? 'No open requests' : 'Nothing here yet'}
              hint={!q ? 'Organizers ask from VIP Services in their dashboard.' : undefined} />
          ) : (
            <ul className="es-viplist">
              {data.requests.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/vip/${r.id}`} className="es-viplist__row">
                    <span className="es-viplist__ref es-nums">
                      {r.unread && <span className="es-viplist__dot" aria-label="New message from the organizer" />}
                      {r.reference}
                    </span>
                    <span className="es-viplist__what fx-min0">
                      <b className="fx-truncate">{r.contactName}{r.organizer ? ` · ${r.organizer.name}` : r.source === 'visitor' ? ` · ${r.company || 'Visitor'}` : ''}</b>
                      <span className="fx-truncate">{r.serviceTitles.join(', ')} · {r.event?.title || r.eventName || 'No event'} · {when(r.updatedAt, now)}</span>
                    </span>
                    {r.whatsappNumber && (
                      <span className={`es-viplist__wa${r.whatsappOptIn ? ' is-on' : ''}`} title={r.whatsappOptIn ? 'Agreed to WhatsApp updates' : 'WhatsApp number, no opt-in'}>
                        <SocialIcon name="whatsapp" size={16} />
                      </span>
                    )}
                    <span className={`es-pill ${STATUS[r.status]?.pill || ''}`}>{STATUS[r.status]?.label}</span>
                    <NavIcon name="chevronRight" size={18} className="es-viplist__go" />
                  </Link>
                </li>
              ))}
            </ul>
          )}

      <Pagination pagination={data?.pagination} onPage={setPage} />
    </div>
  );
}
