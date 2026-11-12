'use client';

import Link from 'next/link';
import { useApi } from '../../hooks/useApi';
import { formatEventTime } from '../../lib/eventTime';
import NavIcon from '../../components/shell/NavIcon';
import { verbOf } from '../audit/AuditDetail';

/**
 * The last few things an ADMIN did — the audit log's first page, in short.
 *
 * It says "by whom" because the log is a record of admin actions, not a feed
 * of everything that happens on the platform: there is no "new organizer
 * signed up" or "payout sent" entry to show, and inventing one here would put
 * a second, unofficial history beside the real one. The labels are the
 * audit page's own (verbOf), so the two can never word an action differently.
 *
 * Times are absolute, on the viewer's clock — "2 hours ago" would need the
 * current time during render, which the React rules here forbid.
 */
const ICONS = {
  event: 'calendar',
  user: 'user',
  organizer: 'users',
  invoice: 'receipt',
  scanner: 'scan',
  settings: 'settings',
};

export default function RecentActivity() {
  const { data, error, loading } = useApi('/admin/audit?limit=5&page=1', { raw: true });
  const entries = data?.data || [];

  return (
    <section className="es-dcard" aria-labelledby="admin-activity">
      <div className="es-dcard__head">
        <h2 id="admin-activity" className="es-dcard__title">
          <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="pulse" size={24} /></span>
          Recent activity
        </h2>
        <Link href="/admin/audit" className="es-btn es-btn--secondary es-btn--sm">
          View all activity
          <NavIcon name="arrow" size={16} />
        </Link>
      </div>

      {error ? (
        <p className="text-sm text-muted">The activity log could not be loaded just now.</p>
      ) : loading && !data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">No admin actions recorded yet.</p>
      ) : (
        <ul className="es-activity">
          {entries.map((entry) => {
            const [label] = verbOf(entry.action);
            const icon = ICONS[String(entry.action).split('.')[0]] || 'pulse';
            const who = entry.actor?.name || entry.actor?.email || 'Unknown admin';
            return (
              <li key={entry.id || `${entry.action}-${entry.at}`}>
                <span className="es-icontile" aria-hidden="true"><NavIcon name={icon} size={22} /></span>
                <span className="fx-min0 flex-1">
                  <b>{label}</b>
                  <small className="fx-break">by {who}</small>
                </span>
                <time dateTime={entry.at} className="es-activity__when">{formatEventTime(entry.at)}</time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
