'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../hooks/useApi';
import { formatEventTime } from '../../lib/eventTime';
import { PageHeader } from '../../components/ui/Page';
import { Pagination } from '../../components/ui/Filters';
import DataTable from '../../components/ui/DataTable';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import AuditDetail, { VERB_GROUPS, verbOf } from './AuditDetail';

/**
 * Every administrative act, with its actor, its reason and what it changed.
 *
 * "An admin did it" is not an answer when the organizer telephones — which is
 * why the API writes the reason and the before/after into `admin_audit`, and
 * why this page shows them (AuditDetail) rather than only the verb.
 *
 * Read-only, and there is no delete. A log an administrator can edit is not a
 * log.
 *
 * The filter lists every verb the backend writes. It used to offer six, with
 * no way to find approvals, rejections, bans, fee or settings changes.
 */

export default function Audit() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ limit: '50', page: String(page) });
  if (action) query.set('action', action);
  const { data, error, loading, reload } = useApi(`/admin/audit?${query}`, { raw: true });
  const rows = data?.data || [];

  return (
    <div className="fx-stack">
      <PageHeader eyebrow="Governance" icon="pulse" title="Audit log" lede="Who did what, why, and what it changed. Nothing here can be edited or removed." />

      <div className="fx-stack fx-stack--sm gap-1.5 max-w-sm">
        <label htmlFor="audit-action" className="text-sm text-ink">Kind of action</label>
        <select
          id="audit-action"
          className="es-input"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
        >
          <option value="">Everything</option>
          {VERB_GROUPS.map(([group, verbs]) => (
            <optgroup key={group} label={group}>
              {Object.entries(verbs).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={6} label="Loading the audit log" />
      ) : rows.length === 0 ? (
        <Empty icon="pulse" title="Nothing recorded." hint={action ? 'Nothing of this kind yet — try Everything.' : 'Administrative actions appear here as they happen.'} />
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
                  const [label, tone] = verbOf(entry.action);
                  return <span className={`es-pill ${tone}`}>{label}</span>;
                },
              },
              { key: 'detail', label: 'Details', wide: true, render: (entry) => <AuditDetail entry={entry} /> },
              {
                key: 'actor',
                label: 'By',
                // break-words, not .fx-break: "anywhere" let the table squeeze this
                // column to a few letters, so a name wrapped as "goo / amr / 88".
                render: (entry) => <span className="block min-w-32 break-words">{entry.actor?.name || entry.actor?.email || 'Unknown actor'}</span>,
              },
              { key: 'target', label: 'On', render: (entry) => <Target target={entry.target} /> },
              {
                key: 'at',
                label: 'When',
                wide: true,
                // The viewer's own clock, labelled: the log is not about one event.
                render: (entry) => <span className="whitespace-nowrap text-sm text-muted">{formatEventTime(entry.at)}</span>,
              },
            ]}
          />
          <Pagination pagination={data.pagination} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/** Events, organizers and invoices link to where they can be acted on; others show type and a short id. */
function Target({ target }) {
  if (!target?.id) return <span className="text-subtle">{target?.type === 'platform_settings' ? 'Platform settings' : '—'}</span>;
  const short = `${target.type} ${target.id.slice(0, 8)}`;
  const href = {
    event: `/admin/events/${target.id}`,
    organizer: `/admin/events?organizerId=${target.id}`,
    invoice: '/admin/invoices',
  }[target.type];
  if (href) return <Link href={href} className="font-mono text-sm text-accent">{short}</Link>;
  return <span className="font-mono text-sm text-muted">{short}</span>;
}
