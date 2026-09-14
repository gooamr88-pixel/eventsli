import { ringDash } from './chartMath';

/**
 * A progress ring: checked-in of issued, sold of capacity. The number beside it
 * is real text, so the ring itself is decoration and hidden from a screen reader.
 */
export default function Ring({ fraction, value, caption, size = 88 }) {
  return (
    <div className="fx-row">
      <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" focusable="false">
        <circle className="es-chart__track" cx="18" cy="18" r="15.915" strokeWidth="3.5" />
        <circle
          className="es-chart__ring"
          cx="18"
          cy="18"
          r="15.915"
          strokeWidth="3.5"
          strokeDasharray={ringDash(fraction)}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <div className="fx-stack fx-stack--sm gap-0.5">
        <span className="es-stat__value">{value}</span>
        {caption && <span className="text-sm text-muted">{caption}</span>}
      </div>
    </div>
  );
}
