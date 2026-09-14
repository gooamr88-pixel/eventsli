'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '../../hooks/useApi';
import { formatMoney } from '../../utils/money';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import { PageHeader } from '../../components/ui/Page';
import { Segmented, SearchBox, Pagination } from '../../components/ui/Filters';
import DataTable from '../../components/ui/DataTable';
import StatusPill from '../../organizer/StatusPill';

/**
 * Every event on the platform (BRD §19). Filters live in the URL, so the
 * overview's "3 suspended" and an organizer's "view their events" link straight
 * into a filtered view, and the back button returns to it.
 */
const STATUSES = [
  { value: '', label: 'All' },
  { value: 'pending_review', label: 'In review' },
  { value: 'published', label: 'On sale' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'rejected', label: 'Changes needed' },
  { value: 'draft', label: 'Drafts' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'completed', label: 'Finished' },
];

const WHEN = [
  { value: '', label: 'Any date' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
];

export default function AdminEvents() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const status = params.get('status') || '';
  const when = params.get('when') || '';
  const q = params.get('q') || '';
  const organizerId = params.get('organizerId') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const query = new URLSearchParams({ limit: '25', page: String(page), sort: 'starts_at' });
  if (status) query.set('status', status);
  if (when) query.set('when', when);
  if (q) query.set('q', q);
  if (organizerId) query.set('organizerId', organizerId);

  const { data, error, loading } = useApi(`/admin/events?${query}`, { raw: true });

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    // toString(), not `.size`, which Safari before 17 does not have.
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
  };

  const rows = data?.data || [];

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Administration"
        title="All events"
        lede="Every event, in every state. Open one to review it, change its settings, suspend or cancel it."
      />

      <div className="fx-stack fx-stack--sm">
        <Segmented label="Status" value={status} onChange={(v) => setParam('status', v)} options={STATUSES} />
        <div className="fx-row">
          <Segmented label="Date" value={when} onChange={(v) => setParam('when', v)} options={WHEN} />
          <SearchBox label="Search events" placeholder="Event title" value={q} onSearch={(v) => setParam('q', v)} />
        </div>
        {organizerId && (
          <p className="text-sm text-muted">
            Showing one organizer&apos;s events.{' '}
            <button type="button" className="text-accent" onClick={() => setParam('organizerId', '')}>
              Show everyone&apos;s
            </button>
          </p>
        )}
      </div>

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={5} label="Loading events" />
      ) : rows.length === 0 ? (
        <Empty title="No events match." hint="Try another status or date, or clear the search." />
      ) : (
        <>
          <DataTable
            caption="Events"
            rows={rows}
            columns={[
              {
                key: 'event',
                label: 'Event',
                primary: true,
                render: (e) => (
                  <Link href={`/admin/events/${e.id}`} className="fx-stack fx-stack--sm gap-0.5 hover:text-accent">
                    <span className="fx-break font-medium text-ink">{e.title}</span>
                    <span className="text-sm text-muted">
                      {e.organizer?.name}
                      {e.organizer?.isBanned && ' · organizer banned'}
                    </span>
                  </Link>
                ),
              },
              {
                key: 'when',
                label: 'When',
                render: (e) => (
                  <span className="whitespace-nowrap">
                    {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: e.timezone || 'UTC' })
                      .format(new Date(e.startsAt))}
                  </span>
                ),
              },
              { key: 'status', label: 'Status', render: (e) => <StatusPill status={e.status} /> },
              {
                key: 'sold',
                label: 'Sold',
                align: 'end',
                render: (e) => (
                  <span className="es-nums whitespace-nowrap">
                    {e.sales.tickets} · {formatMoney(e.sales.grossCents, e.currency)}
                  </span>
                ),
              },
              {
                key: 'open',
                label: 'Open',
                hideLabel: true,
                align: 'end',
                render: (e) => (
                  <Link href={`/admin/events/${e.id}`} className="text-sm text-accent hover:text-accent-hover">
                    {e.status === 'pending_review' ? 'Review' : 'Manage'}
                  </Link>
                ),
              },
            ]}
          />
          <Pagination pagination={data.pagination} onPage={(n) => setParam('page', String(n))} />
        </>
      )}
    </div>
  );
}
