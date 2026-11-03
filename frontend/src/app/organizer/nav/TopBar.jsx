'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import NavIcon from '../../components/shell/NavIcon';
import MoreActions, { MoreItem } from '../../components/ui/MoreActions';
import LogoutButton from '../../components/auth/LogoutConfirm';
import { initials } from '../../components/shell/ShellFoot';
import { useOrganizer } from '../../hooks/useOrganizer';

/**
 * The organizer's desktop top bar: search, what needs them, help, and who is
 * signed in. Desktop only (`.es-topbar` is hidden below `lg`, where the app
 * bar and the drawer already carry all of this).
 *
 * SEARCH IS OVER YOUR OWN EVENTS, and says so. The layout has already loaded
 * the list for the switcher, so matching is instant and costs no request;
 * there is no cross-event attendee or ticket search to put behind a box that
 * claimed one.
 *
 * THE BELL LISTS REAL THINGS: a missing payment method, events sent back for
 * changes, events waiting on Eventsli. The dot is only for the first two —
 * the ones that are the organizer's move.
 */
export default function TopBar({ events, user }) {
  return (
    <div className="es-topbar">
      <EventSearch events={events} />
      <div className="es-topbar__tools">
        <Alerts events={events} />
        <MoreActions
          align="end"
          srLabel="Help"
          triggerClassName="es-topbar__icon"
          trigger={<NavIcon name="help" size={22} />}
        >
          <MoreItem href="/how-it-works" icon="info">How Eventsli works</MoreItem>
          <MoreItem href="/contact" icon="mail">Contact support</MoreItem>
        </MoreActions>
        {user && <AccountMenu user={user} />}
      </div>
    </div>
  );
}

function EventSearch({ events }) {
  const router = useRouter();
  const inputRef = useRef(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // Ctrl K / ⌘K from anywhere on the page.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const needle = query.trim().toLowerCase();
  const results = needle
    ? (events || []).filter((e) => [e.title, e.city, e.venue?.name].some((v) => String(v || '').toLowerCase().includes(needle))).slice(0, 6)
    : [];
  const showList = open && needle.length > 0;

  function go(event) {
    setOpen(false);
    setQuery('');
    router.push(`/organizer/events/${event.id}`);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length); }
    if (e.key === 'Enter') { e.preventDefault(); go(results[Math.min(active, results.length - 1)]); }
  }

  return (
    <div className="es-topsearch" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <NavIcon name="search" size={20} />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Search your events"
        placeholder="Search your events…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <kbd className="es-topsearch__kbd" aria-hidden="true">Ctrl K</kbd>
      {showList && (
        <ul id={listId} role="listbox" className="es-topsearch__list">
          {results.length === 0 ? (
            <li className="es-topsearch__none">No event matches “{query.trim()}”.</li>
          ) : results.map((event, i) => (
            <li key={event.id} role="option" aria-selected={i === active}>
              <Link
                href={`/organizer/events/${event.id}`}
                className="es-topsearch__hit"
                onClick={() => { setOpen(false); setQuery(''); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="fx-truncate">{event.title}</span>
                {(event.city || event.venue?.name) && (
                  <span className="es-topsearch__meta fx-truncate">{event.city || event.venue?.name}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Alerts({ events }) {
  const { organizer } = useOrganizer();
  const list = events || [];
  const items = [];

  if (organizer && (organizer.payments?.choices?.length ?? 0) === 0) {
    items.push({ key: 'pay', href: '/organizer/payments', icon: 'card', text: 'Add a payment method so ticketed events can go on sale.', act: true });
  }
  for (const e of list.filter((x) => x.status === 'rejected').slice(0, 3)) {
    items.push({ key: `r-${e.id}`, href: `/organizer/events/${e.id}`, icon: 'alert', text: `${e.title} needs changes before review.`, act: true });
  }
  const inReview = list.filter((x) => x.status === 'pending_review').length;
  if (inReview > 0) {
    items.push({ key: 'review', href: '/organizer/events?status=pending_review', icon: 'clock', text: `${inReview} ${inReview === 1 ? 'event is' : 'events are'} with Eventsli for review.` });
  }
  const toDo = items.filter((i) => i.act).length;

  return (
    <MoreActions
      align="end"
      srLabel={toDo ? `Notifications, ${toDo} to do` : 'Notifications'}
      triggerClassName="es-topbar__icon"
      trigger={(
        <>
          <NavIcon name="bell" size={22} />
          {toDo > 0 && <span className="es-topbar__dot" aria-hidden="true" />}
        </>
      )}
    >
      {items.length === 0 ? (
        <p className="es-topbar__empty">You are all caught up.</p>
      ) : items.map((item) => (
        <MoreItem key={item.key} href={item.href} icon={item.icon} tone={item.act ? 'warning' : undefined}>{item.text}</MoreItem>
      ))}
    </MoreActions>
  );
}

function AccountMenu({ user }) {
  return (
    <MoreActions
      align="end"
      srLabel="Account menu"
      triggerClassName="es-topbar__account"
      trigger={(
        <>
          <span className="es-avatar es-avatar--lg" aria-hidden="true">{initials(user)}</span>
          <span className="es-topbar__who">
            <span className="es-topbar__name fx-truncate">{user.fullName || user.email}</span>
            <span className="es-topbar__role">Organizer</span>
          </span>
          <NavIcon name="chevronDown" size={18} />
        </>
      )}
    >
      <MoreItem href="/organizer/profile" icon="user">Organization profile</MoreItem>
      <MoreItem href="/organizer/payments" icon="card">Payment methods</MoreItem>
      <MoreItem href="/organizer/payouts" icon="bank">Payouts</MoreItem>
      <MoreItem href="/" icon="globe">View the site</MoreItem>
      <LogoutButton className="es-more__item" next="/">
        <span aria-hidden className="es-more__icon"><NavIcon name="exit" size={16} /></span>
        <span className="fx-min0">Sign out</span>
      </LogoutButton>
    </MoreActions>
  );
}
