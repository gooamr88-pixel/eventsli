/**
 * The arithmetic behind the dashboard's charts. Pure, so it is tested without a
 * DOM. None of it is MONEY arithmetic — values arrive as totals from the API and
 * are only scaled into pixels here.
 */

/** Rounds a maximum up to 1, 2, 2.5 or 5 × a power of ten, so the scale line reads as a real number. */
export function niceCeiling(max) {
  const n = Number(max);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(n));
  const f = n / magnitude;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Bars in a fixed logical box. A zero keeps a sliver at the baseline, so an
 * empty day reads as "nothing sold" rather than as a missing day.
 */
export function barLayout(values, { width = 600, height = 160, gap = 0.28, floor = 2 } = {}) {
  const clean = (values || []).map((v) => Math.max(0, Number(v) || 0));
  if (clean.length === 0) return { max: 0, bars: [] };

  const max = niceCeiling(Math.max(...clean));
  const slot = width / clean.length;
  const barWidth = slot * (1 - gap);

  return {
    max,
    bars: clean.map((value, i) => {
      const h = value > 0 && max > 0 ? Math.max(floor, (value / max) * height) : floor;
      return {
        x: i * slot + (slot - barWidth) / 2,
        y: height - h,
        width: barWidth,
        height: h,
        value,
        empty: value === 0,
      };
    }),
  };
}

/** First, middle and last labels — enough to read a month without crowding a phone. */
export function axisLabels(labels, count = 3) {
  const list = labels || [];
  if (list.length <= count) return list;
  const picks = new Set([0, Math.floor((list.length - 1) / 2), list.length - 1]);
  return [...picks].sort((a, b) => a - b).map((i) => list[i]);
}

/** A ring's stroke-dasharray on a 100-unit circumference, clamped to 0…1. */
export function ringDash(fraction) {
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  return `${(f * 100).toFixed(2)} 100`;
}

/** A whole-number percentage, or null when there is nothing to divide by. */
export function percent(part, whole) {
  const p = Number(part);
  const w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return null;
  return Math.round((p / w) * 100);
}
