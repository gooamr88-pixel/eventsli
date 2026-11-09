'use client';

import TablePanel from './TablePanel';
import ZonePanel from './ZonePanel';
import SelectionPanel from './SelectionPanel';
import BuildPanel from './BuildPanel';
import { countUnpriced } from './MapChrome';
import { keyOf } from './useMapDraft';

/**
 * The panel beside the canvas, which shows what the selection is: several
 * things, one zone, one table, or nothing (the build panel). Split out of
 * MapEditor (2026-11-10); the 3D card around it stays there, because it moves
 * above or below this panel depending on whether anything is selected.
 */
export default function EditorSidePanel({
  sole, selection, draft, tables, tiers, world, categories, purchaseMode, onTierCreated,
  onAssignTier, onRotate, onDuplicate, onRemoveSelected, onAdd,
}) {
  if (selection.count > 1) {
    return (
      <SelectionPanel
        tableCount={selection.selection.tables.size}
        zoneCount={selection.selection.zones.size}
        tiers={tiers}
        onAssign={onAssignTier}
        onTierCreated={onTierCreated}
        onRotate={onRotate}
        onDuplicate={onDuplicate}
        onRemove={onRemoveSelected}
        onClear={selection.clear}
      />
    );
  }
  if (sole?.kind === 'zone') {
    return (
      <ZonePanel
        zone={sole.zone}
        world={world}
        onChange={draft.updateZone}
        onRotate={onRotate}
        onResetSize={draft.resetZoneSize}
        onDuplicate={onDuplicate}
        onRemove={(id) => { draft.removeZone(id); selection.clear(); }}
      />
    );
  }
  if (sole?.kind !== 'table') {
    return <BuildPanel tableCount={tables.length} unpricedCount={countUnpriced(tables, purchaseMode)} onAdd={onAdd} />;
  }
  return (
    <TablePanel
      // Keyed by table: a half-typed price or an open "New ticket type" form
      // belongs to the table it was opened on, not to the next one selected.
      key={keyOf(sole.table)}
      table={sole.table}
      tiers={tiers}
      categories={categories}
      onTierCreated={onTierCreated}
      // Consecutive edits to the same field of the same table are one undo
      // step: typing a name used to be one step per keystroke.
      onChange={(key, patch) => draft.updateTable(key, patch, {
        mergeKey: `${key}:${Object.keys(patch).sort().join(',')}`,
      })}
      onRotate={onRotate}
      onDuplicate={onDuplicate}
      onRemove={(key) => { draft.removeTable(key); selection.clear(); }}
    />
  );
}
