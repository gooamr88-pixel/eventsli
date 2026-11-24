'use client';

import { useEffect, useRef, useState } from 'react';
import { get, post } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { useModal } from '../../hooks/useModal';
import { useToast } from '../../components/ui/Toast';
import NavIcon from '../../components/shell/NavIcon';
import { downloadAuditCsv } from './auditCsv';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CLEARING THE AUDIT LOG (owner, 2026-11-24: "add a button to clear all logs,
 * professionally"). A super admin's, done the way a record should be:
 *
 *   1. choose what goes — older than 90 days, older than a year, or all;
 *   2. see how many entries that is, and download them as a CSV first;
 *   3. say why, and type CLEAR.
 *
 * Earlier clearings are never removed, and this one is written to the log
 * (backend settingsController.clearAudit), so the log always says who emptied
 * it, when, how much and why.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SCOPES = [
  { key: '90', label: 'Older than 90 days', days: 90 },
  { key: '365', label: 'Older than 1 year', days: 365 },
  { key: 'all', label: 'Everything', days: null },
];

export default function ClearAuditDialog({ onClose, onCleared }) {
  const toast = useToast();
  const dialogRef = useRef(null);
  useModal(dialogRef, onClose);

  const [scope, setScope] = useState('90');
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [downloaded, setDownloaded] = useState(false);

  const chosen = SCOPES.find((s) => s.key === scope);

  // How many entries this choice removes — counted by the API, never guessed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const until = chosen.days ? new Date(Date.now() - chosen.days * 86_400_000).toISOString() : new Date().toISOString();
      try {
        const body = await get(`/admin/audit?limit=1&until=${encodeURIComponent(until)}`, { raw: true, noRedirect: true, cache: 'no-store' });
        if (!cancelled) setCount(Number(body?.pagination?.total ?? 0));
      } catch {
        if (!cancelled) setCount(null);
      }
    })();
    return () => { cancelled = true; };
  }, [chosen]);

  async function download() {
    setBusy('download');
    setError(null);
    try {
      const until = chosen.days ? new Date(Date.now() - chosen.days * 86_400_000).toISOString() : null;
      const n = await downloadAuditCsv({ until });
      setDownloaded(true);
      toast.success(`${n.toLocaleString('en')} entries saved as a CSV file.`, { title: 'Copy downloaded' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy('clear');
    setError(null);
    try {
      const result = await post('/admin/audit/clear', {
        scope: chosen.days ? 'older' : 'all',
        ...(chosen.days ? { days: chosen.days } : {}),
        confirm: typed.trim(),
        reason: reason.trim(),
      }, { noRedirect: true });
      toast.success(`${Number(result?.deleted || 0).toLocaleString('en')} entries removed. The clearing itself is recorded in the log.`, { title: 'Audit log cleared' });
      onCleared?.();
      onClose();
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  const ready = typed.trim() === 'CLEAR' && reason.trim().length >= 10 && count !== 0;

  return (
    <div className="es-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="clear-audit-title" className="es-backdrop__panel fx-stack fx-stack--sm">
        <div>
          <h2 id="clear-audit-title" className="text-lg">Clear the audit log</h2>
          <p className="mt-1 text-sm text-muted">
            Removed entries cannot be brought back. Earlier clearings stay, and this one is recorded with your name and reason.
          </p>
        </div>

        <fieldset className="fx-stack fx-stack--sm gap-2">
          <legend className="text-sm font-medium text-ink">What to remove</legend>
          {SCOPES.map((s) => (
            <label key={s.key} className="es-check">
              <input type="radio" name="audit-scope" className="es-check__box" checked={scope === s.key} onChange={() => { setScope(s.key); setDownloaded(false); setCount(null); }} />
              <span className="text-sm text-ink">{s.label}</span>
            </label>
          ))}
          <p className="text-sm" role="status">
            {count === null ? 'Counting…' : count === 0
              ? 'Nothing to remove for this choice.'
              : <><b className="es-nums">{count.toLocaleString('en')}</b> {count === 1 ? 'entry' : 'entries'} will be removed.</>}
          </p>
        </fieldset>

        <div className="fx-row items-center gap-2">
          <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={download} disabled={busy !== null || !count}>
            <NavIcon name="download" size={16} />
            {busy === 'download' ? 'Preparing…' : 'Download a copy first (CSV)'}
          </button>
          {downloaded && <span className="text-sm text-muted">Saved</span>}
        </div>

        <label className="fx-stack gap-1.5 text-sm text-ink">
          Why are you clearing it?
          <textarea className="es-input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="For example: end-of-year clean-up after export" />
        </label>

        <label className="fx-stack gap-1.5 text-sm text-ink">
          Type <b>CLEAR</b> to confirm
          <input className="es-input" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} aria-describedby="clear-audit-title" />
        </label>

        {error && <p role="alert" className="text-sm text-danger">{describeError(error).title}</p>}

        <div className="fx-row fx-row--between">
          <button type="button" className="es-btn es-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="es-btn es-btn--danger" disabled={!ready || busy !== null} onClick={clear}>
            {busy === 'clear' ? 'Clearing…' : count ? `Clear ${count.toLocaleString('en')} ${count === 1 ? 'entry' : 'entries'}` : 'Clear'}
          </button>
        </div>
      </div>
    </div>
  );
}
