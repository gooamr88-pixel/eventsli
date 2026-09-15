'use client';

import { useCallback, useMemo, useRef } from 'react';
import {
  WORLD, SEAT_RADIUS, tableBody, seatPositions, toWorld, toPercent, normaliseShape,
} from '../../../../components/seating/seatingGeometry';
import { usePanZoom } from '../../../../components/seating/usePanZoom';
import { keyOf } from './useMapDraft';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The organizer's canvas.
 *
 * Every position, shape and seat placement comes from `seatingGeometry.js` —
 * the same module the buyer's `SeatMapCanvas` uses. That is the whole point of
 * the contract test: a table dragged here has to land in exactly the same place
 * over there, and the only way to guarantee that is for neither view to own the
 * arithmetic.
 *
 * ONE DELIBERATE DIFFERENCE from the buyer's canvas: the viewport is framed to
 * the whole WORLD rather than to the content. Two reasons, and the second is a
 * bug avoided —
 *
 *   1. An organizer is laying out a room, so they need the empty floor as much
 *      as the tables. Framing the content would hide the space they are
 *      arranging things into.
 *   2. `usePanZoom` re-frames whenever `bounds` changes identity. Content
 *      bounds are recomputed from table positions, so on a content-framed
 *      editor the view would snap back on EVERY FRAME of a drag.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const EDITOR_BOUNDS = Object.freeze({ x: 0, y: 0, width: WORLD.width, height: WORLD.height });

export default function EditorCanvas({
  tables, categories, selectedKey, onSelect, onMove, onAddAt, className = '',
}) {
  const { svgRef, view, fit, zoomIn, zoomOut, handlers } = usePanZoom(EDITOR_BOUNDS);

  // The drag in progress. A ref, not state: this changes on every pointermove
  // and re-rendering the whole map per frame drops a 200-table room to single
  // digit frame rates.
  const drag = useRef(null);

  const colourOf = useMemo(() => {
    const map = new Map((categories || []).map((c) => [c.id, c.color]));
    return (categoryId) => map.get(categoryId) || null;
  }, [categories]);

  /** Screen pixels → world units, through the CURRENT viewBox. */
  const toWorldPoint = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: view.x + ((clientX - rect.left) / rect.width) * view.width,
      y: view.y + ((clientY - rect.top) / rect.height) * view.height,
    };
  }, [svgRef, view]);

  const startDrag = useCallback((e, table) => {
    // Stops usePanZoom from also treating this as a pan. Without it the table
    // moves AND the canvas slides underneath it, at double speed.
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);

    const point = toWorldPoint(e.clientX, e.clientY);
    const origin = toWorld(table.position);

    drag.current = {
      key: keyOf(table),
      pointerId: e.pointerId,
      // The grab offset, so the table does not jump so its centre is under the
      // cursor the instant it is picked up.
      dx: origin.x - point.x,
      dy: origin.y - point.y,
      moved: false,
    };
    onSelect(keyOf(table));
  }, [toWorldPoint, onSelect]);

  const moveDrag = useCallback((e) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();

    const point = toWorldPoint(e.clientX, e.clientY);
    // `transient` — one history entry for the whole drag, not one per frame.
    // Undo has to step back a table, not a pixel.
    onMove(d.key, toPercent(point.x + d.dx, point.y + d.dy), { transient: d.moved });
    d.moved = true;
  }, [toWorldPoint, onMove]);

  const endDrag = useCallback((e) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  }, []);

  return (
    <div className={`relative ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        className="block h-full w-full select-none rounded-(--es-radius-lg) border border-border-base bg-bg-sunken"
        style={{ touchAction: 'none', overscrollBehavior: 'contain', cursor: 'grab' }}
        role="application"
        aria-label="Seat map editor"
        {...handlers}
        onPointerMove={(e) => { moveDrag(e); handlers.onPointerMove(e); }}
        onPointerUp={(e) => { endDrag(e); handlers.onPointerUp(e); }}
        onPointerCancel={(e) => { endDrag(e); handlers.onPointerCancel(e); }}
        onDoubleClick={(e) => {
          const p = toWorldPoint(e.clientX, e.clientY);
          onAddAt(toPercent(p.x, p.y));
        }}
      >
        {/* The floor. Its edges are where `toPercent` clamps to, so drawing it
            tells the organizer where the room actually ends — without it,
            dragging past the boundary just stops for no visible reason. */}
        <rect
          x={0} y={0} width={WORLD.width} height={WORLD.height}
          fill="none"
          stroke="var(--es-border-strong)"
          strokeWidth={2}
          strokeDasharray="8 6"
        />

        {tables.map((table) => (
          <EditableTable
            key={keyOf(table)}
            table={table}
            colour={colourOf(table.categoryId)}
            selected={keyOf(table) === selectedKey}
            onPointerDown={(e) => startDrag(e, table)}
            onKeyDown={(e) => handleTableKey(e, table, { onSelect, onMove })}
          />
        ))}
      </svg>

      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <MapButton onClick={zoomIn} label="Zoom in">+</MapButton>
        <MapButton onClick={zoomOut} label="Zoom out">−</MapButton>
        <MapButton onClick={fit} label="Fit the whole room">⤢</MapButton>
      </div>

      <p className="absolute bottom-3 left-3 text-xs text-subtle">
        Drag or use arrow keys to move · double-click the floor or use Add table
      </p>
    </div>
  );
}

/**
 * The keyboard for a focused table. Tables were focusable and announced as
 * buttons, and ignored every key — the editor was mouse-only.
 *
 * Enter or Space selects it for the side panel. Arrows move it one percent of
 * the room (Shift: five), and a run of moves on one table is ONE undo step.
 */
function handleTableKey(e, table, { onSelect, onMove }) {
  const key = keyOf(table);
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onSelect(key);
    return;
  }
  const step = e.shiftKey ? 5 : 1;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!delta) return;
  e.preventDefault();
  onSelect(key);
  const clamp = (n) => Math.min(100, Math.max(0, n));
  onMove(key, {
    x: clamp((table.position?.x ?? 0) + delta[0]),
    y: clamp((table.position?.y ?? 0) + delta[1]),
  }, { mergeKey: `${key}:nudge` });
}

function MapButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-10 w-10 place-items-center rounded-(--es-radius-md) border border-border-strong bg-surface text-lg text-ink shadow-sm transition-colors hover:bg-bg-sunken"
    >
      {children}
    </button>
  );
}

function EditableTable({ table, colour, selected, onPointerDown, onKeyDown }) {
  const pos = toWorld(table.position);
  const shape = normaliseShape(table.shape);
  const body = tableBody(shape, table.seatCount);
  const layout = seatPositions(shape, table.seatCount);

  const fill = colour || 'var(--es-surface)';
  const stroke = selected ? 'var(--es-accent)' : 'var(--es-border-strong)';

  return (
    <g
      transform={`translate(${pos.x} ${pos.y}) rotate(${pos.rotation})`}
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

      {body.kind === 'ellipse' && (
        <ellipse rx={body.width / 2} ry={body.height / 2} fill={fill} stroke={stroke} strokeWidth={selected ? 3 : 1.5} />
      )}
      {body.kind === 'rect' && (
        <rect
          x={-body.width / 2} y={-body.height / 2}
          width={body.width} height={body.height} rx={body.rx}
          fill={fill} stroke={stroke} strokeWidth={selected ? 3 : 1.5}
        />
      )}

      {layout.map((point, index) => (
        <circle
          key={`${keyOf(table)}-s${index}`}
          cx={point.x} cy={point.y} r={SEAT_RADIUS}
          fill="var(--es-seat-available)"
          opacity={0.9}
        />
      ))}

      {body.kind !== 'none' && (
        <text
          y={4} textAnchor="middle" className="fill-ink"
          style={{ fontSize: 14, fontWeight: 500, pointerEvents: 'none' }}
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
        >
          🔒
        </text>
      )}
    </g>
  );
}
