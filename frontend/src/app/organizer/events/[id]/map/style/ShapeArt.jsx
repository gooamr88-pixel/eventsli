'use client';

import { tableBody, seatPositions } from '../../../../../components/seating/seatingGeometry';
import TableBodyShape from '../../../../../components/seating/TableBodyShape';

/**
 * A miniature of a table shape, drawn by the same functions that draw it on the
 * map — so a tile cannot promise a silhouette the canvas then contradicts.
 * `seats` adds the seat dots (the style panel's preview); the Add dialog's
 * tiles draw the outline alone.
 */
export default function ShapeArt({ shape, size = 28, seatCount = 8, style = null, seats = false, fill = 'none', seatFill = 'currentColor' }) {
  const body = tableBody(shape, seatCount, style);
  const points = seats || body.kind === 'none' ? seatPositions(shape, seatCount, style) : [];
  // Fit the body (and its seats, when drawn) into the tile.
  const reach = points.reduce(
    (m, p) => Math.max(m, Math.abs(p.x) + 10, Math.abs(p.y) + 10),
    Math.max(body.width, body.height) / 2,
  );
  const k = (size / 2 - 1) / Math.max(reach, 1);

  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden="true">
      <g transform={`scale(${k})`}>
        <TableBodyShape body={body} fill={fill} stroke="currentColor" strokeWidth={1.4 / k} />
        {points.map((p, i) => (
           
          <circle key={i} cx={p.x} cy={p.y} r={body.kind === 'none' ? 7 : 6.5} fill={seatFill} />
        ))}
      </g>
    </svg>
  );
}
