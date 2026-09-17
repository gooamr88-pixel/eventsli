'use client';

/**
 * Reorder and remove, for one row of any content list.
 *
 * ARROWS, NOT DRAG-AND-DROP, and that is an argued choice rather than a
 * shortcut. A drag handle is nicer with a mouse and is unusable with a
 * keyboard, awkward with a screen reader, and fights the page's own scrolling
 * on a phone — which is where an organizer edits this most. Two buttons work
 * identically for everybody and are announced properly without any extra work.
 *
 * The ends are DISABLED rather than hidden. A control that disappears at the
 * top of the list makes the rows below it shift under the cursor mid-gesture,
 * so the next click lands on the wrong one.
 */
export default function RowControls({ index, total, busy, onMove, onRemove, label = 'item' }) {
  return (
    <div className="fx-row fx-row--between items-center gap-2">
      <div className="fx-row gap-1">
        <IconButton
          onClick={() => onMove(-1)}
          disabled={busy || index === 0}
          label={`Move this ${label} earlier`}
        >
          ↑
        </IconButton>
        <IconButton
          onClick={() => onMove(1)}
          disabled={busy || index === total - 1}
          label={`Move this ${label} later`}
        >
          ↓
        </IconButton>
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="es-btn es-btn--ghost es-btn--sm text-danger"
      >
        Remove
      </button>
    </div>
  );
}

function IconButton({ onClick, disabled, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      // The glyph alone would be announced as "up arrow", which says what it
      // looks like rather than what it does.
      title={label}
      className="grid h-8 w-8 place-items-center rounded-(--es-radius-sm) border border-border-strong text-ink transition-colors hover:bg-bg-sunken disabled:opacity-40"
    >
      {children}
    </button>
  );
}
