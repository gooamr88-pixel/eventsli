'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
/**
 * THE MAP STAYS STILL UNLESS IT IS ASKED TO MOVE (owner, 2026-11-19: "no
 * moving when creating an event or browsing seats, it's annoying").
 *
 * • A bare WHEEL scrolls the page and never touches the map — scrolling past
 *   a map used to zoom it on the way, while the page scrolled too (React's
 *   wheel listener is passive, so it could never stop the page). Ctrl/⌘ +
 *   wheel, which is also what a trackpad pinch sends, zooms. The editor in
 *   full screen, where there is no page to scroll, still pans on the wheel.
 * • `touch: 'cooperative'` (the buyer's maps): ONE finger scrolls the page
 *   and taps seats; TWO fingers move and zoom the map — Google Maps' rule for
 *   a map inside a page, down to the same `touch-action: pan-x pan-y`. A
 *   one-finger swipe that starts on the map used to trap the page.
 *   `'direct'` (the editor) keeps one-finger dragging, which moves tables.
 * • `follow: 'untilMoved'`: the map re-frames when its content changes only
 *   until the person has moved it themselves. After that it never jumps.
 *   The editor passes `'always'`: its frame changes only on load, Fit and a
 *   venue resize, each of which is a request to re-frame.
 *
 * `hint` ('wheel' | 'touch' | null) is what to tell someone whose gesture
 * went to the page instead of the map; `MapGestureHint` shows it.
 */
export function usePanZoom(bounds, { wheelMode = 'zoom', touch = 'cooperative', follow = 'untilMoved' } = {}) {
  const svgRef = useRef(null);
  const [view, setView] = useState(() => ({ ...bounds }));
  // Whether the person has moved the map since it was last framed.
  const [userMoved, setUserMoved] = useState(false);
  const [hint, setHint] = useState(null);
  const hintTimer = useRef(0);
  const flashHint = useCallback((kind) => {
    setHint(kind);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 1800);
  }, []);
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  // The gesture in progress. A ref, not state: these change on every
  // pointermove and re-rendering the whole map per frame drops the frame rate
  // to single digits on a phone with 200 seats on screen.
  const gesture = useRef(null);
  const moved = useRef(false);

  /** Frames the content. Called by the "fit" control; the map follows its
   *  content again afterwards. */
  const fit = useCallback(() => { setView({ ...bounds }); setUserMoved(false); }, [bounds]);

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
  /**
   * COMPARED BY VALUE, NOT BY IDENTITY — and that distinction is the whole
   * reason this block is safe to run during render.
   *
   * It used to be `bounds !== seenBounds`. A caller who computed bounds inline,
   * or memoized them against a dependency that was itself fresh each render,
   * handed over an object that was EQUAL but never IDENTICAL — so the condition
   * was true on every render, the state set re-ran the render, and the
   * component looped until React gave up with "too many re-renders".
   *
   * That is not a hypothetical: a default parameter of `[]` in a consumer is
   * enough to do it, because a default allocates a new array per render. The
   * consumer that hit it has been fixed too, but this is the layer that makes
   * the whole class of mistake impossible instead of fixing them one at a time.
   *
   * A string rather than four comparisons, because it also has to be the stored
   * state: keeping the OBJECT and comparing fields would re-introduce the same
   * trap for anyone who later wrote `seen !== bounds`.
   */
  const boundsKey = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
  const [seenBounds, setSeenBounds] = useState(boundsKey);
  if (boundsKey !== seenBounds) {
    setSeenBounds(boundsKey);
    // Not once the person has placed the view themselves: see `follow`.
    if (follow === 'always' || !userMoved) setView({ ...bounds });
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

  /**
   * The wheel, as a NATIVE non-passive listener: React's `onWheel` is passive,
   * so it could zoom the map but never stop the page scrolling at the same
   * time — both moved. Now exactly one thing moves: the map when asked
   * (Ctrl/⌘, a pinch, or the editor in full screen), otherwise the page.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (e) => {
      // `deltaMode` is lines on a real mouse wheel in Firefox and pages on some
      // configurations; treating either as pixels makes one notch move a
      // fraction of what it should and the map feel stuck.
      const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? (svg.getBoundingClientRect().height || 400) : 1;
      const zoomKey = e.ctrlKey || e.metaKey;   // a trackpad pinch arrives as Ctrl+wheel
      const fullscreen = typeof document !== 'undefined' && document.fullscreenElement?.contains(svg);
      if (wheelMode === 'pan' && fullscreen && !zoomKey) {
        e.preventDefault();
        // Shift-scroll goes sideways, the way it does in every document.
        const dx = (e.shiftKey ? e.deltaY : e.deltaX) * unit;
        const dy = (e.shiftKey ? 0 : e.deltaY) * unit;
        panByScreen(-dx, -dy);
        setUserMoved(true);
        return;
      }
      if (!zoomKey) { flashHint('wheel'); return; }   // the page scrolls
      e.preventDefault();                                // and not the browser's own zoom
      // Proportional, so a mouse notch (~100) is a step and a trackpad pinch
      // (a stream of small deltas) is smooth rather than a rocket.
      const delta = Math.max(-100, Math.min(100, e.deltaY * unit));
      zoomAt(Math.exp(delta * 0.0025), e.clientX, e.clientY);
      setUserMoved(true);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt, panByScreen, wheelMode, flashHint]);

  const onPointerDown = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return;
    /**
     * ─────────────────────────────────────────────────────────────────────────
     * NO POINTER CAPTURE ON PRESS — it is taken when a DRAG starts, below.
     *
     * This captured on every pointerdown, and Chrome then fires the `click` at
     * the CAPTURING element: a mouse click on a seat arrived at the `<svg>`
     * ("Seat map") instead of the seat, so on a desktop no seat could be chosen
     * with a mouse at all. A touch tap still worked, which is why it hid. Found
     * by the mobile pass's click checks; confirmed by disabling capture, after
     * which the same click selected the seat.
     *
     * Capture is only needed once the pointer is MOVING the map — to keep the
     * drag alive when it leaves the svg — so that is when it is taken.
     * ─────────────────────────────────────────────────────────────────────────
     */

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

    // Two fingers: pinch to zoom, and move together to pan — with one-finger
    // swipes going to the page (cooperative touch), this is how a phone moves
    // the map at all.
    if (g.pointers.size === 2 && g.pinchStart) {
      const span = spanOf(g.pointers);
      if (span.distance > 0 && g.pinchStart.distance > 0) {
        moved.current = true;
        const factor = g.pinchStart.distance / span.distance;
        // Applied against the CURRENT view rather than accumulated from the
        // gesture's start, then the start is reset — accumulating drifts,
        // because each frame's rounding compounds over a long pinch.
        zoomAt(factor, span.x, span.y);
        panByScreen(g.pinchStart.x - span.x, g.pinchStart.y - span.y);
        g.pinchStart = span;
        setUserMoved(true);
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
      // The moment a press becomes a drag, the drag takes the pointer — see
      // onPointerDown for why it is not taken earlier.
      if (!moved.current) {
        try { svg.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
      }
      moved.current = true;
    }
    if (!moved.current) return;

    setUserMoved(true);
    setView(clampView({
      x: g.start.x - dx,
      y: g.start.y - dy,
      width: g.start.width,
      height: g.start.height,
    }, bounds));
  }, [bounds, zoomAt, panByScreen]);

  const endPointer = useCallback((e) => {
    const g = gesture.current;
    if (!g) return;
    // One finger the browser took for scrolling the page (cooperative touch):
    // say how the map does move, rather than leaving it seemingly stuck.
    if (e.type === 'pointercancel' && e.pointerType === 'touch' && touch === 'cooperative' && g.pointers.size === 1) {
      flashHint('touch');
    }
    g.pointers.delete(e.pointerId);
    // Only a pointer a drag captured is released; releasing one that was never
    // captured throws in some engines.
    const svg = svgRef.current;
    if (svg?.hasPointerCapture?.(e.pointerId)) svg.releasePointerCapture(e.pointerId);

    if (g.pointers.size === 0) {
      gesture.current = null;
    } else {
      // One finger lifted from a pinch: re-anchor so the remaining finger pans
      // from where it is, instead of the map jumping by the gap between them.
      g.origin = [...g.pointers.values()][0];
      g.start = { ...view };
      g.pinchStart = null;
    }
  }, [view, touch, flashHint]);

  /**
   * True when the gesture that just ended was a drag, so a click handler can
   * ignore it. Without this, panning across a map selects whichever seat the
   * finger happened to lift over.
   */
  const wasDragged = useCallback(() => moved.current, []);

  const zoomIn = useCallback(() => { zoomAt(1 / 1.35, centreOf(svgRef).x, centreOf(svgRef).y); setUserMoved(true); }, [zoomAt]);
  const zoomOut = useCallback(() => { zoomAt(1.35, centreOf(svgRef).x, centreOf(svgRef).y); setUserMoved(true); }, [zoomAt]);

  /**
   * GLIDES the view to a box (world units) — "take me to these seats"
   * (owner, 2026-11-17). About 450ms, eased, unless the reader asked for
   * reduced motion, when it jumps. Clamped like every other move, so a box at
   * the edge of the room cannot pan the content off screen.
   */
  const anim = useRef(0);
  const frameTo = useCallback((box) => {
    if (!box) return;
    const target = clampView(box, bounds);
    cancelAnimationFrame(anim.current);
    const reduce = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof requestAnimationFrame !== 'function') { setView(target); return; }
    let from = null;
    let start = null;
    const step = (now) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / 450);
      const ease = 1 - (1 - t) ** 3;
      setView((v) => {
        if (!from) from = v;
        return {
          x: from.x + (target.x - from.x) * ease,
          y: from.y + (target.y - from.y) * ease,
          width: from.width + (target.width - from.width) * ease,
          height: from.height + (target.height - from.height) * ease,
        };
      });
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [bounds]);

  return {
    svgRef,
    view,
    fit,
    frameTo,
    zoomIn,
    zoomOut,
    zoomAt,
    panByScreen,
    wasDragged,
    toWorldPoint,
    hint,
    // The CSS touch-action the map's <svg> must carry for `touch`.
    touchAction: touch === 'cooperative' ? 'pan-x pan-y' : 'none',
    handlers: {
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
