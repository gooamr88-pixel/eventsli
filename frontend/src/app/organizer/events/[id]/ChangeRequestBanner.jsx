'use client';

import { useState } from 'react';
import { del, post } from '../../../utils/apiClient';
import { useToast } from '../../../components/ui/Toast';
import { Notice } from '../../../components/Feedback';
import { formatEventTime } from '../../../lib/eventTime';
import { describeError } from '../../../utils/errors';
import { useNowMinute } from '../../../hooks/useNowMinute';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE A CHANGE TO A LIVE EVENT STANDS (2026-11-24; backend
 * eventChangeRequests.js). An organizer's change to the title, dates, venue
 * or category of an event on sale waits for an admin; this says what is
 * waiting — each field, from and to — and lets the organizer take it back.
 *
 * The same panel serves the admin (`asAdmin`), with Approve and Decline in
 * place of Withdraw. A declined request shows its reason to the organizer
 * for two weeks, then goes quiet.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const RECENT_MS = 14 * 24 * 3600 * 1000;

export default function ChangeRequestBanner({ event, asAdmin = false, request: given = null, onChanged }) {
  const toast = useToast();
  const request = given || event?.changeRequest || null;
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [declining, setDeclining] = useState(false);
  // The clock, from the hook the rest of the dashboard uses (null at first render).
  const now = useNowMinute();

  if (!request) return null;
  const tz = event?.timezone;

  if (request.status === 'rejected' && !asAdmin) {
    if (!request.decidedAt || now === null || now - Date.parse(request.decidedAt) > RECENT_MS) return null;
    return (
      <Notice tone="warning" title="Your last change was not approved">
        {request.decisionNote && <p>“{request.decisionNote}”</p>}
        <p>Your event is still on sale as it was. You can make a new change below.</p>
      </Notice>
    );
  }
  if (request.status !== 'pending') return null;

  const run = async (kind, fn, done) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      toast.success(done);
      setDeclining(false);
      onChanged?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Notice
      tone="info"
      title={asAdmin ? 'The organizer changed this live event — waiting for your review' : 'Waiting for Eventsli to review your change'}
    >
      <p>
        {asAdmin
          ? 'Nothing below is public yet. Approving puts it on the event page; declining leaves the event as it is and emails the organizer your reason.'
          : 'Your event stays exactly as it is on Eventsli until this is approved. We will email you either way.'}
      </p>
      <table className="es-changes">
        <thead>
          <tr><th scope="col">Field</th><th scope="col">Now</th><th scope="col">Changes to</th></tr>
        </thead>
        <tbody>
          {request.changes.map((c) => (
            <tr key={c.column}>
              <th scope="row">{c.label}</th>
              <td>{show(c.column, c.from, tz)}</td>
              <td><b>{show(c.column, c.to, c.column === 'timezone' ? c.to : tz)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p role="alert" className="text-sm text-danger">{describeError(error).title}</p>}
      {asAdmin ? (
        declining ? (
          <div className="fx-stack fx-stack--sm">
            <label className="fx-stack gap-1.5 text-sm text-ink">
              Why not? The organizer will see this.
              <textarea className="es-input" rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="fx-row gap-2">
              <button
                type="button" className="es-btn es-btn--danger es-btn--sm" disabled={note.trim().length < 10 || busy}
                onClick={() => run('reject', () => post(`/admin/change-requests/${request.id}/reject`, { note: note.trim() }, { noRedirect: true }), 'Declined. The organizer has been emailed.')}
              >
                {busy === 'reject' ? 'Declining…' : 'Decline change'}
              </button>
              <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setDeclining(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="fx-row gap-2">
            <button
              type="button" className="es-btn es-btn--primary es-btn--sm" disabled={Boolean(busy)}
              onClick={() => run('approve', () => post(`/admin/change-requests/${request.id}/approve`, {}, { noRedirect: true }), 'Approved. The change is live and the organizer has been emailed.')}
            >
              {busy === 'approve' ? 'Approving…' : 'Approve and publish'}
            </button>
            <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={Boolean(busy)} onClick={() => setDeclining(true)}>
              Decline…
            </button>
          </div>
        )
      ) : (
        <div>
          <button
            type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={Boolean(busy)}
            onClick={() => run('withdraw', () => del(`/events/${event.id}/change-request`, { noRedirect: true }), 'Change withdrawn.')}
          >
            {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw this change'}
          </button>
        </div>
      )}
    </Notice>
  );
}

/** A stored value, readable: times on the event's clock, empty as a dash. */
export function show(column, value, timezone) {
  if (value === null || value === undefined || value === '') return '—';
  if ((column === 'starts_at' || column === 'ends_at') && timezone) {
    try { return formatEventTime(value, timezone); } catch { return String(value); }
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
