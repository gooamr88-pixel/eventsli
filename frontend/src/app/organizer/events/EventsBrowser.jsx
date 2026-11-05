'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useOrganizer } from '../../hooks/useOrganizer';
import { useOrganizerEvents } from '../nav/OrganizerEvents';
import { useUrlFilters } from '../../hooks/useUrlFilters';
import { useApi } from '../../hooks/useApi';
import { useNowMinute } from '../../hooks/useNowMinute';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import NavIcon from '../../components/shell/NavIcon';
import { StackedEmpty } from '../../components/ui/SplitEmpty';
import { TicketsArt } from '../../components/ui/Illustrations';
import MoreActions, { MoreItem } from '../../components/ui/MoreActions';
import CreateProfile from '../CreateProfile';
import OrganizerNotices from '../OrganizerNotices';
import { EventRow } from '../dashboard/YourEvents';
import EventCard from './EventCard';
import { whenOf, toCard } from './eventLook';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Every event, as cards (or rows), by WHEN — All, Upcoming, Ongoing, Past —
 * with Drafts as the fifth tab, since an unfinished event has no "when" yet.
 *
 * Status is still a filter (the funnel), and still in the URL as `?status=`,
 * so the dashboard's and the bell's links land on the same view they always
 * did: `?status=draft` opens the Drafts tab, `?status=past` the Past tab, and
 * anything else filters within All. "All" leaves archived events out —
 * putting an event away is how an organizer says they do not want to see it
 * here — and the funnel's Archived brings them back.
 *
 * The figures on each card (sold, capacity, revenue) are a second, separate
 * request: the list itself is the one the shell already loaded for the
 * switcher. Until the figures answer, or if they cannot, a card says "—".
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TABS = [
  { key: 'all', label: 'All Events', icon: 'calendarPlus' },
  { key: 'upcoming', label: 'Upcoming', icon: 'calendar' },
  { key: 'ongoing', label: 'Ongoing', icon: 'pulse' },
  { key: 'past', label: 'Past', icon: 'check' },
  { key: 'drafts', label: 'Drafts', icon: 'fileText' },
];

const STATUSES = [
  { value: '', label: 'Any status' },
  { value: 'published', label: 'On sale' },
  { value: 'pending_review', label: 'In review' },
  { value: 'rejected', label: 'Changes needed' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'archived', label: 'Archived' },
];

const SORTS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'title', label: 'Title A–Z' },
];

function inTab(event, tab, now) {
  if (tab === 'all') return true;
  if (tab === 'drafts') return event.status === 'draft';
  if (event.status === 'draft' || now === null) return false;
  return whenOf(event, now) === tab;
}

function sorted(list, by) {
  const out = [...list];
  if (by === 'title') return out.sort((a, b) => a.title.localeCompare(b.title));
  const dir = by === 'oldest' ? 1 : -1;
  return out.sort((a, b) => dir * (Date.parse(a.startsAt) - Date.parse(b.startsAt)));
}

export default function EventsBrowser() {
  const filters = useUrlFilters();
  const now = useNowMinute();
  const { loading: orgLoading, organizer, error: orgError, refresh } = useOrganizer();
  // The list the shell already loaded, not a second copy of it.
  const { events: data, error, loading, reload } = useOrganizerEvents();
  const figures = useApi('/organizer/event-figures');
  const [search, setSearch] = useState('');
  const [place, setPlace] = useState('');
  const [sort, setSort] = useState('newest');
  const [view, setView] = useState('grid');

  // `?status=draft` and `?status=past` are tabs now; the rest stay filters.
  const rawStatus = filters.get('status');
  const tab = filters.get('tab') || (rawStatus === 'draft' ? 'drafts' : rawStatus === 'past' ? 'past' : 'all');
  const status = STATUSES.some((s) => s.value === rawStatus) ? rawStatus : '';
  const setTab = (key) => filters.setMany({
    tab: key === 'all' ? '' : key,
    status: rawStatus === 'draft' || rawStatus === 'past' ? '' : rawStatus,
  });

  if (orgLoading) return <Loading variant="list" rows={4} label="Loading your events" />;
  if (orgError) return <ErrorNotice error={orgError} onRetry={refresh} />;
  if (!organizer) return <CreateProfile onCreated={refresh} />;

  const events = (Array.isArray(data) ? data : []).map((e) => toCard(e, figures.data));
  const visible = events.filter((e) => (status === 'archived' ? e.status === 'archived' : e.status !== 'archived'));
  const counts = Object.fromEntries(TABS.map((t) => [t.key, visible.filter((e) => inTab(e, t.key, now)).length]));
  const cities = [...new Set(events.map((e) => e.city).filter(Boolean))].sort();
  const needle = search.trim().toLowerCase();
  const rows = sorted(visible
    .filter((e) => inTab(e, tab, now))
    .filter((e) => !status || status === 'archived' || e.status === status)
    .filter((e) => !place || e.city === place)
    .filter((e) => !needle || [e.title, e.venue, e.city].some((v) => String(v || '').toLowerCase().includes(needle))), sort);
  const statusLabel = STATUSES.find((s) => s.value === status)?.label;

  return (
    <div className="fx-stack">
      {/* CREATE LIVES HERE, and on the dashboard, and nowhere else — the two
          places somebody looks at their events as a set. */}
      <header className="es-evhead">
        <span className="es-evhead__icon" aria-hidden="true"><NavIcon name="calendarPlus" size={34} /></span>
        <div className="fx-min0">
          <h1 className="es-evhead__title">Your Events</h1>
          <p className="es-evhead__lede">Create, manage, and track all your events in one place.</p>
        </div>
        <Link href="/organizer/events/new" className="es-btn es-btn--primary es-btn--lg es-dash-hero__create es-evhead__create">
          <NavIcon name="plus" size={20} />
          Create event
        </Link>
      </header>

      <OrganizerNotices organizer={organizer} />

      <div className="es-evtabbar" role="tablist" aria-label="Which events">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className="es-evtabbar__tab"
            onClick={() => setTab(t.key)}
          >
            <NavIcon name={t.icon} size={20} />
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      <div className="es-evtools">
        <div className="es-evtools__view" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
            <NavIcon name="grid" size={20} /><span className="sr-only">Cards</span>
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            <NavIcon name="list" size={20} /><span className="sr-only">List</span>
          </button>
        </div>
        <label className="es-evtools__search">
          <NavIcon name="search" size={18} />
          <span className="sr-only">Search your events</span>
          <input type="search" placeholder="Search your events…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <ToolSelect icon="pin" label="Location" value={place} onChange={setPlace}
          options={[{ value: '', label: 'All Locations' }, ...cities.map((c) => ({ value: c, label: c }))]} />
        <ToolSelect icon="sort" label="Sort" value={sort} onChange={setSort} options={SORTS} />
        <MoreActions
          align="end"
          srLabel={status ? `Status filter: ${statusLabel}` : 'Filter by status'}
          triggerClassName="es-evtools__filter"
          trigger={(
            <>
              <NavIcon name="filter" size={20} />
              {status && <span className="es-topbar__dot" aria-hidden="true" />}
            </>
          )}
        >
          {STATUSES.map((s) => (
            <MoreItem key={s.value || 'any'} icon={s.value === status ? 'tick' : undefined} onClick={() => filters.set('status', s.value)}>
              {s.label}
            </MoreItem>
          ))}
        </MoreActions>
      </div>

      {status && (
        <p className="es-evtools__chip">
          Showing: {statusLabel}
          <button type="button" onClick={() => filters.set('status', '')}>
            <NavIcon name="close" size={14} /><span className="sr-only">Clear the status filter</span>
          </button>
        </p>
      )}

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={4} label="Loading your events" />
      ) : events.length === 0 ? (
        /* The first screen a new organizer sees here: a picture and the one
           thing to do, not a sentence in a box. */
        <StackedEmpty
          art={<TicketsArt />}
          title="No events yet."
          action={(
            <Link href="/organizer/events/new" className="es-btn es-btn--primary es-btn--lg">
              <NavIcon name="plus" size={18} />
              Create your first event
            </Link>
          )}
        >
          Create one — it stays private until you submit it and Eventsli approves it.
        </StackedEmpty>
      ) : rows.length === 0 ? (
        status === 'archived' && !needle
          ? <Empty icon="archive" title="No archived events." hint="Archive an event from its page to stop its sales and file it here." />
          : <Empty title="Nothing matches." hint="Try another tab or filter, or clear the search." />
      ) : view === 'grid' ? (
        <ul className="es-evgrid" aria-label="Your events">
          {rows.map((e) => <EventCard key={e.id} event={e} now={now} />)}
        </ul>
      ) : (
        <section className="es-dcard" aria-label="Your events">
          <ul className="es-evrows">
            {rows.map((e) => <EventRow key={e.id} event={e} now={now} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function ToolSelect({ icon, label, value, onChange, options }) {
  const id = useId();
  return (
    <span className="es-evtools__select">
      <NavIcon name={icon} size={18} />
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <NavIcon name="chevronDown" size={16} />
    </span>
  );
}
