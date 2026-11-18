'use client';

import React from 'react';
import {
  SEAT_RADIUS, tableBody, seatPositions, toWorld, normaliseShape,
} from '../../../../components/seating/seatingGeometry';
import TableBodyShape from '../../../../components/seating/TableBodyShape';
import { inkOn, lookFont, tablePaint } from '../../../../components/seating/mapStyle';
import SelectionHandles from './SelectionHandles';
import { keyOf } from './useMapDraft';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One table on the editor's canvas.
 *
 * Extracted from `EditorCanvas` and memoized, and the memo is not premature. A
 * drag re-renders the canvas on every pointermove; without this, every frame
 * rebuilds all four hundred tables and their seat rings — a 400-table room at
 * ten seats each is four thousand circles per frame. With it, a frame touches
 * only the tables whose props actually changed, which during a drag is the ones
 * being dragged.
 *
 * NOTHING POSITIONAL IS DECIDED HERE. Every coordinate comes from
 * `seatingGeometry`, the same module the buyer's map reads — that is what makes
 * "a map saved by the organizer renders identically on the buyer's page" a
 * property of the code rather than a thing that happens to be true today.
 * `mapRoundTrip.test.jsx` fails if this file grows its own arithmetic.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const EditableTable = React.memo(function EditableTable({
  table, colour, seatColour, selected, showHandles, scale, sold, world, look = null,
  onPointerDown, onKeyDown, onRotateStart,
}) {
  const pos = toWorld(table.position, world);
  const shape = normaliseShape(table.shape);
  const body = tableBody(shape, table.seatCount, table.style);
  const layout = seatPositions(shape, table.seatCount, table.style);

  const inv = (n) => n / Math.max(scale, 0.0001);
  // The table's own colours, then its category's, then the map's look.
  const paint = tablePaint(table, look, { fill: colour });
  const fill = paint.fill || 'var(--es-surface)';
  const stroke = selected ? 'var(--es-accent)' : paint.stroke || (paint.fill ? 'none' : 'var(--es-border-strong)');
  const strokeWidth = selected ? inv(2) : paint.strokeWidth ?? inv(1.2);
  const font = lookFont(look);
  const seatPaint = paint.seat || seatColour || look?.seat || 'var(--es-seat-available)';

  return (
    <g
      transform={`translate(${pos.x} ${pos.y}) rotate(${pos.rotation})`}
      data-table-key={keyOf(table)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      style={{ cursor: 'move' }}
      role="button"
      tabIndex={0}
      aria-label={`Table ${table.label}, ${table.seatCount} seats${selected ? ', selected' : ''}`}
    >
      {/* Drawn UNDER the body so a click near a seat still grabs the table.
          Without it, the gaps between seats are dead space on a round table,
          which is most of its circumference. */}
      <circle
        r={Math.max(body.width, body.height) / 2 + SEAT_RADIUS * 2.5}
        fill="transparent"
      />

      {/* A halo rather than a thicker outline. The outline is the table's own
          edge and thickening it changes the shape the organizer is judging the
          layout by; a ring outside it reads as selection at any zoom without
          making a 10-top look like a 12-top. */}
      {selected && body.kind !== 'none' && (
        <SelectedHalo body={body} inv={inv} />
      )}

      <TableBodyShape body={body} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />

      {layout.map((point, index) => (
        <circle
          key={`${keyOf(table)}-s${index}`}
          cx={point.x} cy={point.y} r={SEAT_RADIUS}
          // Seats that have SOLD are drawn in the sold ink, and this is the
          // one thing on the editor's canvas that is not about layout: it is
          // why a table refuses to be deleted. Finding that out from a red
          // save error, after rearranging the room around it, is the version
          // of this that wastes an afternoon.
          fill={index < sold ? 'var(--es-seat-sold)' : seatPaint}
          opacity={0.9}
        />
      ))}

      {body.kind !== 'none' && (
        <text
          transform={`translate(0 ${body.labelY || 0}) rotate(${-pos.rotation})`}
          y={4} textAnchor="middle"
          className={paint.label || paint.fill ? 'es-layer-label' : 'fill-ink es-layer-label'}
          fill={paint.label || inkOn(paint.fill) || undefined}
          style={{ fontSize: shape === 'high_top' ? 11 : 14, fontWeight: font.fontWeight, fontFamily: font.fontFamily, pointerEvents: 'none' }}
        >
          {table.label}
        </text>
      )}

      {/* A private table is invisible to buyers until unlocked, and nothing
          else on the canvas says so. */}
      {table.isPrivate && (
        <text
          y={body.kind === 'none' ? 4 : -body.height / 2 - SEAT_RADIUS * 3}
          textAnchor="middle"
          style={{ fontSize: 12, pointerEvents: 'none' }}
          aria-hidden="true"
        >
          🔒
        </text>
      )}

      {showHandles && (
        <SelectionHandles
          width={body.width}
          height={body.height || SEAT_RADIUS * 2}
          scale={scale}
          resizable={false}
          onRotateStart={onRotateStart}
        />
      )}
    </g>
  );
}, (a, b) => (
  // Hand-written rather than shallow-default because `table` is replaced
  // wholesale on every edit and the rest are primitives — so this is the
  // shallow comparison, stated, minus the handler identities that change on
  // every parent render and would defeat the memo entirely.
  a.table === b.table && a.colour === b.colour && a.seatColour === b.seatColour && a.look === b.look && a.selected === b.selected
  && a.showHandles === b.showHandles && a.scale === b.scale && a.sold === b.sold && a.world === b.world
));

export default EditableTable;

/** The selection ring, outside the table's own edge. */
function SelectedHalo({ body, inv }) {
  return (
    <TableBodyShape
      body={body} pad={inv(4)}
      fill="none" stroke="var(--es-accent)" strokeWidth={inv(1.5)} opacity={0.45}
    />
  );
}
