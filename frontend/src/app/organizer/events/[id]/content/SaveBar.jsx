'use client';

import NavIcon from '../../../../components/shell/NavIcon';
import { messageFor } from '../../../../utils/errors';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SAVE, AND WHAT HAPPENED WHEN YOU PRESSED IT.
 *
 * One bar per section, not one button per row. These lists are edited in
 * passes — an organizer fixes three schedule times in a row — and three
 * separate Save buttons would be three decisions where there is one.
 *
 * STICKY, so it is reachable from the middle of a long list. A Save button at
 * the foot of nine policies is a button you have to go and find, and a change
 * you have to remember you made.
 *
 * IT DISAPPEARS WHEN THERE IS NOTHING TO SAVE — except just after a save, when
 * it stays for a moment to say so. A permanently visible disabled Save button
 * is a permanently visible reminder that nothing is happening.
 *
 * `aria-live="polite"` on the status, not `assertive`: this reports the result
 * of something the reader just did deliberately, so it can wait its turn.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SaveBar({ dirty, status, failure, onSave, onDiscard, label = 'changes' }) {
  const saving = status === 'saving';
  // Kept on screen after a successful save so the tick is actually seen; the
  // hook drops back to `idle` the moment anything is typed again.
  if (!dirty && status !== 'saved' && status !== 'error') return null;

  return (
    <div className="es-savebar">
      <p className="es-savebar__status" aria-live="polite">
        {saving && <>Saving…</>}
        {!saving && status === 'saved' && (
          <span className="es-savebar__ok">
            <NavIcon name="check" size={16} />
            Saved
          </span>
        )}
        {!saving && status === 'error' && (
          <span className="es-savebar__bad">
            {/* The server's own sentence where there is one — it names the row
                or the rule — and the mapped recovery where there is not. */}
            {messageFor(failure)}
          </span>
        )}
        {!saving && status !== 'saved' && status !== 'error' && (
          <>Unsaved {label}</>
        )}
      </p>

      <div className="fx-row shrink-0 gap-2">
        {dirty && (
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="es-btn es-btn--ghost es-btn--sm"
          >
            Discard
          </button>
        )}
        {dirty && (
          <button
            type="button"
            onClick={onSave}
            // Disabled WHILE SAVING, which is the whole of the double-click
            // guard: these are PATCHes against the same rows, and a second
            // press mid-flight is a second write of the same text.
            disabled={saving}
            aria-busy={saving || undefined}
            className="es-btn es-btn--primary es-btn--sm"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>
    </div>
  );
}
