'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../hooks/useApi';
import { useOrganizer } from '../../hooks/useOrganizer';
import { useUrlFilters } from '../../hooks/useUrlFilters';
import { formatEventTime } from '../../lib/eventTime';
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
// "All" leaves archived events out — putting an event away is how an organizer
// says they do not want to see it here. They have their own tab.
const ACTIVE = ['draft', 'pending_review', 'rejected', 'published', 'suspended', 'completed', 'cancelled'];

const FILTERS = [
  { value: 'all', label: 'All', statuses: ACTIVE },
  { value: 'published', label: 'On sale', statuses: ['published'] },
  { value: 'draft', label: 'Drafts', statuses: ['draft'] },
  { value: 'pending_review', label: 'In review', statuses: ['pending_review'] },
  { value: 'rejected', label: 'Changes needed', statuses: ['rejected'] },
  { value: 'suspended', label: 'Suspended', statuses: ['suspended'] },
  { value: 'past', label: 'Past', statuses: ['completed', 'cancelled'] },
  { value: 'archived', label: 'Archived', statuses: ['archived'] },
];

export default function EventsBrowser() {
  const filters = useUrlFilters();
  const { loading: orgLoading, organizer, error: orgError, refresh } = useOrganizer();
  const { data, error, loading } = useApi(organizer ? '/events?limit=200&sort=starts_at&order=desc' : null);
  const [search, setSearch] = useState('');

  const filter = FILTERS.find((f) => f.value === filters.get('status')) || FILTERS[0];

  if (orgLoading) return <Loading variant="list" rows={4} label="Loading your events" />;
  if (orgError) return <ErrorNotice error={orgError} />;
  if (!organizer) return <CreateProfile onCreated={refresh} />;

  const events = Array.isArray(data) ? data : [];
  const counts = Object.fromEntries(FILTERS.map((f) => [
    f.value, events.filter((e) => f.statuses.includes(e.status)).length,
  ]));
  const needle = search.toLowerCase();
  const rows = events
    .filter((e) => filter.statuses.includes(e.status))
    .filter((e) => !needle || e.title.toLowerCase().includes(needle) || (e.venue?.name || '').toLowerCase().includes(needle));

  return (
    <div className="fx-stack">
      <PageHeader
        title="Your events"
        lede="An event stays a draft until you submit it, so nothing goes on sale by accident."
        // From lg the sidebar's Create event sits beside this; one is enough.
        actions={<Link href="/organizer/events/new" className="es-btn es-btn--primary lg:hidden">Create event</Link>}
      />

      <OrganizerNotices organizer={organizer} />

      <div className="fx-stack fx-stack--sm">
        <Segmented
          label="Status"
          value={filter.value}
          onChange={(value) => filters.set('status', value === 'all' ? '' : value)}
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
        filter.value === 'archived' && !needle
          ? <Empty title="No archived events." hint="Archive an event from its page to stop its sales and file it here." />
          : <Empty title="Nothing matches." hint="Try another filter, or clear the search." />
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
                  <span className="text-sm text-muted">
                    {e.listingType === 'display_only' ? 'Display only' : 'Ticketed'}
                    {e.venue?.name && ` · ${e.venue.name}`}
                  </span>
                </Link>
              ),
            },
            {
              key: 'when',
              label: 'When',
              render: (e) => <span className="whitespace-nowrap">{formatEventTime(e.startsAt, e.timezone, { time: false })}</span>,
            },
            { key: 'status', label: 'Status', render: (e) => <StatusPill status={e.status} /> },
            {
              key: 'actions',
              label: 'Actions',
              hideLabel: true,
              align: 'end',
              render: (e) => (
                <span className="fx-row justify-end">
                  {e.listingType !== 'display_only' && e.status !== 'archived' && (
                    <Link href={`/organizer/events/${e.id}/orders`} className="es-btn es-btn--ghost es-btn--sm">Orders</Link>
                  )}
                  <Link href={`/organizer/events/${e.id}`} className="es-btn es-btn--secondary es-btn--sm">Manage</Link>
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
