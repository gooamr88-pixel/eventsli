'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The inspector when SEVERAL things are selected.
 *
 * It exists because of a specific failure worth naming: bulk rotate and bulk
 * delete can be wired up correctly, tested, and still be unreachable. A marquee
 * selection leaves no single element selected, so the inspector fell through to
 * "Select a table to edit it" — and the only way to trigger either action was
 * the Delete key, which you have to already know about, while rotate had no
 * trigger at all. The handlers worked. Through the interface, the feature did
 * not exist.
 *
 * So every operation that applies to a selection has a control HERE, where the
 * selection is what you are looking at.
 *
 * WHY DELETE IS COUNTED BUT NOT WARNED ABOUT. Removing a table from the draft
 * is not removing it from the event — the save is a full replace and the API
 * refuses to drop a table with sold or held seats, rolling the whole save back
 * and naming the ones it kept. Until Save, Ctrl+Z is the undo. A confirmation
 * here would be asking twice about something that has not happened yet.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SelectionPanel({ tableCount, zoneCount, onRotate, onDuplicate, onRemove, onClear }) {
  const total = tableCount + zoneCount;

  return (
    <aside className="fx-stack fx-stack--sm es-card p-5">
      <h3 className="text-lg">{total} selected</h3>

      <p className="text-sm text-muted">
        {describe(tableCount, zoneCount)} Drag any one of them to move the whole group.
      </p>

      <div className="fx-row flex-wrap gap-2">
        <button type="button" onClick={() => onRotate(90)} className="es-btn es-btn--secondary es-btn--sm">
          Rotate all 90°
        </button>
        <button type="button" onClick={onDuplicate} className="es-btn es-btn--secondary es-btn--sm">
          Duplicate all
        </button>
        <button type="button" onClick={onRemove} className="es-btn es-btn--ghost es-btn--sm text-danger">
          Remove all
        </button>
        <button type="button" onClick={onClear} className="es-btn es-btn--ghost es-btn--sm">
          Deselect
        </button>
      </div>

      <p className="text-xs text-subtle">
        Rotating turns each element about its own centre, so the arrangement keeps its shape.
        Ctrl-click one on the map to drop it out of the selection.
      </p>

      <p className="text-xs text-subtle">
        Nothing is removed from the event until you save, and a table with sold seats is
        refused then — Ctrl+Z undoes any of this before that.
      </p>
    </aside>
  );
}

/** "3 tables and 2 zones", with the plurals right and the empty halves left
 *  out — a panel that says "0 zones" makes the reader check whether it matters. */
function describe(tables, zones) {
  const parts = [];
  if (tables > 0) parts.push(`${tables} ${tables === 1 ? 'table' : 'tables'}`);
  if (zones > 0) parts.push(`${zones} ${zones === 1 ? 'venue zone' : 'venue zones'}`);
  return parts.length === 0 ? '' : `${parts.join(' and ')}.`;
}
