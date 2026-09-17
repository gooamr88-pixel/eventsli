'use client';

import { useCallback, useRef, useState } from 'react';
import { clampView } from './seatingGeometry';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Pan and zoom over an SVG viewBox. No library.
 *
 * The previous platform imported Panzoom from `https://esm.sh/@panzoom/panzoom`
 * at runtime — a third-party CDN in the middle of the purchase path, where an
 * outage takes the seat picker down and a compromise owns it. The whole of it
 * is the arithmetic below, over a viewBox we already control.
 *
 * The viewBox IS the state. There is no CSS transform anywhere: an SVG scaled
 * with `transform: scale()` scales its stroke widths and its text with it, so a
 * seat label is unreadable at one zoom and enormous at another. Moving the
 * viewBox instead means everything drawn keeps its size in screen pixels, which
 * is what makes a seat stay tappable at every zoom.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * `wheelMode` — what a bare wheel does, and the one place the two callers of
 * this hook genuinely disagree.
 *
 * The buyer ZOOMS. Their map is one screenful they are choosing a seat on, the
 * page behind it does not scroll while the pointer is over it, and zoom is the
 * only thing they want from a wheel.
 *
 * The editor PANS, with Ctrl/Cmd for zoom. That is the convention of every
 * layout tool, and the reason is the room: an organizer works at a zoom they
 * have chosen and travels across a floor plan much larger than the viewport.
 * On a trackpad, where a two-finger scroll is the natural gesture for "move
 * around", making it re-zoom instead means the only way to reach the far corner
 * is to hold a key and drag with the other hand.
 */
export function usePanZoom(bounds, { wheelMode = 'zoom' } = {}) {
  const svgRef = useRef(null);
  const [view, setView] = useState(() => ({ ...bounds }));

  // The gesture in progress. A ref, not state: these change on every
  // pointermove and re-rendering the whole map per frame drops the frame rate
  // to single digits on a phone with 200 seats on screen.
  const gesture = useRef(null);
  const moved = useRef(false);

  /** Frames the content. Called by the "fit" control. */
  const fit = useCallback(() => setView({ ...bounds }), [bounds]);

  /**
   * Re-frame when the content changes shape — a map arriving after its loading
   * state, or a private table unlocking and adding a table to the room.
   *
   * Adjusted DURING RENDER, not in an effect. This is React's documented way to
   * reset state when a prop changes: setting state while rendering makes React
   * re-run this component immediately with the new value, before it commits or
   * paints anything. The effect version renders once with the STALE viewport,
   * paints it, then corrects — which on a seat map is a visible jump every time
   * the data arrives.
   */
  const [seenBounds, setSeenBounds] = useState(bounds);
  if (bounds !== seenBounds) {
    setSeenBounds(bounds);
    setView({ ...bounds });
  }

  /** Screen pixels → world units, through the CURRENT viewBox. */
  const toWorldPoint = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: view.x + ((clientX - rect.left) / rect.width) * view.width,
      y: view.y + ((clientY - rect.top) / rect.height) * view.height,
    };
  }, [view]);

  /**
   * Zoom about a fixed point, so what is under the cursor or the pinch stays
   * under it. Zooming about the centre instead makes the thing you were aiming
   * at slide away, and you chase it.
   */
  const zoomAt = useCallback((factor, clientX, clientY) => {
    setView((v) => {
      const svg = svgRef.current;
      if (!svg) return v;
      const rect = svg.getBoundingClientRect();
      const px = (clientX - rect.left) / rect.width;
      const py = (clientY - rect.top) / rect.height;

      const anchorX = v.x + px * v.width;
      const anchorY = v.y + py * v.height;

      const width = v.width * factor;
      const height = v.height * factor;

      return clampView({
        x: anchorX - px * width,
        y: anchorY - py * height,
        width,
        height,
      }, bounds);
    });
  }, [bounds]);

  /**
   * Moves the view by a distance in SCREEN pixels.
   *
   * Screen, not world, and that is the whole point of it existing. A wheel
   * notch, an arrow key and the edge auto-pan all want "about this much of the
   * viewport"; expressed in world units the same number crawls when zoomed out
   * and flies when zoomed in, so every caller would have to divide by the scale
   * itself and one of them eventually would not.
   */
  const panByScreen = useCallback((dx, dy) => {
    setView((v) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return v;
      return clampView({
        ...v,
        x: v.x + (dx / rect.width) * v.width,
        y: v.y + (dy / rect.height) * v.height,
      }, bounds);
    });
  }, [bounds]);

  const onWheel = useCallback((e) => {
    // Not preventDefault'd here — React attaches wheel listeners passively, so
    // the call would warn and do nothing. The SVG carries `touch-action: none`
    // and `overscroll-behavior: contain` instead, which stops the page
    // scrolling underneath without fighting the browser for the event.
    if (wheelMode === 'pan' && !e.ctrlKey && !e.metaKey) {
      // `deltaMode` is lines on a real mouse wheel in Firefox and pages on some
      // configurations; treating either as pixels makes one notch move a
      // fraction of what it should and the map feel stuck.
      const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? (svgRef.current?.getBoundingClientRect().height || 400) : 1;
      // Shift-scroll goes sideways, the way it does in every document — and it
      // is the only horizontal gesture a plain wheel-mouse has.
      const dx = (e.shiftKey ? e.deltaY : e.deltaX) * unit;
      const dy = (e.shiftKey ? 0 : e.deltaY) * unit;
      panByScreen(-dx, -dy);
      return;
    }
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    zoomAt(factor, e.clientX, e.clientY);
  }, [zoomAt, panByScreen, wheelMode]);

  const onPointerDown = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture?.(e.pointerId);

    const pointers = gesture.current?.pointers || new Map();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    gesture.current = {
      pointers,
      start: { ...view },
      origin: { x: e.clientX, y: e.clientY },
      // Two fingers down: remember the span so pinch is a ratio against it.
      pinchStart: pointers.size === 2 ? spanOf(pointers) : null,
    };
    moved.current = false;
  }, [view]);

  const onPointerMove = useCallback((e) => {
    const g = gesture.current;
    if (!g || !g.pointers.has(e.pointerId)) return;

    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Pinch.
    if (g.pointers.size === 2 && g.pinchStart) {
      const span = spanOf(g.pointers);
      if (span.distance > 0 && g.pinchStart.distance > 0) {
        moved.current = true;
        const factor = g.pinchStart.distance / span.distance;
        // Applied against the CURRENT view rather than accumulated from the
        // gesture's start, then the start is reset — accumulating drifts,
        // because each frame's rounding compounds over a long pinch.
        zoomAt(factor, span.x, span.y);
        g.pinchStart = span;
      }
      return;
    }

    // Pan.
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - g.origin.x) / rect.width) * g.start.width;
    const dy = ((e.clientY - g.origin.y) / rect.height) * g.start.height;

    // A few pixels of slop before this counts as a drag. Without it a tap with
    // any tremor at all — which is most taps on a phone — moves the map by a
    // pixel and swallows the click, so seats become unselectable for anyone
    // with an unsteady hand.
    if (Math.abs(e.clientX - g.origin.x) > 4 || Math.abs(e.clientY - g.origin.y) > 4) {
      moved.current = true;
    }
    if (!moved.current) return;

    setView(clampView({
      x: g.start.x - dx,
      y: g.start.y - dy,
      width: g.start.width,
      height: g.start.height,
    }, bounds));
  }, [bounds, zoomAt]);

  const endPointer = useCallback((e) => {
    const g = gesture.current;
    if (!g) return;
    g.pointers.delete(e.pointerId);
    svgRef.current?.releasePointerCapture?.(e.pointerId);

    if (g.pointers.size === 0) {
      gesture.current = null;
    } else {
      // One finger lifted from a pinch: re-anchor so the remaining finger pans
      // from where it is, instead of the map jumping by the gap between them.
      g.origin = [...g.pointers.values()][0];
      g.start = { ...view };
      g.pinchStart = null;
    }
  }, [view]);

  /**
   * True when the gesture that just ended was a drag, so a click handler can
   * ignore it. Without this, panning across a map selects whichever seat the
   * finger happened to lift over.
   */
  const wasDragged = useCallback(() => moved.current, []);

  const zoomIn = useCallback(() => zoomAt(1 / 1.35, centreOf(svgRef).x, centreOf(svgRef).y), [zoomAt]);
  const zoomOut = useCallback(() => zoomAt(1.35, centreOf(svgRef).x, centreOf(svgRef).y), [zoomAt]);

  return {
    svgRef,
    view,
    fit,
    zoomIn,
    zoomOut,
    zoomAt,
    panByScreen,
    wasDragged,
    toWorldPoint,
    handlers: {
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onPointerLeave: endPointer,
    },
  };
}

/** Midpoint and distance of a two-pointer gesture, in screen pixels. */
function spanOf(pointers) {
  const [a, b] = [...pointers.values()];
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    distance: Math.hypot(a.x - b.x, a.y - b.y),
  };
}

function centreOf(ref) {
  const rect = ref.current?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
