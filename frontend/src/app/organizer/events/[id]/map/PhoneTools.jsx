'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ON A PHONE: SAY WHERE THE EDITOR WORKS BEST, AND FOLD THE TOOLS AWAY.
 *
 * At 390px the header and the seven editing controls filled the first screen
 * and the room started below it — a desktop tool at phone width. Drawing a room
 * is a large-screen job; checking it, nudging a table and saving are not. So
 * below md the toolbar is one "Editing tools" button and the canvas comes
 * straight after the header. From md up this renders nothing visible and the
 * toolbar is always shown (`.es-maptools` in globals.css).
 *
 * The open state is the editor's, because the toolbar it folds is rendered
 * there; this is only the sentence and the switch.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PhoneTools({ open, onToggle, controls }) {
  return (
    <div className="es-maptools-bar md:hidden">
      <p className="text-sm text-muted">
        Drawing the room works best on a tablet or computer. Here you can check the map, move a table and save.
      </p>
      <button
        type="button"
        className="es-btn es-btn--secondary es-btn--sm self-start"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
      >
        {open ? 'Hide editing tools' : 'Editing tools'}
      </button>
    </div>
  );
}
