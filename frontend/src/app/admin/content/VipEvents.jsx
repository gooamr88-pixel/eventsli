'use client';

import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { get, put } from '../../utils/apiClient';
import { messageFor } from '../../utils/errors';
import { useToast } from '../../components/ui/Toast';
import { Loading, ErrorNotice } from '../../components/Feedback';
import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The homepage hero's slider: which events, in which order (2026-11-15).
 *
 * The list is edited here and SAVED WHOLE — one PUT with the ids in order
 * (vipEventsService.save). Nothing is written while the admin rearranges, so
 * moving three rows is one change on the homepage, not three.
 *
 * Only published, upcoming events can be added: the search reads the same
 * public listing a buyer sees, so anything it offers can be opened. A ranked
 * event that later lapses (unpublished, finished) stays in this list with the
 * reason beside it, and the homepage skips it on its own.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VipEvents({ canEdit }) {
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/admin/storefront/vip-events');
  const max = data?.max ?? 12;

  // The working list. Reset from the server whenever a new answer arrives —
  // during render, not in an effect, so the stale list never paints.
  const [loaded, setLoaded] = useState(null);
  const [list, setList] = useState([]);
  if (data && data !== loaded) {
    setLoaded(data);
    setList(data.events || []);
  }
  const savedIds = (loaded?.events || []).map((e) => e.id).join(',');
  const dirty = list.map((e) => e.id).join(',') !== savedIds;
  const [busy, setBusy] = useState(false);

  const move = (index, by) => setList((rows) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    return next;
  });
  const remove = (id) => setList((rows) => rows.filter((r) => r.id !== id));
  const add = (event) => setList((rows) => (rows.some((r) => r.id === event.id) || rows.length >= max
    ? rows
    : [...rows, { ...event, hidden: null }]));

  async function save() {
    setBusy(true);
    try {
      await put('/admin/storefront/vip-events', { eventIds: list.map((e) => e.id) });
      toast.success('The homepage slider is updated.');
      reload();
    } catch (err) {
      toast.error(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Loading label="Loading the slider" />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;

  return (
    <div className="fx-stack">
      <section className="es-card es-panel">
        <div className="es-panel-head">
          <div>
            <h2 className="es-panel-head__title">VIP events slider</h2>
            <p className="text-sm text-muted">
              The events that slide through the top of the homepage, in this order. Up to {max}.
              With none chosen, the slider shows the soonest upcoming events instead, without the VIP badge.
            </p>
          </div>
          {canEdit && (
            <div className="fx-row items-center gap-2">
              {dirty && (
                <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy}
                  onClick={() => setList(loaded?.events || [])}>
                  Undo changes
                </button>
              )}
              <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={busy || !dirty} onClick={save}>
                {busy ? 'Saving…' : 'Save slider'}
              </button>
            </div>
          )}
        </div>

        {list.length === 0 ? (
          <div className="es-empty">
            <p className="text-muted">No VIP events yet.</p>
            <p className="mt-1 text-sm text-subtle">Search below and add the events you want on the homepage.</p>
          </div>
        ) : (
          <ol className="fx-stack fx-stack--sm">
            {list.map((event, index) => (
              <li key={event.id} className="es-vipadmin__row">
                <span className="es-vipadmin__pos" aria-hidden>{index + 1}</span>
                <Thumb src={event.coverUrl} />
                <div className="fx-min0 flex-1">
                  <p className="fx-truncate font-medium text-ink">{event.title}</p>
                  <p className="fx-truncate text-sm text-muted">{describe(event)}</p>
                </div>
                {event.isPrivate && <span className="es-pill">Private · shown locked</span>}
                {event.hidden && <span className="es-pill">{event.hidden} — not shown</span>}
                {canEdit && (
                  <div className="fx-row items-center gap-1">
                    <button type="button" className="es-btn es-btn--ghost fx-touch--icon" disabled={busy || index === 0}
                      onClick={() => move(index, -1)} aria-label={`Move ${event.title} up`}>
                      <NavIcon name="chevronUp" size={16} />
                    </button>
                    <button type="button" className="es-btn es-btn--ghost fx-touch--icon" disabled={busy || index === list.length - 1}
                      onClick={() => move(index, 1)} aria-label={`Move ${event.title} down`}>
                      <NavIcon name="chevronDown" size={16} />
                    </button>
                    <button type="button" className="es-btn es-btn--ghost fx-touch--icon" disabled={busy}
                      onClick={() => remove(event.id)} aria-label={`Remove ${event.title} from the slider`}>
                      <span aria-hidden><NavIcon name="trash" size={16} /></span>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {canEdit && (
        <Finder chosen={list} full={list.length >= max} onAdd={add} disabled={busy} />
      )}
    </div>
  );
}

/**
 * Search the published events that are not over — PRIVATE ONES INCLUDED
 * (owner, 2026-11-24). It searched the public listing, which never returns a
 * private event for a search, so one could not be chosen. The admin list has
 * every event; the slider shows a private one as its locked card.
 */
function Finder({ chosen, full, onAdd, disabled }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState({ rows: null, failed: false });

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const term = q.trim();
          const rows = await get(`/admin/events?status=published&when=current&sort=starts_at&order=asc&limit=12${term ? `&q=${encodeURIComponent(term)}` : ''}`, { noRedirect: true });
          if (!cancelled) setState({ rows: Array.isArray(rows) ? rows : [], failed: false });
        } catch {
          if (!cancelled) setState({ rows: [], failed: true });
        }
      })();
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q]);

  const taken = new Set(chosen.map((e) => e.id));

  return (
    <section className="es-card es-panel">
      <div className="es-panel-head">
        <h2 className="es-panel-head__title">Add events</h2>
      </div>
      <label className="fx-stack fx-stack--sm">
        <span className="text-sm font-medium text-ink">Search published, upcoming events</span>
        <input
          type="search"
          className="es-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Event name, artist or venue"
          maxLength={100}
        />
      </label>
      {full && <p className="mt-3 text-sm text-muted">The slider is full. Remove an event to add another.</p>}

      {state.rows === null ? (
        <p className="mt-4 text-sm text-subtle">Searching…</p>
      ) : state.rows.length === 0 ? (
        <p className="mt-4 text-sm text-subtle">
          {state.failed ? 'We could not search just now. Try again in a moment.' : 'No published upcoming events match.'}
        </p>
      ) : (
        <ul className="mt-4 fx-stack fx-stack--sm">
          {state.rows.map((event) => {
            const isIn = taken.has(event.id);
            return (
              <li key={event.id} className="es-vipadmin__row">
                <Thumb src={event.coverUrl} />
                <div className="fx-min0 flex-1">
                  <p className="fx-truncate font-medium text-ink">{event.title}</p>
                  <p className="fx-truncate text-sm text-muted">{describe(event)}</p>
                </div>
                <button
                  type="button"
                  className={`es-btn es-btn--sm ${isIn ? 'es-btn--ghost' : 'es-btn--secondary'}`}
                  disabled={disabled || isIn || full}
                  onClick={() => onAdd(event)}
                >
                  {isIn ? 'On the slider' : (<><NavIcon name="plus" size={16} />Add</>)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Thumb({ src }) {
  return src
    // eslint-disable-next-line @next/next/no-img-element -- a 64px admin thumbnail straight from storage
    ? <img src={src} alt="" className="es-vipadmin__thumb" loading="lazy" decoding="async" />
    : <span className="es-vipadmin__thumb es-vipadmin__thumb--empty" aria-hidden><NavIcon name="image" size={18} /></span>;
}

/** "Fri, Dec 5 · Pechanga Arena, San Diego", in the event's own timezone. */
function describe(event) {
  let when = '';
  try {
    when = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: event.timezone || undefined,
    }).format(new Date(event.startsAt));
  } catch { /* an unknown zone: leave the date out rather than crash the list */ }
  const where = [event.venue, event.city].filter(Boolean).join(', ');
  return [when, where].filter(Boolean).join(' · ');
}
