'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The grips on a selected element: rotate, and — for zones — resize.
 *
 * EVERY SIZE HERE IS DIVIDED BY THE ZOOM, and that is the whole reason this is
 * one shared component rather than a few rects written inline twice.
 *
 * The canvas is an SVG whose viewBox is the pan and zoom, so a length written
 * in world units is scaled on screen by whatever the zoom happens to be. At the
 * scale an organizer actually lays out a room — the whole floor in view, around
 * 0.35 — a handle specified as "12" renders at four screen pixels. It is still
 * there, still hit-testable in theory, and in practice unhittable: the element
 * looks like it simply has no handles, and rotating reads as a missing feature
 * rather than a missing target.
 *
 * Dividing by the scale holds them at a constant size on screen, which is what
 * a handle is for. `44` is not the number here because these sit ON the artwork
 * and a 44-unit grip would cover a small table completely; they are pointer
 * targets on a pointer-driven surface, and the keyboard path (arrows to nudge,
 * the inspector's Rotate button) is the one that has to work without them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SelectionHandles({
  width, height, scale, resizable, onRotateStart, onResizeStart,
}) {
  const inv = (n) => n / Math.max(scale, 0.0001);

  const grip = inv(9);
  const stroke = inv(2);
  // Far enough above the element that the handle is not sitting on the edge it
  // rotates — near enough that the arm between them is short at any zoom.
  const armLength = inv(22);
  const top = -height / 2;

  return (
    <g>
      {/* The arm. Purely a cue: it says the circle above belongs to THIS
          element, which matters the moment two elements are near each other. */}
      <line
        x1={0} y1={top} x2={0} y2={top - armLength}
        stroke="var(--es-accent)" strokeWidth={inv(1)} opacity={0.6}
        style={{ pointerEvents: 'none' }}
      />
      <circle
        cx={0} cy={top - armLength} r={grip}
        fill="var(--es-accent)" stroke="var(--es-surface)" strokeWidth={stroke}
        onPointerDown={onRotateStart}
        style={{ cursor: 'grab' }}
        role="button"
        // Not a tab stop. A keyboard user reaches rotation through the
        // inspector's Rotate button, which does the same thing in 90° steps
        // and can be reached in one Tab from the panel that is already open —
        // rather than through a drag gesture a keyboard cannot perform.
        aria-hidden="true"
      >
        <title>Drag to rotate — hold Shift for 15° steps</title>
      </circle>

      {resizable && (
        <rect
          x={width / 2 - grip} y={height / 2 - grip}
          width={grip * 2} height={grip * 2} rx={inv(2)}
          fill="var(--es-surface)" stroke="var(--es-accent)" strokeWidth={stroke}
          onPointerDown={onResizeStart}
          style={{ cursor: 'nwse-resize' }}
          aria-hidden="true"
        >
          <title>Drag to resize — Shift keeps the proportions</title>
        </rect>
      )}
    </g>
  );
}
