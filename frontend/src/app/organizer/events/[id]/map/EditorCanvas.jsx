'use client';

import { useMemo } from 'react';
import {
  WORLD, SEAT_PITCH, SEAT_RADIUS, tableBody, toWorld, toPercent,
} from '../../../../components/seating/seatingGeometry';
import { zoneBox } from '../../../../components/seating/venueZones';
import ZoneShape from '../../../../components/seating/ZoneShape';
import EditableTable from './EditableTable';
import SelectionHandles from './SelectionHandles';
import { SNAP_WORLD } from './useCanvasInteraction';
import { keyOf } from './useMapDraft';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The organizer's canvas.
 *
 * Every position, shape and seat placement comes from `seatingGeometry.js` —
 * the same module the buyer's `SeatMapCanvas` uses, and the same module its
 * zone counterpart `venueZones.js` is paired with. That is the whole point of
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
 *
 * THIS COMPONENT DRAWS AND NOTHING ELSE. The viewport lives in `usePanZoom` and
 * the gestures in `useCanvasInteraction`, both owned by `MapEditor` — because
 * the toolbar needs the zoom controls and the keyboard needs the gestures, and
 * a canvas that owned them would have to publish them back upward through a ref.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const EDITOR_BOUNDS = Object.freeze({ x: 0, y: 0, width: WORLD.width, height: WORLD.height });

/** How far outside the viewport an element is still drawn. Generous on purpose:
 *  the cost of a few extra tables is nothing, and the cost of getting it wrong
 *  is an element popping into existence at the edge as you pan onto it. */
const CULL_MARGIN = 120;

export default function EditorCanvas({
  tables, zones, categories, soldByTable,
  selection, panzoom, interaction,
  tool, spacePan, snapToGrid,
  onAddAt, onNudge,
  className = '',
}) {
  const { svgRef, view, handlers } = panzoom;
  const scale = WORLD.width / Math.max(view.width, 1);

  const colourOf = useMemo(() => {
    const map = new Map((categories || []).map((c) => [c.id, c.color]));
    return (categoryId) => map.get(categoryId) || null;
  }, [categories]);

  /**
   * Only what is on screen, plus a margin.
   *
   * A 400-table room is four thousand seat circles; drawing the ones nobody can
   * see costs a frame budget the drag needs. Recomputed per view change rather
   * than per frame of a drag — `view` only changes when the map is actually
   * panned or zoomed, which is not what a table drag does.
   */
  const visible = useMemo(() => {
    const left = view.x - CULL_MARGIN;
    const right = view.x + view.width + CULL_MARGIN;
    const top = view.y - CULL_MARGIN;
    const bottom = view.y + view.height + CULL_MARGIN;

    return {
      tables: tables.filter((t) => {
        const { x, y } = toWorld(t.position);
        const body = tableBody(t.shape, t.seatCount);
        const reach = Math.max(body.width, body.height) / 2 + SEAT_PITCH + SEAT_RADIUS;
        return x + reach >= left && x - reach <= right && y + reach >= top && y - reach <= bottom;
      }),
      zones: zones.filter((z) => {
        const b = zoneBox(z, WORLD);
        return b.right >= left && b.x <= right && b.bottom >= top && b.y <= bottom;
      }),
    };
  }, [tables, zones, view]);

  const soleZone = selection.selection.zones.size === 1 && selection.selection.tables.size === 0
    ? [...selection.selection.zones][0] : null;
  const soleTable = selection.selection.tables.size === 1 && selection.selection.zones.size === 0
    ? [...selection.selection.tables][0] : null;

  const cursor = tool === 'hand' || spacePan ? 'grab' : 'crosshair';

  return (
    <div className={`relative ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        className="block h-full w-full select-none rounded-(--es-radius-lg) border border-border-base bg-bg-sunken"
        style={{ touchAction: 'none', overscrollBehavior: 'contain', cursor }}
        role="application"
        aria-label="Seat map editor"
        {...handlers}
        onPointerDown={(e) => {
          // The marquee gets first refusal. When it takes the gesture the pan
          // must not also start — otherwise the box is drawn while the map
          // slides underneath it and the two disagree about what was swept.
          if (interaction.onBackgroundPointerDown(e)) return;
          handlers.onPointerDown(e);
        }}
        // Right-drag pans, so the menu that would otherwise open on release has
        // to be suppressed — without this the pan works and ends with a context
        // menu over the map every time.
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          onAddAt(toPercent(
            view.x + ((e.clientX - rect.left) / rect.width) * view.width,
            view.y + ((e.clientY - rect.top) / rect.height) * view.height,
          ));
        }}
      >
        <defs>
          {/* The alignment grid, and it appears only while Snap is on. A grid
              drawn all the time is decoration that competes with the layout;
              drawn only when it is live, it is feedback — it says what the next
              drag will lock to. */}
          <pattern id="es-map-grid" width={SNAP_WORLD} height={SNAP_WORLD} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={1} fill="var(--es-border-strong)" opacity={0.55} />
          </pattern>
        </defs>

        {snapToGrid && (
          <rect
            x={0} y={0} width={WORLD.width} height={WORLD.height}
            fill="url(#es-map-grid)" style={{ pointerEvents: 'none' }}
          />
        )}

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

        {/* ZONES FIRST — SVG has no z-index, so paint order is the only thing
            that keeps a dance floor from covering the seats around it. */}
        {visible.zones.map((zone) => (
          <ZoneShape
            key={zone.id}
            zone={zone}
            selected={selection.has('zone', zone.id)}
            interactive
            scale={scale}
            onPointerDown={(e) => interaction.onElementPointerDown(e, 'zone', zone.id)}
            onKeyDown={(e) => onNudge(e, 'zone', zone.id)}
          >
            {soleZone === zone.id && (
              <SelectionHandles
                width={zoneBox(zone, WORLD).w}
                height={zoneBox(zone, WORLD).h}
                scale={scale}
                resizable
                onRotateStart={(e) => interaction.onRotateStart(e, 'zone', zone.id)}
                onResizeStart={(e) => interaction.onResizeStart(e, zone.id)}
              />
            )}
          </ZoneShape>
        ))}

        {visible.tables.map((table) => (
          <EditableTable
            key={keyOf(table)}
            table={table}
            colour={colourOf(table.categoryId)}
            selected={selection.has('table', keyOf(table))}
            // Handles only when ONE thing is selected. A "select all" that
            // sprouted a rotate grip on every table would bury the map under
            // its own controls.
            showHandles={soleTable === keyOf(table)}
            scale={scale}
            sold={soldByTable?.get(keyOf(table)) || 0}
            onPointerDown={(e) => interaction.onElementPointerDown(e, 'table', keyOf(table))}
            onKeyDown={(e) => onNudge(e, 'table', keyOf(table))}
            onRotateStart={(e) => interaction.onRotateStart(e, 'table', keyOf(table))}
          />
        ))}
      </svg>

      {/* The marquee is drawn as an overlay in SCREEN pixels, which is the same
          space it is tracked and hit-tested in. Drawing it inside the SVG would
          mean converting to world units on every frame and converting back on
          release — two chances for the box you saw and the box that selected to
          disagree. */}
      {interaction.marquee && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-sm border border-dashed border-accent bg-accent/10"
          style={{
            left: Math.min(interaction.marquee.x0, interaction.marquee.x1),
            top: Math.min(interaction.marquee.y0, interaction.marquee.y1),
            width: Math.abs(interaction.marquee.x1 - interaction.marquee.x0),
            height: Math.abs(interaction.marquee.y1 - interaction.marquee.y0),
          }}
        />
      )}

      {tables.length === 0 && zones.length === 0 && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-subtle">
          Add tables and venue zones, or double-click the floor to drop a table.
        </p>
      )}

      <p className="absolute bottom-3 left-3 max-w-[60%] text-xs text-subtle">
        Scroll to move · Ctrl+scroll to zoom · drag the floor to box-select · space or the Move tool to pan
      </p>
    </div>
  );
}
