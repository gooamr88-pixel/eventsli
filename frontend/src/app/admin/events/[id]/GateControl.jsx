'use client';

import { useState } from 'react';
import { post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { describeGate, gateModeLabel } from '../../../lib/gateState';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../components/ui/Toast';
import { Notice } from '../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AN EVENT'S GATE, AND THE ONE CONTROL OVER IT.
 *
 *   Follow invoices  the default: an overdue invoice (past its due date and the
 *                    platform's grace hours) switches scanning off
 *   Keep open        scanning stays on whatever is owed — a door that must open
 *   Keep closed      scanning stays off whatever is owed — a dispute, a stop
 *
 * Either "keep" can last until changed or until a time; it ends by itself then,
 * and nothing else ever changes it: not the overdue job, not settling an
 * invoice. Replaces "reopen for 12 hours", which was the only lever there was.
 *
 * Super admins change it (BRD §18); other admins see the state and why.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MODES = [
  ['auto', 'Follow invoices', 'Scanning switches off when an invoice is overdue.'],
  ['open', 'Keep open', 'Scanning stays on, whatever is owed.'],
  ['closed', 'Keep closed', 'Scanning stays off, whatever is owed.'],
];

const DURATIONS = [
  ['', 'Until changed'],
  ['6', 'For 6 hours'],
  ['12', 'For 12 hours'],
  ['24', 'For 24 hours'],
  ['72', 'For 3 days'],
  ['168', 'For 7 days'],
  ['custom', 'Until a date and time…'],
];

export default function GateControl({ event, gate, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const state = gate?.gate || null;
  const current = state?.mode || 'auto';
  const [mode, setMode] = useState(current);
  const [duration, setDuration] = useState('');
  const [custom, setCustom] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const info = describeGate(state, { timezone: event.timezone, audience: 'admin' });
  const cancelled = event.status === 'cancelled';
  const canEdit = Boolean(user?.isSuperAdmin) && !cancelled;
  const changed = mode !== current || (mode !== 'auto' && duration !== '');

  function untilValue() {
    if (mode === 'auto' || duration === '') return null;
    if (duration === 'custom') return custom ? new Date(custom).toISOString() : undefined;
    return new Date(Date.now() + Number(duration) * 3600e3).toISOString();
  }

  async function apply(e) {
    e.preventDefault();
    setError(null);
    const until = untilValue();
    if (until === undefined) { setError(new Error('Choose the end date and time.')); return; }
    setBusy(true);
    try {
      const result = await post(`/admin/events/${event.id}/gate`, { mode, until, reason: reason.trim() }, { noRedirect: true });
      const now = describeGate(result.gate, { timezone: event.timezone, audience: 'admin' });
      toast.success(`${now.title}.${result.organizerNotified ? ' The organizer has been emailed.' : ''}`, { title: 'Gate updated' });
      setReason('');
      setDuration('');
      onChanged();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fx-stack fx-stack--sm border-t border-border-base pt-3">
      <div className="fx-row fx-row--between">
        <p className="text-sm text-ink">Check-in gate</p>
        <span className="es-pill">{gateModeLabel(state)}</span>
      </div>
      <Notice tone={info.tone === 'success' ? 'info' : info.tone} title={info.title}>
        {info.detail && <p>{info.detail}</p>}
        {state?.enforcement === false && state?.reason !== 'enforcement_off' && (
          <p>Invoice enforcement is off for the platform (Platform settings).</p>
        )}
        {state?.grace_hours > 0 && <p>Grace after a due date: {state.grace_hours} hours.</p>}
      </Notice>
      {gate?.stats && (
        <p className="es-nums text-xs text-subtle">
          {gate.stats.admitted} admitted · {gate.stats.pending} still to arrive · {gate.stats.void} void
        </p>
      )}

      {canEdit ? (
        <form onSubmit={apply} className="fx-stack fx-stack--sm">
          <fieldset className="fx-stack fx-stack--sm">
            <legend className="sr-only">Gate mode</legend>
            {MODES.map(([value, label, hint]) => (
              <label key={value} className="fx-row items-start gap-2 text-sm text-ink">
                <input
                  type="radio" name={`gate-${event.id}`} value={value} className="mt-1 accent-[var(--es-accent)]"
                  checked={mode === value} onChange={() => setMode(value)}
                />
                <span><strong>{label}</strong> <span className="text-muted">— {hint}</span></span>
              </label>
            ))}
          </fieldset>
          {mode !== 'auto' && (
            <div className="fx-grid fx-grid--2">
              <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
                How long
                <select className="es-input" value={duration} onChange={(e) => setDuration(e.target.value)}>
                  {DURATIONS.map(([v, l]) => <option key={v || 'forever'} value={v}>{l}</option>)}
                </select>
              </label>
              {duration === 'custom' && (
                <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
                  Until (your clock)
                  <input type="datetime-local" className="es-input" value={custom} onChange={(e) => setCustom(e.target.value)} />
                </label>
              )}
            </div>
          )}
          <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
            Why
            <textarea
              className="es-input py-2" rows={2} maxLength={500} required minLength={5} value={reason}
              placeholder="Recorded in the audit log, and shown to the organizer when scanning switches off."
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error && <p className="text-xs text-danger">{messageFor(error)}</p>}
          <div>
            <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy || !changed || reason.trim().length < 5}>
              {busy ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </form>
      ) : (
        !cancelled && <p className="text-xs text-subtle">Only a super admin can change the gate.</p>
      )}
    </div>
  );
}
