'use client';

import { useEffect, useState } from 'react';
import { worldScale } from './seatingGeometry';

/** A section badge is 34 units tall (MapOverlays.jsx); on screen, at most this. */
const BADGE_HEIGHT_UNITS = 34;
const BADGE_MAX_PX = 26;

/**
 * SECTION NAMES STAY LABELS, NEVER BANNERS (2026-11-10).
 *
 * A badge is drawn in world units, so on a phone — where the map opens zoomed
 * in for comfortable tap targets (SeatMapCanvas, MIN_TARGET_PX) — one name grew
 * to fill the map's width ("ACCESSIBLE" across the whole screen). The SVG's
 * size in screen pixels, kept from a ResizeObserver, caps a badge at
 * BADGE_MAX_PX tall however far the map is zoomed. Zoomed out it is unchanged:
 * the world's own scale, as before.
 */
export function useBadgeScale(svgRef, view, world) {
  const [boxPx, setBoxPx] = useState(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setBoxPx({ width, height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [svgRef]);

  const base = worldScale(world);
  if (!boxPx) return base;
  const pxPerUnit = Math.min(boxPx.width / view.width, boxPx.height / view.height);
  return Math.min(base, BADGE_MAX_PX / (BADGE_HEIGHT_UNITS * pxPerUnit));
}
