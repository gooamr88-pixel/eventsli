import { barLayout, axisLabels } from './chartMath';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A bar per day. Drawn in SVG with token colours — no charting library.
 *
 * Fancy pulls in a library for this and styles it inline; neither is available
 * here. A library would put a few hundred kilobytes on the dashboard for bars
 * and a line, and its colours would live in JavaScript where the contrast gate
 * cannot see them. Every mark below takes its colour from a class in
 * globals.css, so a theme switch recolours the chart with everything else.
 *
 * The SVG stretches to its box (`preserveAspectRatio="none"`); the axis labels
 * are HTML under it, not SVG text, so they stay legible at 320px instead of
 * shrinking with the drawing. A screen reader gets a table of the same numbers.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const W = 600;
const H = 160;

export default function BarChart({ data, format = String, ariaLabel }) {
  const rows = data || [];
  const { max, bars } = barLayout(rows.map((d) => d.value), { width: W, height: H });
  const labels = axisLabels(rows.map((d) => d.label));

  return (
    <figure className="fx-stack fx-stack--sm">
      <div className="fx-row fx-row--between text-xs text-subtle" aria-hidden="true">
        <span className="es-nums">{max > 0 ? format(max) : 'Nothing yet'}</span>
      </div>

      <svg
        className="es-chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        height="160"
        aria-hidden="true"
        focusable="false"
      >
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            className="es-chart__grid"
            x1="0"
            x2={W}
            y1={H - f * H}
            y2={H - f * H}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {bars.map((bar, i) => (
          <rect
            key={`${rows[i].label}-${i}`}
            className={bar.empty ? 'es-chart__bar es-chart__bar--empty' : 'es-chart__bar'}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx="2"
          >
            <title>{`${rows[i].label}: ${rows[i].detail || format(bar.value)}`}</title>
          </rect>
        ))}
      </svg>

      <div className="es-chart__axis" aria-hidden="true">
        {labels.map((label) => <span key={label}>{label}</span>)}
      </div>

      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {rows.map((d, i) => (
            <tr key={`${d.label}-${i}`}>
              <th scope="row">{d.label}</th>
              <td>{d.detail || format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
