'use client';

import { useEffect, useState } from 'react';
import { get } from '../../utils/apiClient';
import { Loading, ErrorNotice } from '../../components/Feedback';

/**
 * Every administrative act, with its actor and its reason.
 *
 * "An admin did it" is not an answer when the organizer telephones — which is
 * why the API writes the reason into `admin_audit` alongside the action, and why
 * this page shows the payload rather than only the verb.
 *
 * Read-only, and there is no delete. A log an administrator can edit is not a
 * log.
 */
const VERBS = {
  'event.approved': ['Approved an event', 'text-success'],
  'event.rejected': ['Sent an event back', 'text-warning'],
  'event.suspended': ['Suspended an event', 'text-danger'],
  'event.unsuspended': ['Restored an event', 'text-success'],
  'user.blocked': ['Blocked an account', 'text-danger'],
  'user.unblocked': ['Unblocked an account', 'text-success'],
  'user.role_changed': ['Changed a role', 'text-info'],
  'organizer.banned': ['Banned an organizer', 'text-danger'],
  'organizer.unbanned': ['Unbanned an organizer', 'text-success'],
  'invoice.settled': ['Settled an invoice', 'text-success'],
  'invoice.raised': ['Raised an invoice', 'text-info'],
  'event.fees_changed': ['Changed event fees', 'text-info'],
  'settings.changed': ['Changed a platform setting', 'text-info'],
  'event.scanner_override': ['Overrode a locked gate', 'text-warning'],
};

export default function Audit() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/admin/audit?limit=100', { cache: 'no-store' });
        if (!cancelled) { setRows(Array.isArray(data) ? data : []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <ErrorNotice error={error} />;
  if (!rows) return <Loading variant="list" />;

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Audit</h2>
        <p className="max-w-[60ch] text-muted">
          Who did what, and why. Nothing here can be edited or removed.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {rows.map((entry) => {
            const [label, tone] = VERBS[entry.action] || [entry.action, 'text-muted'];
            const reason = entry.payload?.reason || entry.payload?.note;

            return (
              <li key={entry.id} className="fx-stack fx-stack--sm rounded-[--es-radius-md] border border-border-base bg-surface p-3">
                <div className="fx-row fx-row--between">
                  <p className={`fx-min0 text-sm ${tone}`}>{label}</p>
                  <p className="whitespace-nowrap text-xs text-subtle">
                    {new Intl.DateTimeFormat('en-US', {
                      dateStyle: 'medium', timeStyle: 'short',
                    }).format(new Date(entry.at))}
                  </p>
                </div>
                <p className="text-xs text-subtle">
                  {entry.actor?.name || entry.actor?.email || 'Unknown actor'}
                  {entry.target?.id && ` · ${entry.target.type} ${entry.target.id.slice(0, 8)}`}
                </p>
                {/* The reason IS the record. Without it every row reads "an
                    admin did it", which is the answer nobody accepts. */}
                {reason && <p className="fx-break text-sm text-muted">“{reason}”</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
