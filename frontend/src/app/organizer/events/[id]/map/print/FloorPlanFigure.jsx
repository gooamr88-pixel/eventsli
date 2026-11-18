'use client';

import {
  SEAT_RADIUS, tableBody, seatPositions, toWorld, normaliseShape, worldOf,
} from '../../../../../components/seating/seatingGeometry';
import TableBodyShape from '../../../../../components/seating/TableBodyShape';
import { paintOrder, zoneBox, zoneLabel } from '../../../../../components/seating/venueZones';
import { Outline } from '../../../../../components/seating/StyledZoneShape';
import { keyOf } from '../useMapDraft';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The floor plan, drawn for paper.
 *
 * ONE INK. Everything is `INK` on white, and that is not a stylistic
 * preference — half of these charts go through an office mono laser, where a
 * #5a5580 dance floor and a #46705a entrance both arrive as the same grey wash
 * sitting behind the one thing anybody is reading. So every distinction the
 * screen makes with colour is remade here with something a photocopier cannot
 * destroy: weight, dash pattern, whether a circle is filled or hollow, and
 * type size.
 *
 * Which is why this is a separate component from `EditorCanvas` rather than the
 * same one with a `print` flag. They share every coordinate — both read
 * `seatingGeometry`, so a table prints exactly where it was dragged — and agree
 * on nothing else. A flag would have meant a branch on almost every line.
 *
 * IT CANNOT CLIP. `preserveAspectRatio="xMidYMid meet"` scales the whole world
 * into whatever box it is handed, so a room that does not fit gets smaller
 * rather than getting cropped. The export this replaces cropped, and what fell
 * off the edge was tables.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const INK = '#101215';

export default function FloorPlanFigure({
  tables, zones, widthMm, heightMm, showSeats = true, showSold = true,
  // The venue's size: the plan prints the whole floor, whatever it is.
  world = worldOf(null),
}) {
  return (
    <svg
      viewBox={`0 0 ${world.width} ${world.height}`}
      preserveAspectRatio="xMidYMid meet"
      width={`${widthMm}mm`}
      height={`${heightMm}mm`}
      role="img"
      aria-label="Floor plan"
      style={{ display: 'block' }}
    >
      {/* The room's edge. The only rule on the page that is not an object in
          it, so it is the lightest thing drawn. */}
      <rect
        x={0.5} y={0.5} width={world.width - 1} height={world.height - 1}
        fill="none" stroke={INK} strokeWidth={1} opacity={0.35}
      />

      {paintOrder(zones).map((zone) => <PlanZone key={zone.id} zone={zone} world={world} />)}
      {tables.map((table) => (
        <PlanTable
          key={keyOf(table)}
          table={table}
          showSeats={showSeats}
          showSold={showSold}
          world={world}
        />
      ))}
    </svg>
  );
}

/**
 * A zone: dashed outline, name in caps.
 *
 * Dashed is what carries "this is floor, not a table" once the colour is gone,
 * and it is the same dash the screen uses — so the printed plan reads as the
 * same drawing rather than as a different document about the same room.
 */
function PlanZone({ zone, world }) {
  const box = zoneBox(zone, world);
  const label = zoneLabel(zone).toUpperCase();
  const fontSize = clamp(Math.min(box.w, box.h) / 3.4, 9, 17);
  const at = `translate(${box.cx} ${box.cy}) rotate(${box.rotation})`;

  // The room (2026-11-18): walls in solid ink, a door as the gap it is with
  // its name beside it, words on the floor as words.
  if (zone.kind === 'wall') {
    return <g transform={at}><rect x={-box.w / 2} y={-box.h / 2} width={box.w} height={box.h} fill={INK} /></g>;
  }
  if (zone.kind === 'door_gap') {
    return (
      <g transform={at}>
        <rect x={-box.w / 2} y={-box.h / 2 - 1} width={box.w} height={box.h + 2} fill="#ffffff" />
        <text x={0} y={-box.h / 2 - 5} textAnchor="middle" fill={INK} style={{ fontSize: 11, fontWeight: 700 }}>{label}</text>
      </g>
    );
  }
  if (zone.kind === 'text') {
    return (
      <g transform={at}>
        <text x={0} y={box.h * 0.2} textAnchor="middle" fill={INK} style={{ fontSize: clamp(box.h * 0.6, 8, 40), fontWeight: 700 }}>
          {zoneLabel(zone)}
        </text>
      </g>
    );
  }

  return (
    <g transform={at}>
      <Outline
        shape={zone.shape === 'rings' || zone.kind === 'decor' ? 'ellipse' : zone.shape || 'rounded'}
        w={box.w} h={box.h}
        // A very light wash, not the zone's colour: enough to read as a solid
        // area on a good printer, invisibly faint on a bad one, and never dark
        // enough to fight the label sitting on it.
        fill={INK} fillOpacity={0.045}
        stroke={INK} strokeWidth={1.1} dash="6 4"
      />
      <text
        x={0} y={fontSize * 0.34} textAnchor="middle"
        fill={INK}
        style={{ fontSize, fontWeight: 600, letterSpacing: '0.08em' }}
      >
        {label}
      </text>
    </g>
  );
}

/**
 * A table: its outline, its seats, its number.
 *
 * THE NUMBER IS THE POINT OF THE PAGE. It is set as large as the table can hold
 * — scaled to the shape rather than fixed, so a small round table does not have
 * its name spill over the seats — because this is the sheet an usher walks the
 * room with, and every other mark on it exists to help them find that numeral.
 *
 * A SOLD SEAT IS FILLED, A FREE ONE IS HOLLOW. Filled versus hollow is the one
 * distinction that survives a fax, a photocopy and a low-toner laser, which is
 * what this page is going to meet.
 */
function PlanTable({ table, showSeats, showSold, world }) {
  const pos = toWorld(table.position, world);
  const shape = normaliseShape(table.shape);
  const body = tableBody(shape, table.seatCount, table.style);
  const layout = seatPositions(shape, table.seatCount, table.style);
  const sold = showSold ? (Number(table.soldSeats) || 0) : 0;

  const numeral = clamp(Math.min(body.width, body.height || 40) / 2.4, 11, 30);

  return (
    <g transform={`translate(${pos.x} ${pos.y}) rotate(${pos.rotation})`}>
      {/* Shape only, never the organizer's colours: this page meets a mono laser. */}
      <TableBodyShape body={body} fill="#ffffff" stroke={INK} strokeWidth={1.4} />

      {showSeats && layout.map((point, index) => (
        <circle
          key={index}
          cx={point.x} cy={point.y} r={SEAT_RADIUS * 0.8}
          fill={index < sold ? INK : '#ffffff'}
          stroke={INK} strokeWidth={0.9}
        />
      ))}

      {/* A private table is not on the buyer's map at all, so whoever is
          holding this page is the only one who knows it exists. A rule under
          the name says so without needing a legend. */}
      {table.isPrivate && (
        <line
          x1={-body.width / 2} y1={numeral * 0.5} x2={body.width / 2} y2={numeral * 0.5}
          stroke={INK} strokeWidth={1} strokeDasharray="3 2"
        />
      )}

      <text
        transform={`translate(0 ${body.labelY || 0}) rotate(${-pos.rotation})`}
        x={0} y={numeral * 0.34} textAnchor="middle"
        fill={INK}
        style={{ fontSize: numeral, fontWeight: 700 }}
      >
        {table.label}
      </text>
    </g>
  );
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
