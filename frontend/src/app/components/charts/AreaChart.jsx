import { niceCeiling } from './chartMath';

/**
 * A smooth line over a soft fill, for one series by day.
 *
 * The plot is an SVG stretched to its box (`preserveAspectRatio="none"`, with
 * a non-scaling stroke) and every label is HTML positioned in percent, so the
 * text stays its real size at any width instead of scaling with the drawing.
 *
 * `data` is `[{ label, value, detail }]`; `formatAxis` writes the y labels.
 */
const W = 100;
const H = 100;
const STEPS = 6;

export default function AreaChart({ data, ariaLabel, formatAxis = String, xLabels = 8 }) {
  const values = (data || []).map((d) => Math.max(0, Number(d.value) || 0));
  // A round step first, then the top as whole steps: 290K over six steps is
  // 50K to 300K, where a round TOP (500K) would have given 83.3K steps.
  const step = niceCeiling(Math.max(0, ...values) / STEPS) || 1;
  const max = step * Math.max(1, Math.ceil(Math.max(0, ...values) / step));
  const n = values.length;
  const points = values.map((v, i) => [n > 1 ? (i / (n - 1)) * W : W / 2, H - (v / max) * H]);
  const line = smoothPath(points);
  const area = points.length ? `${line} L${W} ${H} L0 ${H} Z` : '';
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => max - step * i);
  const every = Math.max(1, Math.round((n - 1) / (xLabels - 1)));
  const last = points[points.length - 1];

  return (
    <div className="es-area" role="img" aria-label={ariaLabel}>
      <div className="es-area__y" aria-hidden="true">
        {ticks.map((t) => <span key={t}>{formatAxis(t)}</span>)}
      </div>
      <div className="es-area__plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="es-area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="es-area__stop-top" />
              <stop offset="100%" className="es-area__stop-bottom" />
            </linearGradient>
          </defs>
          {area && <path d={area} fill="url(#es-area-fill)" />}
          {line && <path d={line} className="es-area__line" vectorEffect="non-scaling-stroke" />}
        </svg>
        {last && <span className="es-area__dot" style={{ left: `${last[0]}%`, top: `${last[1]}%` }} aria-hidden="true" />}
        {/* One hover target per day; the title is the tooltip. */}
        <div className="es-area__hits">
          {(data || []).map((d) => <span key={d.label} title={`${d.label}: ${d.detail ?? d.value}`} />)}
        </div>
      </div>
      <div className="es-area__x" aria-hidden="true">
        {labelIndexes(n, every).map((i) => (
          <span
            key={data[i].label}
            style={{ left: `${points[i][0]}%`, transform: `translateX(${i === 0 ? 0 : i === n - 1 ? -100 : -50}%)` }}
          >
            {data[i].label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Every `every`th day, and the last one unless it would crowd its neighbour. */
function labelIndexes(n, every) {
  const out = [];
  for (let i = 0; i < n; i += every) out.push(i);
  const tail = out[out.length - 1];
  if (n > 1 && tail !== n - 1) {
    if (n - 1 - tail < every / 2) out.pop();
    out.push(n - 1);
  }
  return out;
}

/** Catmull-Rom through every point, as cubic Béziers — a curve that passes
 *  through each day's value rather than smoothing it away. Clamped so the
 *  curve never dips below zero between two flat days. */
function smoothPath(pts) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M0 ${pts[0][1]} L${W} ${pts[0][1]}`;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1y = Math.min(H, p1[1] + (p2[1] - p0[1]) / 6);
    const c2y = Math.min(H, p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${c1y} ${p2[0] - (p3[0] - p1[0]) / 6} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}
