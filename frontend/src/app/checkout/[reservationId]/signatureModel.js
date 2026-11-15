/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The checkout signature, as data (owner request 2026-11-15).
 *
 * Pure, so the pad, the dialog and the tests share one definition. It mirrors
 * the API's checks (backend/services/signatureService.js) so the button only
 * lights once the API will accept what was drawn — a buyer should never learn
 * from a refusal that their squiggle was too small.
 *
 * A drawing is kept as the pen's points in a box 1000 units wide (its height
 * follows the pad's shape), each stroke a flat [x, y, x, y, …] list. Points,
 * not a picture: small, checkable, and the same on any screen.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const BOX_W = 1000;
export const MIN_H = 150;
export const MAX_H = 1000;
export const MAX_STROKES = 80;
export const MAX_POINTS_PER_STROKE = 1500;
export const MAX_POINTS = 6000;
/** Total pen travel and span, in box units — the API's floor for "a signature". */
export const MIN_INK = 150;
export const MIN_SPAN = 60;
export const MIN_TYPED = 2;
export const MAX_TYPED = 80;
/** Points closer than this to the last one add nothing but weight. */
export const MIN_STEP = 1.5;

/** The box height for a pad of this on-screen shape. */
export function boxHeight(cssWidth, cssHeight) {
  if (!cssWidth || !cssHeight) return 300;
  return Math.min(MAX_H, Math.max(MIN_H, Math.round((BOX_W * cssHeight) / cssWidth)));
}

/** Pen travel and the larger of the two spans, over every stroke. */
export function measure(strokes) {
  let ink = 0;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  let points = 0;
  for (const s of strokes) {
    for (let i = 0; i < s.length; i += 2) {
      const x = s[i]; const y = s[i + 1];
      points += 1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (i >= 2) ink += Math.hypot(x - s[i - 2], y - s[i - 1]);
    }
  }
  const span = points ? Math.max(maxX - minX, maxY - minY) : 0;
  return { ink, span, points };
}

/**
 * Where a signature stands:
 *   'empty'  nothing drawn or typed
 *   'small'  something, but not enough to be a signature
 *   'ready'  the API will take it
 */
export function signatureState(value) {
  if (!value) return 'empty';
  if (value.method === 'typed') {
    const name = (value.name || '').replace(/\s+/g, ' ').trim();
    if (!name) return 'empty';
    return name.length >= MIN_TYPED && name.length <= MAX_TYPED ? 'ready' : 'small';
  }
  const strokes = value.strokes || [];
  if (!strokes.length) return 'empty';
  const { ink, span } = measure(strokes);
  return ink >= MIN_INK && span >= MIN_SPAN ? 'ready' : 'small';
}

/**
 * What the API receives — rounded to a tenth, typed names tidied. Null when
 * there is nothing to send.
 */
export function toPayload(value) {
  if (!value) return null;
  if (value.method === 'typed') {
    return { method: 'typed', name: (value.name || '').replace(/\s+/g, ' ').trim() };
  }
  return {
    method: 'drawn',
    width: BOX_W,
    height: value.height,
    strokes: value.strokes.map((s) => s.map((n) => Math.round(n * 10) / 10)),
  };
}

/**
 * Draws strokes onto a 2D context already scaled to box units, with the same
 * smoothing the API uses for the stored SVG (quadratic curves through the
 * midpoints), so what the buyer sees is what is kept.
 */
export function drawStrokes(ctx, strokes) {
  for (const s of strokes) {
    const n = s.length / 2;
    if (!n) continue;
    ctx.beginPath();
    ctx.moveTo(s[0], s[1]);
    if (n === 1) {
      ctx.lineTo(s[0] + 0.1, s[1]);
    } else if (n === 2) {
      ctx.lineTo(s[2], s[3]);
    } else {
      for (let i = 1; i < n - 1; i += 1) {
        const x = s[i * 2]; const y = s[i * 2 + 1];
        ctx.quadraticCurveTo(x, y, (x + s[i * 2 + 2]) / 2, (y + s[i * 2 + 3]) / 2);
      }
      ctx.lineTo(s[(n - 1) * 2], s[(n - 1) * 2 + 1]);
    }
    ctx.stroke();
  }
}
