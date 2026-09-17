'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WORLD, SEAT_PITCH, SEAT_RADIUS, tableBody, toWorld,
} from '../../../../components/seating/seatingGeometry';
import { zoneBox } from '../../../../components/seating/venueZones';
import { keyOf } from './useMapDraft';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Every pointer gesture on the canvas, as one state machine.
 *
 * Move, group-move, marquee, rotate, resize. Pan is the one gesture NOT here —
 * `usePanZoom` owns it, because the buyer's map needs panning and needs none of
 * the rest.
 *
 *
 * WHY THE LISTENERS ARE ON `window` AND BOUND EXACTLY ONCE
 *
 * A gesture that starts on an element must survive the pointer leaving it —
 * leaving the canvas, leaving the browser window. Bound to the element, a drag
 * ends wherever the cursor happens to cross a border, which on a map you are
 * dragging a table to the edge of is most drags.
 *
 * Bound once, with `[]` deps, because re-binding mid-gesture drops it. That is
 * why nothing below closes over a prop or a state value: every one is read
 * through `latest`, which is re-assigned during render and therefore current by
 * the time any handler runs. A captured `view` here would mean a drag that
 * ignores the zoom the auto-pan just changed.
 *
 *
 * WHAT MAKES A DRAG ONE UNDO STEP
 *
 * The first frame commits to history; every frame after it is `transient`, so
 * it replaces the value without recording. Ctrl+Z after a drag steps back the
 * whole drag, not one pixel of it. `useMapDraft` documents the mechanism.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The grid "Snap to grid" snaps to, in world units. 20 is a little under half
 *  a small round table, so a snapped row reads as deliberate rather than as the
 *  same position it would have had anyway. */
export const SNAP_WORLD = 20;

/** How far the pointer must travel before a press becomes a drag. Without it,
 *  the tremor in an ordinary click nudges a table by a fraction of a percent —
 *  invisible, but enough to mark the map dirty and stage a save. */
const DRAG_SLOP_PX = 3;

/** Edge auto-pan: how close to the edge it starts, and its top speed. Without
 *  it, moving a table further than one screenful means drop, pan, pick up
 *  again — and on a 1000-unit-wide room that is most moves. */
const EDGE_PX = 52;
const EDGE_MAX_SPEED = 15;

export function useCanvasInteraction({
  svgRef, view, panByScreen, draft, selection, snapToGrid, toolRef, spacePanRef,
}) {
  // The marquee is STATE, because it is drawn. Everything else about a gesture
  // is a ref: it changes on every pointermove, and re-rendering a 400-table
  // room per frame is single-digit frame rates.
  const [marquee, setMarquee] = useState(null);
  const [dragging, setDragging] = useState(false);

  const gesture = useRef(null);
  const pointer = useRef({ x: 0, y: 0 });

  /**
   * Everything the once-bound handlers need, kept current without re-binding
   * them. Synced in an effect rather than in the render body, because React's
   * compiler refuses a ref write during render — a render has to be pure for it
   * to be safe to re-run. The effect runs after the commit, well before any
   * pointer event can arrive.
   */
  const latest = useRef({ view, draft, selection, snapToGrid, svgRef, panByScreen });
  useEffect(() => {
    latest.current = { view, draft, selection, snapToGrid, svgRef, panByScreen };
  });

  /** Screen pixels → world units, through the CURRENT viewBox. */
  const toWorldPoint = useCallback((clientX, clientY) => {
    const { view: v, svgRef: ref } = latest.current;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !rect.width) return { x: 0, y: 0 };
    return {
      x: v.x + ((clientX - rect.left) / rect.width) * v.width,
      y: v.y + ((clientY - rect.top) / rect.height) * v.height,
    };
  }, []);

  /* ── starting a gesture ─────────────────────────────────────────────────── */

  /** Captures where everything in the selection started, so every frame can be
   *  computed from the origin rather than from the frame before it. */
  const beginMove = useCallback((e, active) => {
    const { draft: d } = latest.current;
    const origins = [];
    let minX = 100; let minY = 100; let maxX = 0; let maxY = 0;

    for (const t of d.tables) {
      if (!active.tables.has(keyOf(t))) continue;
      const x = t.position?.x || 0; const y = t.position?.y || 0;
      origins.push({ kind: 'table', id: keyOf(t), x, y });
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    for (const z of d.zones) {
      if (!active.zones.has(z.id)) continue;
      origins.push({ kind: 'zone', id: z.id, x: z.x, y: z.y });
      minX = Math.min(minX, z.x); maxX = Math.max(maxX, z.x);
      minY = Math.min(minY, z.y); maxY = Math.max(maxY, z.y);
    }
    if (origins.length === 0) return;

    gesture.current = {
      mode: 'move',
      origins,
      // The room the group has left before it hits a wall. Clamping the DELTA
      // rather than each element keeps the formation rigid: the whole group
      // stops at the edge instead of collapsing into it one table at a time.
      limits: { minDx: -minX, maxDx: 100 - maxX, minDy: -minY, maxDy: 100 - maxY },
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    pointer.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  }, []);

  /**
   * Pressing on a table or a zone.
   *
   * The selection rule is the one every layout tool converged on, and each
   * branch fixes something the others break:
   *
   *   • Ctrl/Cmd/Shift-click TOGGLES and starts no drag — it is a selection
   *     edit, and dragging on it would move the group you were still building.
   *   • Pressing something ALREADY in a multi-selection keeps the selection, so
   *     the press can drag the whole group. Collapsing to the one element under
   *     the cursor here is the classic bug: you grab a formation of twelve and
   *     move one.
   *   • Anything else selects just that one.
   */
  const onElementPointerDown = useCallback((e, kind, id) => {
    if (e.button !== 0) return;
    // Stops `usePanZoom` treating this as a pan as well — without it the table
    // moves AND the canvas slides underneath it, at double speed.
    e.stopPropagation();

    const sel = latest.current.selection;

    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      sel.toggle(kind, id);
      return;
    }

    const alreadyGrouped = sel.ref.current.tables.size + sel.ref.current.zones.size > 1 && sel.has(kind, id);
    if (!alreadyGrouped) sel.selectOnly(kind, id);

    const active = alreadyGrouped
      ? sel.ref.current
      : (kind === 'zone'
        ? { tables: new Set(), zones: new Set([id]) }
        : { tables: new Set([id]), zones: new Set() });

    beginMove(e, active);
  }, [beginMove]);

  /**
   * Pressing the background: a marquee, or a pan.
   *
   * Pan wins on the Hand tool, on a held space bar, and on the middle or right
   * button — four ways to reach the same gesture, because the one that is
   * available depends entirely on the hardware in front of the organizer. A
   * trackpad has no middle button; a mouse user never learns the space bar.
   *
   * Returns true when it took the gesture, so the caller knows not to let
   * `usePanZoom` have it too.
   */
  const onBackgroundPointerDown = useCallback((e) => {
    const wantsPan = e.button === 1 || e.button === 2
      || spacePanRef.current || toolRef.current === 'hand';
    if (wantsPan) return false;
    if (e.button !== 0) return false;

    const rect = latest.current.svgRef.current?.getBoundingClientRect();
    if (!rect) return false;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    gesture.current = {
      mode: 'marquee',
      rect: { x0: x, y0: y, x1: x, y1: y },
      // Shift ADDS to the selection instead of replacing it, so a room can be
      // swept up in several passes around the furniture in between.
      additive: e.shiftKey,
      moved: false,
    };
    pointer.current = { x: e.clientX, y: e.clientY };
    setMarquee(gesture.current.rect);
    return true;
  }, [spacePanRef, toolRef]);

  const onRotateStart = useCallback((e, kind, id) => {
    e.stopPropagation();
    e.preventDefault();
    const { draft: d } = latest.current;
    const centre = centreOf(d, kind, id);
    if (!centre) return;
    gesture.current = { mode: 'rotate', kind, id, centre, moved: false };
    setDragging(true);
  }, []);

  const onResizeStart = useCallback((e, id) => {
    e.stopPropagation();
    e.preventDefault();
    gesture.current = { mode: 'resize', id, moved: false };
    setDragging(true);
  }, []);

  /* ── the gesture, frame by frame ────────────────────────────────────────── */

  /**
   * Applies the move for a pointer position. Called both by real pointermove
   * events and by the auto-pan loop — the loop has to re-apply it after each
   * pan step, because panning moves the world under a stationary cursor and the
   * dragged element has to follow the cursor's WORLD position, not its screen
   * position.
   */
  const applyMoveAt = useCallback((clientX, clientY) => {
    const g = gesture.current;
    if (!g || g.mode !== 'move') return;
    const { draft: d, snapToGrid: snap } = latest.current;

    const from = toWorldPoint(g.startX, g.startY);
    const to = toWorldPoint(clientX, clientY);
    let dx = ((to.x - from.x) / WORLD.width) * 100;
    let dy = ((to.y - from.y) / WORLD.height) * 100;

    if (snap) {
      // The PRIMARY element lands on the grid and the rest follow by the same
      // delta. Snapping each element independently would pull a group apart
      // the first time two of them rounded to the same cell.
      const lead = g.origins[0];
      const worldX = ((lead.x + dx) / 100) * WORLD.width;
      const worldY = ((lead.y + dy) / 100) * WORLD.height;
      dx += ((Math.round(worldX / SNAP_WORLD) * SNAP_WORLD - worldX) / WORLD.width) * 100;
      dy += ((Math.round(worldY / SNAP_WORLD) * SNAP_WORLD - worldY) / WORLD.height) * 100;
    }

    dx = clamp(dx, g.limits.minDx, g.limits.maxDx);
    dy = clamp(dy, g.limits.minDy, g.limits.maxDy);

    d.setPositions(
      g.origins.map((o) => ({ kind: o.kind, id: o.id, x: o.x + dx, y: o.y + dy })),
      { transient: g.moved },
    );
    g.moved = true;
  }, [toWorldPoint]);

  useEffect(() => {
    const onMove = (e) => {
      const g = gesture.current;
      if (!g) return;
      pointer.current = { x: e.clientX, y: e.clientY };

      if (g.mode === 'move') {
        if (!g.moved && Math.abs(e.clientX - g.startX) < DRAG_SLOP_PX
          && Math.abs(e.clientY - g.startY) < DRAG_SLOP_PX) return;
        applyMoveAt(e.clientX, e.clientY);
        return;
      }

      if (g.mode === 'marquee') {
        const rect = latest.current.svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        g.moved = true;
        g.rect = { ...g.rect, x1: e.clientX - rect.left, y1: e.clientY - rect.top };
        setMarquee(g.rect);
        return;
      }

      if (g.mode === 'rotate') {
        const p = toWorldPoint(e.clientX, e.clientY);
        const deg = (Math.atan2(p.y - g.centre.y, p.x - g.centre.x) * 180) / Math.PI + 90;
        // Shift holds it to 15° steps — the difference between "turned" and
        // "turned to exactly a right angle", which by eye is unhittable.
        const snapped = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
        const rotation = ((snapped % 360) + 360) % 360;
        const { draft: d } = latest.current;
        if (g.kind === 'zone') d.updateZone(g.id, { rotation }, { transient: g.moved });
        else {
          const table = d.tables.find((t) => keyOf(t) === g.id);
          if (table) d.updateTable(g.id, { position: { ...table.position, rotation } }, { transient: g.moved });
        }
        g.moved = true;
        return;
      }

      if (g.mode === 'resize') {
        const { draft: d } = latest.current;
        const zone = d.zones.find((z) => z.id === g.id);
        if (!zone) return;
        const p = toWorldPoint(e.clientX, e.clientY);
        const box = zoneBox(zone, WORLD);
        // Resizes ABOUT THE CENTRE — both edges move, the middle stays put.
        // A corner-anchored resize would drag the zone's stored position with
        // it, so a stage nudged wider would also walk across the room, and the
        // label under the cursor would drift away from it.
        let w = Math.abs(p.x - box.cx) * 2;
        let h = Math.abs(p.y - box.cy) * 2;
        if (latest.current.snapToGrid) {
          w = Math.round(w / SNAP_WORLD) * SNAP_WORLD;
          h = Math.round(h / SNAP_WORLD) * SNAP_WORLD;
        }
        // Shift keeps the proportions the catalogue gave it.
        if (e.shiftKey) h = w * (box.h / Math.max(box.w, 1));
        d.resizeZone(g.id, w, h, { transient: g.moved });
        g.moved = true;
      }
    };

    const onUp = () => {
      const g = gesture.current;
      gesture.current = null;
      setDragging(false);
      if (!g) return;

      if (g.mode === 'marquee') {
        setMarquee(null);
        const { draft: d, selection: sel } = latest.current;
        // A marquee that never moved is a click on the background, which means
        // "deselect" — the most-used way out of a selection, and one that must
        // not be swallowed by the marquee machinery.
        if (!g.moved) { sel.clear(); return; }
        const hit = hitTest(g.rect, latest.current.view, latest.current.svgRef.current, d);
        if (g.additive) sel.extend(hit.tables, hit.zones);
        else sel.replace(hit.tables, hit.zones);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [applyMoveAt, toWorldPoint]);

  /* ── edge auto-pan ──────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!dragging && !marquee) return undefined;
    let frame = 0;

    const tick = () => {
      const g = gesture.current;
      const rect = latest.current.svgRef.current?.getBoundingClientRect();
      if (g && rect && (g.mode === 'move' || g.mode === 'marquee')) {
        const px = pointer.current.x - rect.left;
        const py = pointer.current.y - rect.top;
        // Speed ramps with how far past the threshold the pointer is, so
        // nudging the edge creeps and pinning it travels.
        const speed = (d) => (d >= EDGE_PX ? 0 : ((EDGE_PX - d) / EDGE_PX) * EDGE_MAX_SPEED);
        const dx = speed(px) - speed(rect.width - px);
        const dy = speed(py) - speed(rect.height - py);

        if (dx || dy) {
          latest.current.panByScreen(dx, dy);
          if (g.mode === 'move') applyMoveAt(pointer.current.x, pointer.current.y);
          else if (g.mode === 'marquee') {
            g.rect = { ...g.rect, x1: pointer.current.x - rect.left, y1: pointer.current.y - rect.top };
            setMarquee(g.rect);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, marquee, applyMoveAt]);

  return { marquee, dragging, onElementPointerDown, onBackgroundPointerDown, onRotateStart, onResizeStart };
}

/**
 * Everything the marquee touches.
 *
 * INTERSECTION, not containment. Requiring a table to be entirely inside the
 * box means sweeping a row of them and missing the two at the ends, which is
 * the behaviour people read as "the selection box is broken". Rotation is
 * ignored, the same simplification every box-select makes — the axis-aligned
 * box of a rotated element is close enough that nobody has ever noticed, and
 * the exact version is four trig calls per element per release.
 */
function hitTest(rect, view, svg, draft) {
  const bounds = svg?.getBoundingClientRect();
  if (!bounds || !bounds.width) return { tables: [], zones: [] };

  // The marquee is tracked in screen pixels relative to the SVG; the elements
  // live in world units. One conversion, here, rather than per element.
  const toWorldX = (sx) => view.x + (sx / bounds.width) * view.width;
  const toWorldY = (sy) => view.y + (sy / bounds.height) * view.height;

  const left = toWorldX(Math.min(rect.x0, rect.x1));
  const right = toWorldX(Math.max(rect.x0, rect.x1));
  const top = toWorldY(Math.min(rect.y0, rect.y1));
  const bottom = toWorldY(Math.max(rect.y0, rect.y1));

  const tables = [];
  for (const t of draft.tables) {
    const { x, y } = toWorld(t.position);
    const body = tableBody(t.shape, t.seatCount);
    // The seats sit outside the body, and a marquee drawn around the seats of a
    // table has obviously selected that table.
    const reach = Math.max(body.width, body.height) / 2 + SEAT_PITCH + SEAT_RADIUS;
    if (x + reach >= left && x - reach <= right && y + reach >= top && y - reach <= bottom) {
      tables.push(keyOf(t));
    }
  }

  const zones = [];
  for (const z of draft.zones) {
    const b = zoneBox(z, WORLD);
    if (b.right >= left && b.x <= right && b.bottom >= top && b.y <= bottom) zones.push(z.id);
  }

  return { tables, zones };
}

/**
 * An element's centre in world units — what a rotation turns about.
 *
 * Both branches return `{ x, y }` meaning the CENTRE. `zoneBox` carries both
 * conventions at once (`x`/`y` is its top-left, `cx`/`cy` its centre), and
 * handing the box straight back would silently rotate every zone about its own
 * corner — the element would swing across the room instead of turning on the
 * spot.
 */
function centreOf(draft, kind, id) {
  if (kind === 'zone') {
    const zone = draft.zones.find((z) => z.id === id);
    if (!zone) return null;
    const b = zoneBox(zone, WORLD);
    return { x: b.cx, y: b.cy };
  }
  const table = draft.tables.find((t) => keyOf(t) === id);
  if (!table) return null;
  const { x, y } = toWorld(table.position);
  return { x, y };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
