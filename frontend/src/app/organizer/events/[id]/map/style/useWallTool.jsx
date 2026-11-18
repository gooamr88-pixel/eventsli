'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { screenScale, toPercent, worldScale } from '../../../../../components/seating/seatingGeometry';
import { zoneBox } from '../../../../../components/seating/venueZones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Draw wall (2026-11-18): click the room's corners, double-click or press Enter
 * to finish, Escape to stop. Each straight run becomes one wall zone — a thin
 * bar the editor already knows how to move, turn, resize, copy and undo — so a
 * drawn wall is edited exactly like a stage, and a gap left between two walls
 * is a door.
 *
 * Corners snap to 45° steps by default (the "Snap corners to 45°" switch), and
 * a click near the end of an existing wall joins it, so a room closes cleanly.
 * Each wall runs half its thickness past both corners, so the joins are solid.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const WALL_DEFAULTS = Object.freeze({ thickness: 6, snap45: true });

export function useWallTool({ svgRef, view, world, look, zones, active, onCreate, onExit }) {
  const [points, setPoints] = useState([]);
  const [hover, setHover] = useState(null);
  const [options, setOptions] = useState(WALL_DEFAULTS);
  // The thickness scales with the room, so a stadium's wall is visible.
  const thickness = options.thickness * worldScale(world);

  // Leaving the tool drops a half-drawn wall. Reset during render, not in an
  // effect, so the stale preview never paints (AGENTS.md).
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) { setPoints([]); setHover(null); }
  }

  const toWorldPoint = useCallback((e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    return {
      x: view.x + ((e.clientX - rect.left) / rect.width) * view.width,
      y: view.y + ((e.clientY - rect.top) / rect.height) * view.height,
    };
  }, [svgRef, view]);

  /** Wall ends already on the map, to join a new wall to. */
  const ends = useMemo(() => zones.filter((z) => z.kind === 'wall').flatMap((z) => {
    const b = zoneBox(z, world);
    const a = (b.rotation * Math.PI) / 180;
    const half = Math.max(0, b.w - b.h) / 2;
    return [
      { x: b.cx - Math.cos(a) * half, y: b.cy - Math.sin(a) * half },
      { x: b.cx + Math.cos(a) * half, y: b.cy + Math.sin(a) * half },
    ];
  }), [zones, world]);

  const place = useCallback((raw, free) => {
    const near = 10 * screenScale(view);
    const join = ends.find((p) => Math.hypot(p.x - raw.x, p.y - raw.y) <= near)
      || points.find((p) => Math.hypot(p.x - raw.x, p.y - raw.y) <= near);
    if (join) return join;
    const last = points[points.length - 1];
    if (!last || free || !options.snap45) return raw;
    const dx = raw.x - last.x;
    const dy = raw.y - last.y;
    const len = Math.hypot(dx, dy);
    const step = Math.PI / 4;
    const a = Math.round(Math.atan2(dy, dx) / step) * step;
    return { x: last.x + Math.cos(a) * len, y: last.y + Math.sin(a) * len };
  }, [ends, points, options.snap45, view]);

  const finish = useCallback(() => {
    const segments = [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 4) continue;
      const centre = toPercent((a.x + b.x) / 2, (a.y + b.y) / 2, world);
      segments.push({
        kind: 'wall',
        position: centre,
        overrides: {
          w: Math.round((len + thickness) * 10) / 10,
          h: Math.round(thickness * 10) / 10,
          rotation: Math.round((((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) + 360) % 360 * 10) / 10,
        },
      });
    }
    setPoints([]);
    setHover(null);
    if (segments.length) onCreate(segments);
    onExit();
  }, [points, world, thickness, onCreate, onExit]);

  const cancel = useCallback(() => { setPoints([]); setHover(null); onExit(); }, [onExit]);

  // Enter finishes, Escape stops, Backspace takes back the last corner.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      if (e.key === 'Enter') { e.preventDefault(); finish(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      if (e.key === 'Backspace') { e.preventDefault(); setPoints((p) => p.slice(0, -1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, finish, cancel]);

  // Closing the room finishes on the next tick, after its last corner lands.
  const finishRef = useRef(finish);
  useEffect(() => { finishRef.current = finish; }, [finish]);

  const onPointerDown = useCallback((e) => {
    if (!active || e.button !== 0) return false;
    const raw = toWorldPoint(e);
    if (!raw) return false;
    e.preventDefault();
    const p = place(raw, e.altKey);
    const first = points[0];
    // Clicking the first corner again closes the room and finishes.
    if (first && points.length > 2 && p === first) {
      setPoints((list) => [...list, first]);
      setTimeout(() => finishRef.current(), 0);
      return true;
    }
    setPoints((list) => [...list, p]);
    return true;
  }, [active, toWorldPoint, place, points]);

  const onPointerMove = useCallback((e) => {
    if (!active || points.length === 0) return;
    const raw = toWorldPoint(e);
    if (raw) setHover(place(raw, e.altKey));
  }, [active, points.length, toWorldPoint, place]);

  const colour = look?.wall || '#0e3a4a';
  const k = screenScale(view);
  const trail = hover && points.length ? [...points, hover] : points;
  const preview = active && trail.length > 0 ? (
    <g style={{ pointerEvents: 'none' }} aria-hidden="true">
      {trail.length > 1 && (
        <polyline
          points={trail.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke={colour} strokeWidth={thickness} strokeLinecap="square" strokeLinejoin="miter" opacity={0.85}
        />
      )}
      {points.map((p, i) => (
         
        <circle key={i} cx={p.x} cy={p.y} r={4 * k} fill="#ffffff" stroke="var(--es-accent)" strokeWidth={1.5 * k} />
      ))}
    </g>
  ) : null;

  return {
    active, points, options, setOptions, finish, cancel, onPointerDown, onPointerMove, preview,
  };
}
