'use client';

import { SHAPES, TABLE_SCALE, sideCounts, tableScale } from '../../../../../components/seating/seatingGeometry';
import { SHAPE_SIDES, sideLabel } from '../../../../../components/seating/tableSides';
import { SHAPE_NAMES, SHAPE_HINTS } from '../shapeNames';
import ShapeArt from './ShapeArt';
import { ColourField, RangeField, Stepper } from './StyleFields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * How one table looks (2026-11-18, the owner's floor-plan reference): its
 * shape, how many seats on each side, and its colours.
 *
 * Seats per side change the SEAT COUNT, because they are the seat count: the
 * total under the preview is what the table sells. Changing the count in the
 * Seats field instead goes back to the shape's own spread, so the two can never
 * disagree (tableSides.customSides refuses counts that do not add up).
 *
 * Everything here is stored as the table's `style` (mapStyle.js) and saved in
 * the map's layout — nothing about the stock changes except the seat count.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MAX_SEATS = 60;

export default function TableStyleSection({ table, onChange, sold = 0 }) {
  const style = table.style || {};
  const shape = SHAPES.includes(table.shape) ? table.shape : 'round';
  const sided = SHAPE_SIDES[shape];
  const counts = sideCounts(shape, table.seatCount, style);

  /** Merges into the style; a null value removes that key (back to default). */
  const setStyle = (patch, extra = {}) => {
    const next = { ...style };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete next[k]; else next[k] = v;
    }
    onChange({ ...extra, style: Object.keys(next).length ? next : null });
  };

  const setSide = (index, value) => {
    const next = counts.slice();
    next[index] = Math.max(0, value);
    const total = next.reduce((a, b) => a + b, 0);
    if (total < 1 || total > MAX_SEATS) return;
    const sides = {};
    ['top', 'right', 'bottom', 'left'].forEach((name, i) => { if (sided.includes(i)) sides[name] = next[i]; });
    setStyle({ sides }, { seatCount: total });
  };

  const rectish = shape === 'rect' || shape === 'square';

  return (
    <div className="fx-stack fx-stack--sm gap-3 border-t border-border-base pt-3">
      <h4 className="text-sm font-semibold text-ink">Shape and style</h4>

      <div role="group" aria-label="Table shape" className="es-shapegrid">
        {SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            className="es-shapegrid__tile"
            aria-pressed={shape === s}
            title={`${SHAPE_NAMES[s] || s} — ${SHAPE_HINTS[s] || ''}`}
            // A new shape starts from its own seat spread: sides chosen for a
            // D-shape mean nothing on a hexagon.
            onClick={() => { if (s !== shape) setStyle({ sides: null }, { shape: s }); }}
          >
            <ShapeArt shape={s} size={26} />
            <span>{SHAPE_NAMES[s] || s}</span>
          </button>
        ))}
      </div>

      {/* 2026-11-19: "resize the tables, make them smaller to fit more". The
          whole table and its seats, on every view (seatingGeometry.tableScale). */}
      <div className="fx-stack gap-1">
        <RangeField
          label="Table size" min={TABLE_SCALE.min * 100} max={TABLE_SCALE.max * 100} step={5}
          value={Math.round(tableScale(style) * 100)}
          format={(v) => `${v}%`}
          onChange={(v) => setStyle({ scale: v === 100 ? null : v / 100 })}
        />
        <p className="text-xs text-subtle">
          Smaller tables fit more in the room. Seats shrink with the table.
          {style.scale ? <> <button type="button" className="es-linkbtn" onClick={() => setStyle({ scale: null })}>Normal size</button></> : null}
        </p>
      </div>

      {sided && (
        <div className="fx-stack fx-stack--sm gap-2">
          <p className="text-sm text-ink">Seats on each side</p>
          <div className="es-sides">
            <span className="es-sides__art">
              <ShapeArt shape={shape} seatCount={table.seatCount} style={style} seats size={104} fill={style.fill || '#9a9a9a'} seatFill={style.seatColor || 'var(--es-brand-coral)'} />
            </span>
            <div className="fx-stack fx-min0 gap-1.5">
              {sided.map((i) => (
                <Stepper
                  key={i}
                  label={sideLabel(shape, i)}
                  value={counts[i]}
                  onChange={(v) => setSide(i, v)}
                  canAdd={table.seatCount < MAX_SEATS}
                  canRemove={counts[i] > 0 && table.seatCount > Math.max(1, sold)}
                />
              ))}
              <p className="text-xs text-subtle">
                {table.seatCount} seat{table.seatCount === 1 ? '' : 's'} in total
                {style.sides ? ' · ' : ''}
                {style.sides && (
                  <button type="button" className="es-linkbtn" onClick={() => setStyle({ sides: null })}>
                    Spread evenly
                  </button>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      <ColourField
        id={`ts-fill-${table.label}`} label="Table colour" value={style.fill} fallback="#8c8c8c"
        onChange={(v) => setStyle({ fill: v })}
      />
      <ColourField
        id={`ts-label-${table.label}`} label="Name colour" value={style.labelColor} fallback="#10303d"
        onChange={(v) => setStyle({ labelColor: v })}
      />
      <ColourField
        id={`ts-stroke-${table.label}`} label="Border" value={style.stroke} fallback="#111018"
        onChange={(v) => setStyle({ stroke: v })} emptyText="None"
      />
      {style.stroke && (
        <RangeField
          label="Border thickness" min={0} max={8} step={0.5} value={style.strokeWidth ?? 1.5}
          onChange={(v) => setStyle({ strokeWidth: v })}
        />
      )}
      {rectish && (
        <RangeField
          label="Corner roundness" min={0} max={26} step={1} value={style.radius ?? 6}
          onChange={(v) => setStyle({ radius: v })}
        />
      )}

      <label className="fx-row items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={!style.seatColor}
          onChange={(e) => setStyle({ seatColor: e.target.checked ? null : '#d6006e' })}
        />
        <span>
          <span className="block text-ink">Seat colour follows ticket type</span>
          <span className="block text-xs text-subtle">Untick to give this table&apos;s seats a colour of their own. Taken seats are always grey.</span>
        </span>
      </label>
      {style.seatColor && (
        <ColourField
          id={`ts-seat-${table.label}`} label="Seat colour" value={style.seatColor} fallback="#d6006e"
          onChange={(v) => setStyle({ seatColor: v || '#d6006e' })} noReset
        />
      )}
    </div>
  );
}
