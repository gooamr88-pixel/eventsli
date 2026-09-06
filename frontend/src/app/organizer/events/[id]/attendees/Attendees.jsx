'use client';

import { useEffect, useState } from 'react';
import { get } from '../../../../utils/apiClient';
import { Loading, ErrorNotice } from '../../../../components/Feedback';

/**
 * The door list.
 *
 * NO QR CODES, and that is the API's decision rather than an omission. This
 * list is paginated, screenshot-able, and read by anyone the organizer shares a
 * screen with — so the credential that admits someone does not belong in it.
 * Scanning has its own device authentication, and the gate app is where codes
 * are read.
 *
 * The counters come from the API over the whole event, not from the rows on
 * screen: "142 of 300 admitted" has to be true regardless of which page is open.
 */
const CHECKED = [['', 'Everyone'], ['true', 'Admitted'], ['false', 'Not yet']];

export default function Attendees({ eventId }) {
  const [checkedIn, setCheckedIn] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');

  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const query = new URLSearchParams({ limit: '100' });
      if (checkedIn) query.set('checkedIn', checkedIn);
      if (search) query.set('q', search);

      try {
        const result = await get(`/events/${eventId}/attendees?${query}`, {
          cache: 'no-store', raw: true,
        });
        if (!cancelled) {
          setRows(result.data || []);
          setMeta(result.meta || null);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, checkedIn, search]);

  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--between">
        <h2 className="text-xl">Door list</h2>
        {meta && (
          <p className="es-nums text-sm text-muted">
            <span className="text-ink">{meta.admitted}</span> of {meta.valid} admitted
          </p>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} className="fx-row">
        <div className="fx-row fx-row--scroll" role="group" aria-label="Filter">
          {CHECKED.map(([v, l]) => (
            <button
              key={v || 'all'}
              type="button"
              onClick={() => setCheckedIn(v)}
              aria-pressed={checkedIn === v}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors ${
                checkedIn === v ? 'border-accent bg-accent text-on-accent' : 'border-border-strong text-muted hover:text-ink'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or email"
          aria-label="Search the door list"
          className="fx-min0 flex-1 es-input"
        />
        <button type="submit" className="rounded-[--es-radius-md] border border-border-strong px-3 py-2 text-sm text-ink">
          Search
        </button>
      </form>

      {error ? (
        <ErrorNotice error={error} />
      ) : !rows ? (
        <Loading variant="list" />
      ) : rows.length === 0 ? (
        <div className="es-empty">
          <p className="text-muted">Nobody matches.</p>
        </div>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {rows.map((a) => (
            <li
              key={a.ticketId}
              className="fx-row fx-row--between rounded-[--es-radius-md] border border-border-base bg-surface p-3"
            >
              <div className="fx-min0">
                <p className="fx-truncate text-sm text-ink">{a.name || 'Unnamed'}</p>
                <p className="fx-truncate text-xs text-subtle">
                  {a.email || 'no email'}
                  {a.seat && ` · ${a.seat}`}
                  {a.channel === 'manual' && ' · door sale'}
                </p>
              </div>
              {a.scannedAt ? (
                <span className="whitespace-nowrap text-xs text-success">
                  In at {new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(new Date(a.scannedAt))}
                </span>
              ) : (
                <span className="whitespace-nowrap text-xs text-subtle">Not yet</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-subtle">
        Entry codes are not shown here — this list can be screenshotted and shared. The
        gate app reads them.
      </p>
    </div>
  );
}
