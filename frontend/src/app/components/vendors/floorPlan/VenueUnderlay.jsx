'use client';

import { useMemo } from 'react';
import {
  SEAT_RADIUS, normaliseShape, seatPositions, tableBody, tableScale, toWorld, worldOf,
} from '../../seating/seatingGeometry';
import { readZones } from '../../seating/layoutZones';
import { paintOrder } from '../../seating/venueZones';
import { withTableStyles } from '../../seating/mapStyle';
import ZoneShape from '../../seating/ZoneShape';
import TableBodyShape from '../../seating/TableBodyShape';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SEAT MAP UNDER THE BOOTHS (2026-11-22). Where a reserved-seating event's
 * booths are drawn on its venue map (`plan.onSeatMap`), every vendor view —
 * the public vendor page, a vendor's own booking, the organizer's booth
 * picker — draws the room first: its floor, its zones (stage, walls, doors,
 * bars) and its tables with their seats, quietly, so the booths stay what
 * the eye goes to. Nothing here is interactive; seats are not for sale here.
 *
 * `venue` is `vendorService.seatMapContext`: { world, zones, look, tableStyles,
 * tables: [{ label, seatCount, shape, position }] }, in the same world the
 * booths are in (the plan's width and height are that world).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function venueWorld(venue) {
  return worldOf({ world: venue?.world || undefined });
}

export default function VenueUnderlay({ venue }) {
  const world = useMemo(() => venueWorld(venue), [venue]);
  const layout = useMemo(() => ({ world, zones: venue?.zones || [], tableStyles: venue?.tableStyles || undefined }), [venue, world]);
  const zones = useMemo(() => readZones(layout), [layout]);
  const tables = useMemo(() => withTableStyles(venue?.tables || [], layout), [venue, layout]);
  const look = venue?.look || null;

  return (
    <g aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <rect x={0} y={0} width={world.width} height={world.height} fill={look?.floor || '#ffffff'} />
      {paintOrder(zones).map((zone) => <ZoneShape key={zone.id} zone={zone} world={world} look={look} />)}
      <g opacity={0.55}>
        {tables.map((table) => <QuietTable key={table.label} table={table} world={world} look={look} />)}
      </g>
    </g>
  );
}

/** A table and its seats, drawn as context: outline, hollow seats, its name. */
function QuietTable({ table, world, look }) {
  const pos = toWorld(table.position, world);
  const shape = normaliseShape(table.shape);
  const body = tableBody(shape, table.seatCount, table.style);
  const seats = seatPositions(shape, table.seatCount, table.style);
  const size = tableScale(table.style);
  const ink = look?.label || '#3a3a44';
  const font = Math.max(8, Math.min(16, Math.min(body.width, body.height || 40) / 2.6));
  return (
    <g transform={`translate(${pos.x} ${pos.y}) rotate(${pos.rotation}) scale(${size})`}>
      <TableBodyShape body={body} fill={table.style?.fill || look?.table || '#f4f4f6'} stroke="#8a8a94" strokeWidth={1} />
      {seats.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={SEAT_RADIUS * 0.75} fill="#ffffff" stroke="#8a8a94" strokeWidth={0.8} />
      ))}
      {shape !== 'row' && (
        <text
          transform={`translate(0 ${body.labelY || 0}) rotate(${-pos.rotation})`}
          x={0} y={font * 0.34} textAnchor="middle" fill={ink} style={{ fontSize: font, fontWeight: 600 }}
        >
          {table.label}
        </text>
      )}
    </g>
  );
}
