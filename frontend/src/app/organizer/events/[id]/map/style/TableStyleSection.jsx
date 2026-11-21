'use client';

import { useState } from 'react';
import { SHAPES, TABLE_SCALE, sideCounts, tableScale } from '../../../../../components/seating/seatingGeometry';
import { SHAPE_SIDES, sideLabel } from '../../../../../components/seating/tableSides';
import { SHAPE_NAMES, SHAPE_HINTS } from '../shapeNames';
import ShapeArt from './ShapeArt';
import { ColourField, RangeField, Stepper, Toggle } from '../../../../../components/inspector/fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * How one table is built and how it looks (2026-11-18, the owner's floor-plan
 * reference), in three parts the table inspector places separately
 * (2026-11-21):
 *
 *   ShapePicker     the table's shape — structural, so it sits with the seats.
 *   SeatsPerSide    how many seats on each side — it IS the seat count.
 *   TableAppearance size, colours, border, corners — cosmetic, folded away.
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

/** Merges into the style; a null value removes that key (back to default). */
function styleSetter(table, onChange) {
  const style = table.style || {};
  return (patch, extra = {}) => {
    const next = { ...style };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete next[k]; else next[k] = v;
    }
    onChange({ ...extra, style: Object.keys(next).length ? next : null });
  };
}

const shapeOf = (table) => (SHAPES.includes(table.shape) ? table.shape : 'round');

/**
 * The five shapes most rooms are made of come first (2026-11-21); the other
 * seven — D-shapes, U-shapes, hexagons — wait behind "More shapes", unless the
 * table already is one of them. Twelve tiles at once was a wall of choices
 * for an organizer who wanted a round table.
 */
// The catalogue lists them first (seatingGeometry.SHAPES: round, oval, rect,
// square, row), and is the only place shapes may be named — so: its first five.
const COMMON_SHAPES = SHAPES.slice(0, 5);

export function ShapePicker({ table, onChange }) {
  const shape = shapeOf(table);
  const setStyle = styleSetter(table, onChange);
  const [all, setAll] = useState(() => !COMMON_SHAPES.includes(shape));
  const shown = all ? SHAPES : COMMON_SHAPES;
  return (
    <div role="group" aria-label="Table shape" className="es-shapegrid">
      {shown.map((s) => (
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
          <ShapeArt shape={s} size={24} />
          <span>{SHAPE_NAMES[s] || s}</span>
        </button>
      ))}
      {!all && (
        <button type="button" className="es-shapegrid__tile es-shapegrid__tile--more" onClick={() => setAll(true)} aria-expanded={false}>
          <span className="es-shapegrid__plus" aria-hidden="true">+7</span>
          <span>More shapes</span>
        </button>
      )}
    </div>
  );
}

/** Nothing for shapes whose seats go all the way round (round, oval…). */
export function SeatsPerSide({ table, onChange, sold = 0 }) {
  const style = table.style || {};
  const shape = shapeOf(table);
  const sided = SHAPE_SIDES[shape];
  if (!sided) return null;
  const counts = sideCounts(shape, table.seatCount, style);
  const setStyle = styleSetter(table, onChange);

  const setSide = (index, value) => {
    const next = counts.slice();
    next[index] = Math.max(0, value);
    const total = next.reduce((a, b) => a + b, 0);
    if (total < 1 || total > MAX_SEATS) return;
    const sides = {};
    ['top', 'right', 'bottom', 'left'].forEach((name, i) => { if (sided.includes(i)) sides[name] = next[i]; });
    setStyle({ sides }, { seatCount: total });
  };

  return (
    <div className="es-sides">
      <span className="es-sides__art">
        <ShapeArt shape={shape} seatCount={table.seatCount} style={style} seats size={88} fill={style.fill || '#9a9a9a'} seatFill={style.seatColor || 'var(--es-brand-coral)'} />
      </span>
      <div className="es-sides__list">
        <p className="es-field__label">Seats on each side</p>
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
        {style.sides && (
          <button type="button" className="es-linkbtn self-start text-xs" onClick={() => setStyle({ sides: null })}>
            Spread evenly
          </button>
        )}
      </div>
    </div>
  );
}

export function TableAppearance({ table, onChange }) {
  const style = table.style || {};
  const shape = shapeOf(table);
  const setStyle = styleSetter(table, onChange);
  const rectish = shape === 'rect' || shape === 'square';

  return (
    <>
      {/* 2026-11-19: "resize the tables, make them smaller to fit more". The
          whole table and its seats, on every view (seatingGeometry.tableScale). */}
      <RangeField
        label="Table size" min={TABLE_SCALE.min * 100} max={TABLE_SCALE.max * 100} step={5}
        value={Math.round(tableScale(style) * 100)}
        format={(v) => `${v}%`}
        hint="Smaller tables fit more in the room; seats shrink with them."
        onChange={(v) => setStyle({ scale: v === 100 ? null : v / 100 })}
      />
      <ColourField label="Table colour" value={style.fill} fallback="#8c8c8c" onChange={(v) => setStyle({ fill: v })} emptyText="Map look" />
      <ColourField label="Name colour" value={style.labelColor} fallback="#10303d" onChange={(v) => setStyle({ labelColor: v })} emptyText="Map look" />
      <ColourField label="Border" value={style.stroke} fallback="#111018" onChange={(v) => setStyle({ stroke: v })} emptyText="None" />
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
      <Toggle
        label="Seats follow ticket type colour"
        hint={style.seatColor ? null : 'Taken seats are always grey.'}
        checked={!style.seatColor}
        onChange={(on) => setStyle({ seatColor: on ? null : '#d6006e' })}
      />
      {style.seatColor && (
        <ColourField
          label="Seat colour" value={style.seatColor} fallback="#d6006e"
          onChange={(v) => setStyle({ seatColor: v || '#d6006e' })} noReset
        />
      )}
    </>
  );
}

/** What the folded Appearance section says about itself. */
export function appearanceSummary(table) {
  const style = table.style || {};
  const parts = [`${Math.round(tableScale(style) * 100)}%`];
  if (style.fill || style.labelColor || style.stroke || style.seatColor) parts.push('own colours');
  return parts.join(' · ');
}
