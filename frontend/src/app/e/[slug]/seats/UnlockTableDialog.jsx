'use client';

import { useEffect, useRef, useState } from 'react';
import { post } from '../../../utils/apiClient';
import { describeError } from '../../../utils/errors';
import { useModal } from '../../../hooks/useModal';

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

  // The code field. A passive effect, which is `useModal`'s one contract:
  // the hook captures where focus came from in a LAYOUT effect, and anything
  // that moves focus before that capture is recorded as the opener by mistake.
  useEffect(() => { inputRef.current?.focus(); }, []);

  /**
   * Escape, the Tab trap, the scroll lock, and returning focus to the table
   * that was clicked. See `useModal`; the last two were missing.
   *
   * The trap is load-bearing here: without it Tab walks out of the dialog into
   * the SEAT MAP behind it, where a keyboard user then selects seats they
   * cannot see. `trapTab` skips disabled controls, which matters because Unlock
   * is disabled until a code is typed — so this dialog opens with its last
   * control unfocusable, the exact state a naive trap leaks on.
   */
  useModal(dialogRef, onClose);

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
    // `.es-backdrop` — the shared scrim and z-index. See globals.css; this was
    // a copy of the same utility string the transfer dialog carried.
    <div
      className="es-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-title"
        className="es-backdrop__panel"
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
            {/* `.es-btn--ghost`, not bare text. Beside a real `.es-btn` this
                read as a link somebody forgot to style, and it was a ~20px
                target on a phone — under the 44px floor `.es-btn` guarantees
                at every size, on a dialog whose whole job is to be tapped. */}
            <button type="button" onClick={onClose} className="es-btn es-btn--ghost">
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
