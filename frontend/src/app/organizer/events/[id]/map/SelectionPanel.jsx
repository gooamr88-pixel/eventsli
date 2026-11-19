'use client';

import { useState } from 'react';
import NewTierInline, { NEW_TIER } from './NewTierInline';
import { RangeField } from './style/StyleFields';
import { TABLE_SCALE } from '../../../../components/seating/seatingGeometry';

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
/**
 * `tiers` + `onAssign`: one ticket type for every selected table at once — the
 * fastest way to price a whole section. Zones have no seats, so they are left
 * out of it.
 */
/**
 * `categories` + `onAssignCategory` and `sizes` + `onResize` (2026-11-19, the
 * owner: "select more than one table to choose categories", "make them
 * smaller to fit more tables"): the same one-step edit for a table's
 * category and its drawn size.
 */
export default function SelectionPanel({
  tableCount, zoneCount, onRotate, onDuplicate, onRemove, onClear, tiers = [], onAssign = null, onTierCreated = null,
  categories = [], onAssignCategory = null, sizes = [], onResize = null,
}) {
  const total = tableCount + zoneCount;
  const [creatingTier, setCreatingTier] = useState(false);
  // The slider shows the selection's size when they all share one, else 100%.
  const sharedSize = sizes.length && sizes.every((s) => s === sizes[0]) ? sizes[0] : 1;
  const these = tableCount === 1 ? 'this table' : `these ${tableCount} tables`;

  return (
    <aside className="fx-stack fx-stack--sm es-dcard">
      <h3 className="text-lg">{total} selected</h3>

      <p className="text-sm text-muted">
        {describe(tableCount, zoneCount)} Drag any one of them to move the whole group.
      </p>

      {onAssign && tableCount > 0 && (
        <label className="fx-stack fx-stack--sm gap-1">
          <span className="text-sm font-semibold text-ink">Ticket type for {these}</span>
          <select
            className="es-input" defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = '';
              if (v === NEW_TIER) setCreatingTier(true);
              else if (v) onAssign(v === 'none' ? null : v);
            }}
          >
            <option value="" disabled>Assign to ticket type…</option>
            {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="none">No ticket type</option>
            <option value={NEW_TIER}>+ New ticket type…</option>
          </select>
        </label>
      )}
      {onAssign && tableCount > 0 && creatingTier && (
        <NewTierInline
          onCreated={(tier) => { onTierCreated?.(tier); onAssign(tier.id); setCreatingTier(false); }}
          onCancel={() => setCreatingTier(false)}
        />
      )}

      {onAssignCategory && tableCount > 0 && (
        <label className="fx-stack fx-stack--sm gap-1">
          <span className="text-sm font-semibold text-ink">Category for {these}</span>
          <select
            className="es-input" defaultValue="" disabled={categories.length === 0}
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = '';
              if (v) onAssignCategory(v === 'none' ? null : v);
            }}
          >
            <option value="" disabled>{categories.length ? 'Assign to category…' : 'No categories yet'}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            {categories.length > 0 && <option value="none">No category</option>}
          </select>
          {categories.length === 0 && (
            <span className="text-xs text-subtle">Create categories on the event&apos;s Tables page, then come back to assign them.</span>
          )}
        </label>
      )}

      {onResize && tableCount > 0 && (
        <div className="fx-stack gap-1">
          <RangeField
            label="Table size" min={TABLE_SCALE.min * 100} max={TABLE_SCALE.max * 100} step={5}
            value={Math.round(sharedSize * 100)}
            format={(v) => `${v}%`}
            onChange={(v) => onResize(v / 100)}
          />
          <span className="text-xs text-subtle">
            Resizes {these} together. Smaller tables fit more in the room.
          </span>
        </div>
      )}

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
        With Pick several on, tap one on the map to drop it out of the selection (or Ctrl-click it).
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
