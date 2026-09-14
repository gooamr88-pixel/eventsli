'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '../../hooks/useApi';
import { useOrganizer } from '../../hooks/useOrganizer';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import { PageHeader } from '../../components/ui/Page';
import { Segmented, SearchBox } from '../../components/ui/Filters';
import DataTable from '../../components/ui/DataTable';
import StatusPill from '../StatusPill';
import CreateProfile from '../CreateProfile';
import OrganizerNotices from '../OrganizerNotices';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Every event, filterable by where it stands.
 *
 * Drafts are a FILTER here, not a separate destination — fancy's reasoning, and
 * a good one: two places for one concept is where an unfinished event hides
 * from its own owner.
 *
 * The filter is in the URL, so "3 drafts are not submitted" on the dashboard
 * links straight to them and the back button returns to the same view.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const FILTERS = [
  { value: 'all', label: 'All', statuses: null },
  { value: 'published', label: 'On sale', statuses: ['published'] },
  { value: 'draft', label: 'Drafts', statuses: ['draft'] },
  { value: 'pending_review', label: 'In review', statuses: ['pending_review'] },
  { value: 'rejected', label: 'Changes needed', statuses: ['rejected'] },
  { value: 'suspended', label: 'Suspended', statuses: ['suspended'] },
  { value: 'past', label: 'Past', statuses: ['completed', 'cancelled'] },
];

export default function EventsBrowser() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { loading: orgLoading, organizer, error: orgError, refresh } = useOrganizer();
  const { data, error, loading } = useApi(organizer ? '/events?limit=200&sort=starts_at&order=desc' : null);
  const [search, setSearch] = useState('');

  const filter = FILTERS.find((f) => f.value === params.get('status')) || FILTERS[0];

  if (orgLoading) return <Loading variant="list" rows={4} label="Loading your events" />;
  if (orgError) return <ErrorNotice error={orgError} />;
  if (!organizer) return <CreateProfile onCreated={refresh} />;

  const events = Array.isArray(data) ? data : [];
  const counts = Object.fromEntries(FILTERS.map((f) => [
    f.value, f.statuses ? events.filter((e) => f.statuses.includes(e.status)).length : events.length,
  ]));
  const needle = search.toLowerCase();
  const rows = events
    .filter((e) => !filter.statuses || filter.statuses.includes(e.status))
    .filter((e) => !needle || e.title.toLowerCase().includes(needle) || (e.venue?.name || '').toLowerCase().includes(needle));

  const setFilter = (value) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('status'); else next.set('status', value);
    // toString(), not `.size` — Safari before 17 has no `size`, reads it as
    // undefined, and the filter would silently fall off the URL.
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
  };

  return (
    <div className="fx-stack">
      <PageHeader
        title="Your events"
        lede="An event stays a draft until you submit it, so nothing goes on sale by accident."
        actions={<Link href="/organizer/events/new" className="es-btn es-btn--primary">Create event</Link>}
      />

      <OrganizerNotices organizer={organizer} />

      <div className="fx-stack fx-stack--sm">
        <Segmented
          label="Status"
          value={filter.value}
          onChange={setFilter}
          options={FILTERS
            .filter((f) => f.value === 'all' || counts[f.value] > 0 || f.value === filter.value)
            .map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))}
        />
        <SearchBox label="Search your events" placeholder="Title or venue" value={search} onSearch={setSearch} />
      </div>

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={4} label="Loading your events" />
      ) : events.length === 0 ? (
        <Empty
          title="No events yet."
          hint="Create one — it stays private until you submit it and Eventsli approves it."
          action={{ href: '/organizer/events/new', label: 'Create your first event' }}
        />
      ) : rows.length === 0 ? (
        <Empty title="Nothing matches." hint="Try another filter, or clear the search." />
      ) : (
        <DataTable
          caption="Your events"
          rows={rows}
          columns={[
            {
              key: 'event',
              label: 'Event',
              primary: true,
              render: (e) => (
                <Link href={`/organizer/events/${e.id}`} className="fx-stack fx-stack--sm gap-0.5 hover:text-accent">
                  <span className="fx-break font-medium text-ink">{e.title}</span>
                  {e.venue?.name && <span className="text-sm text-muted">{e.venue.name}</span>}
                </Link>
              ),
            },
            {
              key: 'when',
              label: 'When',
              render: (e) => (
                <span className="whitespace-nowrap">
                  {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: e.timezone })
                    .format(new Date(e.startsAt))}
                </span>
              ),
            },
            { key: 'status', label: 'Status', render: (e) => <StatusPill status={e.status} /> },
            {
              key: 'actions',
              label: 'Actions',
              hideLabel: true,
              align: 'end',
              render: (e) => (
                <span className="fx-row justify-end">
                  <Link href={`/organizer/events/${e.id}/orders`} className="text-sm text-muted hover:text-ink">Orders</Link>
                  <Link href={`/organizer/events/${e.id}`} className="text-sm text-accent hover:text-accent-hover">Manage</Link>
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
