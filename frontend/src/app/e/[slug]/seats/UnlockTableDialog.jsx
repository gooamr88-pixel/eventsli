'use client';

import { useEffect, useRef, useState } from 'react';
import { post } from '../../../utils/apiClient';
import { describeError } from '../../../utils/errors';

/**
 * The password gate on a private table (BRD §27).
 *
 * Worth knowing about the endpoint behind this: every rejection is identical.
 * Wrong password, table not private, no such table — one answer. So this dialog
 * cannot and must not try to be more specific than "that did not work"; there
 * is nothing more specific to say, and inventing a distinction would undo the
 * reason the API refuses to make one.
 *
 * The token it returns is scoped to one table, one event, twenty minutes. It
 * gates the PURCHASE as well as the map, which is why it is kept and handed to
 * the hold rather than thrown away once the table appears.
 */
export default function UnlockTableDialog({ slug, tableId, onClose, onUnlocked }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Escape closes, and focus is trapped while it is open. Without the trap, Tab
  // walks out of the dialog into the seat map behind it — where a keyboard user
  // then activates seats they cannot see.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll(
        'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await post(
        `/public/events/${encodeURIComponent(slug)}/tables/${encodeURIComponent(tableId)}/unlock`,
        { password },
        { noRedirect: true },
      );
      onUnlocked(data.token);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[--es-z-modal] grid place-items-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-title"
        className="fx-stack w-full max-w-sm es-card p-5 shadow-xl"
      >
        <div>
          {/* No table name, because we do not have one: the table is absent
              from the map payload until this succeeds, and the link carries
              only an id. Naming it would mean asking the API which table it
              is — the one question it refuses to answer for exactly this
              reason. */}
          <h2 id="unlock-title" className="text-lg">You have been given a private table</h2>
          <p className="mt-1 text-sm text-muted">
            Enter the password from your invitation to see it.
          </p>
        </div>

        <form onSubmit={submit} className="fx-stack fx-stack--sm">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            aria-label="Table password"
            aria-invalid={error ? 'true' : undefined}
            className="es-input"
          />

          {error && (
            <p role="alert" className="text-sm text-danger">
              {describeError(error).recovery}
            </p>
          )}

          <div className="fx-row fx-row--between">
            <button type="button" onClick={onClose} className="text-sm text-muted hover:text-ink">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || password.length === 0}
              className="es-btn es-btn--primary"
            >
              {busy ? 'Checking…' : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
