'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  BOX_W, boxHeight, drawStrokes, MAX_STROKES, MAX_POINTS_PER_STROKE, MAX_POINTS, MIN_STEP, measure,
} from './signatureModel';

/** The ink. The pad stays paper-light in both themes, so the ink does too. */
const INK = '#111018';
const PEN = 5;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The surface a buyer signs on (owner's reference, 2026-11-15).
 *
 * Pointer Events, so a mouse, a finger and a stylus are one code path, and
 * pointer capture, so a stroke that leaves the pad mid-flourish keeps drawing
 * until the pen lifts instead of breaking in two. `touch-action: none` (CSS)
 * stops a finger from scrolling the page instead of signing.
 *
 * CONTROLLED: the strokes live in `value` ({ height, strokes }) and the pad
 * only draws them and reports a finished stroke. That is what lets the dialog
 * offer Undo and Clear, and keep a signature across a refused payment.
 *
 * Only the stroke being drawn is held here, in a ref — a re-render per pointer
 * move would be sixty React renders a second for no reason. It is painted on
 * the next animation frame.
 *
 * Coalesced events are read when the browser offers them: a fast flourish on a
 * 120 Hz pen delivers several points per event, and dropping them turns a curve
 * into a polygon.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SignaturePad({ value, onChange, describedBy }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const live = useRef(null);
  const frame = useRef(0);
  // The box height is fixed by the first stroke: the pad may change shape on a
  // rotation, but a signature's coordinates must not.
  const height = useRef(value?.height || null);
  const strokes = useRef(value?.strokes || []);

  const paint = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const { width: cssW, height: cssH } = wrap.getBoundingClientRect();
    if (!cssW || !cssH) return;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) { canvas.width = pxW; canvas.height = pxH; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);
    const k = (cssW * dpr) / BOX_W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineWidth = PEN;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    drawStrokes(ctx, live.current ? [...strokes.current, live.current] : strokes.current);
  }, []);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  // The parent's strokes are the truth: Undo, Clear and a restored signature
  // all arrive this way.
  useEffect(() => {
    strokes.current = value?.strokes || [];
    height.current = value?.height || null;
    schedule();
  }, [value, schedule]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => schedule());
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      // Reset as well as cancelled: a stale id left here (React's development
      // double-mount does exactly this) makes `schedule` believe a paint is
      // pending forever, and the pad never draws again.
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [schedule]);

  function toBox(e) {
    const r = canvasRef.current.getBoundingClientRect();
    const k = BOX_W / r.width;
    const h = height.current || boxHeight(r.width, r.height);
    return [
      Math.min(BOX_W, Math.max(0, (e.clientX - r.left) * k)),
      Math.min(h, Math.max(0, (e.clientY - r.top) * k)),
    ];
  }

  function finish() {
    const stroke = live.current;
    if (!stroke) return;
    live.current = null;
    // Kept here at once as well: the next stroke can start before the parent's
    // update comes back round.
    strokes.current = [...strokes.current, stroke];
    onChange({ method: 'drawn', height: height.current, strokes: strokes.current });
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (strokes.current.length >= MAX_STROKES) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (!height.current) {
      const r = canvasRef.current.getBoundingClientRect();
      height.current = boxHeight(r.width, r.height);
    }
    live.current = toBox(e);
    schedule();
  }

  function onPointerMove(e) {
    const stroke = live.current;
    if (!stroke) return;
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const used = measure(strokes.current).points;
    for (const ev of events.length ? events : [native]) {
      const [x, y] = toBox(ev);
      const n = stroke.length;
      if (Math.hypot(x - stroke[n - 2], y - stroke[n - 1]) < MIN_STEP) continue;
      // The API's limits, met by ending the stroke rather than refusing it.
      if (n / 2 >= MAX_POINTS_PER_STROKE || used + n / 2 >= MAX_POINTS) { finish(); break; }
      stroke.push(x, y);
    }
    schedule();
  }

  const empty = !(value?.strokes?.length);

  return (
    <div
      ref={wrapRef}
      className="es-sign__pad"
      // Once signed, the pad keeps the signature's shape through a rotation.
      style={value?.height ? { aspectRatio: `${BOX_W} / ${value.height}` } : undefined}
    >
      <canvas
        ref={canvasRef}
        className="es-sign__canvas"
        role="img"
        aria-label={empty ? 'Signature pad, empty' : 'Signature pad, signed'}
        aria-describedby={describedBy}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
      {empty && <span className="es-sign__placeholder" aria-hidden="true">Sign here</span>}
      <span className="es-sign__line" aria-hidden="true"><span>×</span></span>
    </div>
  );
}
