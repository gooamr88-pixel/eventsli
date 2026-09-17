'use client';

import { MIN_ZONE_SIZE, zoneColor, zoneLabel, zoneMeta } from '../../../../components/seating/venueZones';
import { WORLD } from '../../../../components/seating/seatingGeometry';
import ZonePreview from './ZonePreview';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything about one venue zone.
 *
 * Deliberately short, and it is worth saying why next to `TablePanel`, which is
 * five times its length. A table is stock: its seat count generates rows, its
 * price is money, its privacy locks a purchase, and shrinking it can destroy a
 * seat somebody holds a ticket for. Every field there has a consequence a form
 * cannot undo, and the panel spends its length saying so.
 *
 * A zone is a labelled rectangle in a JSON blob. Nothing it can be set to can
 * hurt anyone, nothing about it is refused by the API, and it is the one part
 * of this editor where an organizer can experiment freely. So it gets plain
 * controls and no warnings — adding caution here would only make the real
 * warnings next door read as boilerplate.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ZonePanel({ zone, onChange, onRotate, onResetSize, onDuplicate, onRemove }) {
  const meta = zoneMeta(zone.kind);
  const colour = zoneColor(zone);
  const set = (patch, options) => onChange(zone.id, patch, options);

  return (
    <aside className="fx-stack fx-stack--sm es-card p-5">
      <div className="fx-row fx-row--between">
        <div className="fx-row fx-min0 items-center gap-2">
          <ZonePreview kind={zone.kind} size={20} color={colour} />
          <h3 className="truncate text-lg">{zoneLabel(zone)}</h3>
        </div>
        <button type="button" onClick={() => onRemove(zone.id)} className="es-btn es-btn--ghost es-btn--sm">
          Remove
        </button>
      </div>

      <p className="text-xs text-subtle">
        {meta.label} · furniture only. Zones are never sold, ticketed or counted as stock.
      </p>

      <div className="fx-stack fx-stack--sm gap-1.5">
        <label htmlFor="es-zone-label" className="text-sm text-ink">Label</label>
        <input
          id="es-zone-label"
          className="es-input"
          value={zone.label || ''}
          maxLength={40}
          placeholder={meta.label}
          // One undo step for a typed name, not one per keystroke — the same
          // `mergeKey` contract the table panel uses.
          onChange={(e) => set({ label: e.target.value }, { mergeKey: `${zone.id}:label` })}
        />
        <p className="text-xs text-subtle">Shown on the map, on the buyer&apos;s map and in the printed pack.</p>
      </div>

      <div className="fx-grid" style={{ '--fx-col': '120px', '--fx-gap': '10px' }}>
        <SizeField
          id="es-zone-w" label="Width" value={zone.w} max={WORLD.width}
          onChange={(w) => set({ w }, { mergeKey: `${zone.id}:w` })}
        />
        <SizeField
          id="es-zone-h" label="Height" value={zone.h} max={WORLD.height}
          onChange={(h) => set({ h }, { mergeKey: `${zone.id}:h` })}
        />
      </div>
      <p className="text-xs text-subtle">
        In map units — the room is {WORLD.width} by {WORLD.height}. Dragging the corner handle does the same thing.
      </p>

      <div className="fx-stack fx-stack--sm gap-1.5">
        <label htmlFor="es-zone-colour" className="text-sm text-ink">Colour</label>
        <div className="fx-row items-center gap-2">
          <input
            id="es-zone-colour"
            type="color"
            className="h-9 w-12 cursor-pointer rounded-(--es-radius-sm) border border-border-strong bg-surface p-0.5"
            value={colour}
            onChange={(e) => set({ color: e.target.value }, { mergeKey: `${zone.id}:color` })}
          />
          <button
            type="button"
            onClick={() => set({ color: null })}
            disabled={!zone.color}
            className="es-btn es-btn--ghost es-btn--sm"
          >
            Use the default
          </button>
        </div>
        <p className="text-xs text-subtle">
          Only for telling two of the same kind apart. The map reads better when most zones keep their own colour.
        </p>
      </div>

      <div className="fx-row flex-wrap gap-2 border-t border-border-base pt-3">
        <button type="button" onClick={() => onRotate(90)} className="es-btn es-btn--secondary es-btn--sm">
          Rotate 90°
        </button>
        <button type="button" onClick={() => onResetSize(zone.id)} className="es-btn es-btn--ghost es-btn--sm">
          Reset size
        </button>
        <button type="button" onClick={onDuplicate} className="es-btn es-btn--ghost es-btn--sm">
          Duplicate
        </button>
      </div>
      <p className="text-xs text-subtle">
        Turned {Math.round(zone.rotation || 0)}° · {Math.round(zone.w)}×{Math.round(zone.h)}
      </p>
    </aside>
  );
}

function SizeField({ id, label, value, max, onChange }) {
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      <input
        id={id}
        type="number"
        className="es-input"
        value={Math.round(value)}
        min={MIN_ZONE_SIZE}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          // Clamped to what `layoutZones` will accept on the way out, so the
          // field can never hold a number the save would quietly rewrite.
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(MIN_ZONE_SIZE, Math.round(n))));
        }}
      />
    </div>
  );
}
