'use client';

import NavIcon from '../../../../components/shell/NavIcon';

/**
 * A narrow editor puts the inspector UNDER the map, so a tap on a table
 * changed something the organizer could not see. This says what is selected,
 * where the tap happened, with a way down to its settings (2026-11-21).
 * `.es-mapjump` shows only below the width where the panel moves beside the
 * map, and the scroll happens only on the button — the map never moves.
 */
export default function SelectionJump({ selection, sole, drawingWalls, panelRef }) {
  if (selection.count === 0 && !drawingWalls) return null;
  const what = drawingWalls ? 'Drawing walls'
    : sole?.kind === 'table' ? (sole.table.label ? `Table ${sole.table.label} selected` : 'Untitled table selected')
      : sole?.kind === 'zone' ? 'Area selected'
        : `${selection.count} selected`;
  return (
    <div className="es-mapjump">
      <span className="fx-min0 fx-truncate">{what}</span>
      <button
        type="button" className="es-btn es-btn--secondary es-btn--sm"
        onClick={() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      >
        Edit details <NavIcon name="arrowDown" size={16} />
      </button>
    </div>
  );
}
