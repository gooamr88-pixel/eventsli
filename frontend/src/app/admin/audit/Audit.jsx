'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../hooks/useApi';
import { PageHeader } from '../../components/ui/Page';
import { Segmented, Pagination } from '../../components/ui/Filters';
import DataTable from '../../components/ui/DataTable';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';

/**
 * Every administrative act, with its actor and its reason.
 *
 * "An admin did it" is not an answer when the organizer telephones — which is
 * why the API writes the reason into `admin_audit` alongside the action, and why
 * this page shows the payload rather than only the verb.
 *
 * Read-only, and there is no delete. A log an administrator can edit is not a
 * log.
 *
 * The verbs are the ones the backend actually writes (grep `audit(req, '…')`).
 * `scanner.override` was listed here as `event.scanner_override`, and
 * `event.cancelled` (Rule 17) was missing, so both rendered as raw keys.
 */
const VERBS = {
  'event.approved': ['Approved an event', 'es-pill--accent'],
  'event.rejected': ['Sent an event back', 'es-pill--warning'],
  'event.suspended': ['Suspended an event', 'es-pill--danger'],
  'event.unsuspended': ['Restored an event', 'es-pill--accent'],
  'event.cancelled': ['Cancelled an event', 'es-pill--danger'],
  'event.fees_changed': ['Changed event fees', ''],
  'scanner.override': ['Overrode a locked gate', 'es-pill--warning'],
  'user.blocked': ['Blocked an account', 'es-pill--danger'],
  'user.unblocked': ['Unblocked an account', 'es-pill--accent'],
  'user.role_changed': ['Changed a role', ''],
  'organizer.banned': ['Banned an organizer', 'es-pill--danger'],
  'organizer.unbanned': ['Unbanned an organizer', 'es-pill--accent'],
  'invoice.settled': ['Settled an invoice', 'es-pill--accent'],
  'invoice.raised': ['Raised an invoice', ''],
  'settings.changed': ['Changed a platform setting', ''],
};

const FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'event.cancelled', label: 'Cancellations' },
  { value: 'event.suspended', label: 'Suspensions' },
  { value: 'user.blocked', label: 'Blocks' },
  { value: 'user.role_changed', label: 'Roles' },
  { value: 'invoice.settled', label: 'Settlements' },
  { value: 'scanner.override', label: 'Gate overrides' },
];

export default function Audit() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ limit: '50', page: String(page) });
  if (action) query.set('action', action);
  const { data, error, loading } = useApi(`/admin/audit?${query}`, { raw: true });
  const rows = data?.data || [];

  return (
    <div className="fx-stack">
      <PageHeader eyebrow="Console" title="Audit" lede="Who did what, and why. Nothing here can be edited or removed." />

      <Segmented label="Kind of action" value={action} onChange={(v) => { setAction(v); setPage(1); }} options={FILTERS} />

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={6} label="Loading the audit log" />
      ) : rows.length === 0 ? (
        <Empty title="Nothing recorded." hint={action ? 'Nothing of this kind yet — try Everything.' : 'Administrative actions appear here as they happen.'} />
      ) : (
        <>
          <DataTable
            caption="Audit log"
            rows={rows}
            columns={[
              {
                key: 'action',
                label: 'Action',
                primary: true,
                render: (entry) => {
                  const [label, tone] = VERBS[entry.action] || [entry.action, ''];
                  return <span className={`es-pill ${tone}`}>{label}</span>;
                },
              },
              {
                key: 'reason',
                label: 'Reason',
                // The reason IS the record. Without it every row reads "an admin did it".
                render: (entry) => {
                  const reason = entry.payload?.reason || entry.payload?.note;
                  return reason
                    ? <span className="fx-break text-ink">“{reason}”</span>
                    : <span className="text-subtle">No reason recorded</span>;
                },
              },
              { key: 'actor', label: 'By', render: (entry) => <span className="fx-break">{entry.actor?.name || entry.actor?.email || 'Unknown actor'}</span> },
              { key: 'target', label: 'On', render: (entry) => <Target target={entry.target} /> },
              {
                key: 'at',
                label: 'When',
                render: (entry) => (
                  <span className="whitespace-nowrap text-sm text-muted">
                    {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.at))}
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

/** Events link to their console page; other targets show their type and a short id. */
function Target({ target }) {
  if (!target?.id) return <span className="text-subtle">—</span>;
  const short = `${target.type} ${target.id.slice(0, 8)}`;
  if (target.type === 'event') {
    return <Link href={`/admin/events/${target.id}`} className="font-mono text-sm text-accent">{short}</Link>;
  }
  return <span className="font-mono text-sm text-muted">{short}</span>;
}
