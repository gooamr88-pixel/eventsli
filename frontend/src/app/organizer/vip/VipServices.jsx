'use client';

import Link from 'next/link';
import { useApi } from '../../hooks/useApi';
import { useNowMinute } from '../../hooks/useNowMinute';
import { Loading, ErrorNotice } from '../../components/Feedback';
import NavIcon from '../../components/shell/NavIcon';
import VipLanding from '../../components/vip/VipLanding';
import { STATUS, when } from '../../components/vip/vipStatus';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services, the organizer's front door (owner, 2026-11-28).
 *
 * The shared front door (components/vip/VipLanding — the same one visitors
 * see at /vip) with the organizer's own requests under the hero, a dot where
 * the team has written. "Start a request" opens the dashboard form, where the
 * request can name one of their events.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VipServices() {
  const opts = useApi('/organizer/vip/options');
  const list = useApi('/organizer/vip');
  const now = useNowMinute();

  if (opts.loading) return <Loading variant="list" rows={4} label="Loading VIP Services" />;
  if (opts.error) return <ErrorNotice error={opts.error} onRetry={opts.reload} />;
  const requests = list.data?.requests || [];

  return (
    <VipLanding settings={opts.data.settings} chatUrl={opts.data.chatUrl}>
      {requests.length > 0 && (
        <section className="fx-stack" aria-labelledby="vip-yours">
          <h2 id="vip-yours" className="es-vip__h2">Your requests</h2>
          <ul className="es-viplist">
            {requests.map((r) => (
              <li key={r.id}>
                <Link href={`/organizer/vip/${r.id}`} className="es-viplist__row">
                  <span className="es-viplist__ref es-nums">
                    {r.unread && <span className="es-viplist__dot" aria-label="New message" />}
                    {r.reference}
                  </span>
                  <span className="es-viplist__what fx-min0">
                    <b className="fx-truncate">{r.serviceTitles.join(', ')}</b>
                    <span className="fx-truncate">{r.event?.title || r.eventName || 'No event chosen'} · Updated {when(r.updatedAt, now)}</span>
                  </span>
                  <span className={`es-pill ${STATUS[r.status]?.pill || ''}`}>{STATUS[r.status]?.label || r.status}</span>
                  <NavIcon name="chevronRight" size={18} className="es-viplist__go" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </VipLanding>
  );
}
