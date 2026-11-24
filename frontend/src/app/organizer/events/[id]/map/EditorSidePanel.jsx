'use client';

import TablePanel from './TablePanel';
import ZonePanel from './ZonePanel';
import BoothPanel from './BoothPanel';
import SelectionPanel from './SelectionPanel';
import MapPanel from './MapPanel';
import WallToolPanel from './style/WallToolPanel';
import { countUnpriced } from './MapChrome';
import { keyOf } from './useMapDraft';

/**
 * The inspector beside the canvas, which shows what the selection is: the wall
 * tool while it is drawing, several things, one zone, one table, or — with
 * nothing selected — the whole map. Every one is the same `Inspector` shape
 * (components/inspector/Inspector.jsx), so moving between them never rearranges the panel.
 */
export default function EditorSidePanel({
  sole, selection, draft, tables, tiers, world, categories, purchaseMode, onTierCreated,
  onAssignTier, onAssignCategory, onResizeSelected, onRotate, onDuplicate, onRemoveSelected, wallTool = null, onApplyLook,
  onSelectUnpriced, onAssignTablePrice = null, layers = null, onToggleLayer = null,
  dirty = false, saving = false, canSave = false, onSave = null, onAdd = null,
  // Vendor booths on this map (boothZones.js): their states and booth types.
  eventId = null, boothInfo = null,
  // Private and Unavailable, for one table or several (2026-11-24).
  onSetPrivateSelected = null, tableStock = null, onSetUnavailable = null,
}) {
  const stockOf = (t) => (t.id && tableStock ? tableStock.get(t.id) || null : null);
  if (wallTool?.active) return <WallToolPanel tool={wallTool} />;
  if (selection.count > 1) {
    return (
      <SelectionPanel
        tables={tables.filter((t) => selection.selection.tables.has(keyOf(t)))}
        zoneCount={selection.selection.zones.size}
        booths={boothInfo ? zonesOf(draft.zones, selection, true) : []}
        boothTypes={boothInfo?.boothTypes || []}
        onAssignBoothType={(boothTypeId) => draft.apply((p) => ({
          ...p,
          zones: p.zones.map((z) => (z.kind === 'booth' && selection.selection.zones.has(z.id) ? { ...z, boothTypeId } : z)),
        }))}
        tiers={tiers}
        categories={categories}
        purchaseMode={purchaseMode}
        onAssignCategory={onAssignCategory}
        onResize={onResizeSelected}
        onAssign={onAssignTier}
        onAssignTablePrice={onAssignTablePrice}
        onTierCreated={onTierCreated}
        onRotate={onRotate}
        onDuplicate={onDuplicate}
        onRemove={onRemoveSelected}
        onClear={selection.clear}
        onSetPrivate={onSetPrivateSelected}
        stockOf={tableStock ? stockOf : null}
        onSetUnavailable={onSetUnavailable ? (on) => onSetUnavailable(
          tables.filter((t) => t.id && selection.selection.tables.has(keyOf(t))).map((t) => t.id), on,
        ) : null}
      />
    );
  }
  if (sole?.kind === 'zone' && sole.zone.kind === 'booth') {
    return (
      <BoothPanel
        key={sole.zone.id}
        zone={sole.zone}
        eventId={eventId}
        boothInfo={boothInfo}
        world={world}
        onChange={draft.updateZone}
        onRotate={onRotate}
        onDuplicate={onDuplicate}
        onRemove={(id) => { draft.removeZone(id); selection.clear(); }}
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
  if (sole?.kind === 'table') {
    return (
      <TablePanel
        // Keyed by table: a half-typed price or an open "New ticket type" form
        // belongs to the table it was opened on, not to the next one selected.
        key={keyOf(sole.table)}
        table={sole.table}
        tiers={tiers}
        categories={categories}
        purchaseMode={purchaseMode}
        onTierCreated={onTierCreated}
        // Consecutive edits to the same field of the same table are one undo step.
        onChange={(key, patch) => draft.updateTable(key, patch, {
          mergeKey: `${key}:${Object.keys(patch).sort().join(',')}`,
        })}
        onRotate={onRotate}
        onDuplicate={onDuplicate}
        onRemove={(key) => { draft.removeTable(key); selection.clear(); }}
        stock={stockOf(sole.table)}
        onSetUnavailable={onSetUnavailable && sole.table.id ? (on) => onSetUnavailable([sole.table.id], on) : null}
      />
    );
  }
  return (
    <MapPanel
      tableCount={tables.length}
      unpricedCount={countUnpriced(tables, purchaseMode)}
      purchaseMode={purchaseMode}
      onSelectUnpriced={onSelectUnpriced}
      look={draft.look}
      onLookChange={draft.setLook}
      onApplyLook={onApplyLook}
      layers={layers}
      onToggleLayer={onToggleLayer}
      dirty={dirty} saving={saving} canSave={canSave} onSave={onSave} onAdd={onAdd}
    />
  );
}

/** The selected zones that are (or are not) vendor booths. */
function zonesOf(zones, selection, booths) {
  return zones.filter((z) => selection.selection.zones.has(z.id) && (z.kind === 'booth') === booths);
}
