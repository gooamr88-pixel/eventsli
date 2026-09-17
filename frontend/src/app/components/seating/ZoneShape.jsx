'use client';

import { WORLD } from './seatingGeometry';
import { zoneBox, zoneColor, zoneLabel, zoneMeta } from './venueZones';
import { iconPaths, ZONE_ICON_VIEWBOX } from './zoneIcons';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One venue zone, drawn. The editor, the buyer's map and the printed pack all
 * render zones through this — there is no second implementation to drift.
 *
 * DRAWN UNDER THE STOCK, ALWAYS. A zone is the room; tables and seats are what
 * is being chosen between. Callers place every `<ZoneShape>` before their
 * tables in document order, because SVG has no z-index and paint order is the
 * only thing that decides. A dance floor painted over the seats it surrounds is
 * a map you cannot buy from.
 *
 * `interactive` is what separates the two uses. In the editor a zone is grabbed,
 * selected and dragged. On the buyer's map it is scenery: no pointer events, no
 * tab stop, `aria-hidden`, because a screen-reader user tabbing through forty
 * pieces of furniture to reach the seats has been given an obstacle, not
 * information. The buyer's map names its zones in a text summary instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ZoneShape({
  zone,
  selected = false,
  interactive = false,
  // The on-screen scale, so a border stays a border. Everything inside the
  // canvas sits under one viewBox, and a stroke defined in world units grows
  // and shrinks with the zoom: at a zoomed-out scale a "2px" selection outline
  // renders thinner than a pixel and selection reads as "clicking does
  // nothing". Dividing by the scale holds these at a constant screen size.
  scale = 1,
  onPointerDown,
  onKeyDown,
  children,
}) {
  const box = zoneBox(zone, WORLD);
  const meta = zoneMeta(zone.kind);
  const color = zoneColor(zone);
  const label = zoneLabel(zone);

  const inv = (n) => n / Math.max(scale, 0.0001);

  // Below this a chip has nowhere to sit: the icon alone fills the shape and
  // the text would spill past both edges. The label still exists — it is just
  // carried by the zone's own tooltip and the inspector instead of drawn.
  const roomForIcon = Math.min(box.w, box.h) >= 34;
  const iconSize = clamp(Math.min(box.w, box.h) / 3.4, 11, 20);
  const fontSize = clamp(Math.min(box.w, box.h) / 3.6, 8, 15);
  const gap = roomForIcon ? fontSize * 0.34 : 0;
  const stackH = (roomForIcon ? iconSize + gap : 0) + fontSize;

  return (
    <g
      transform={`translate(${box.cx} ${box.cy}) rotate(${box.rotation})`}
      data-zone-id={zone.id}
      onPointerDown={interactive ? onPointerDown : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
      style={interactive ? { cursor: 'move' } : undefined}
      {...(interactive
        ? { role: 'button', tabIndex: 0, 'aria-label': `${label}, ${meta.label}${selected ? ', selected' : ''}` }
        : { 'aria-hidden': true, style: { pointerEvents: 'none' } })}
    >
      <rect
        x={-box.w / 2} y={-box.h / 2} width={box.w} height={box.h}
        rx={Math.min(8, Math.min(box.w, box.h) / 5)}
        // The wash is the zone's own hue at low alpha, mixed here rather than
        // stored — so a zone can never end up with a fill and an outline that
        // disagree, which is what happens when both are columns.
        fill={color}
        fillOpacity={selected ? 0.2 : 0.12}
        stroke={selected ? 'var(--es-accent)' : color}
        strokeWidth={selected ? inv(2.5) : inv(1.25)}
        // Dashed, and that carries real weight on the printed pack: half of
        // these go through a mono laser where every zone colour arrives as the
        // same grey. A dashed outline still says "this is floor, not a table"
        // after the colour is gone.
        strokeDasharray={selected ? undefined : `${inv(5)} ${inv(4)}`}
      />

      {roomForIcon && (
        <ZoneGlyph name={meta.icon} size={iconSize} color={color} y={-stackH / 2} />
      )}

      <text
        x={0}
        // Baseline, not centre: `dominant-baseline` is the one SVG text
        // property that is unreliable across print renderers, and this text has
        // to land in the same place on paper as it does on screen.
        y={-stackH / 2 + (roomForIcon ? iconSize + gap : 0) + fontSize * 0.8}
        textAnchor="middle"
        fill={color}
        style={{
          fontSize, fontWeight: 600, letterSpacing: '0.02em',
          pointerEvents: 'none', textTransform: 'uppercase',
        }}
      >
        {fit(label, box.w, fontSize)}
      </text>

      {/* Selection handles and anything else the editor hangs off a zone. The
          buyer and the print path pass none. */}
      {children}
    </g>
  );
}

/** The glyph, scaled from its 24-unit grid onto the zone and centred. */
function ZoneGlyph({ name, size, color, y }) {
  const paths = iconPaths(name);
  if (paths.length === 0) return null;
  const k = size / ZONE_ICON_VIEWBOX;

  return (
    <g
      transform={`translate(${-size / 2} ${y}) scale(${k})`}
      fill="none"
      stroke={color}
      strokeWidth={1.7 / k * (size / 20)}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ pointerEvents: 'none' }}
    >
      {paths.map((d) => <path key={d} d={d} />)}
    </g>
  );
}

/**
 * Truncates a label to what the zone can actually hold.
 *
 * SVG text does not wrap and does not clip — it just keeps drawing, straight
 * across the tables either side. An ellipsis is the honest version of running
 * out of room; the full name is always one click away in the inspector, and
 * always complete in the printed index.
 *
 * 0.58em per character is the measured average for the UI sans at these
 * weights. Approximate on purpose: measuring text properly means a DOM call per
 * zone per frame, and the cost of being a little conservative is a label that
 * stops slightly early.
 */
function fit(label, width, fontSize) {
  const max = Math.max(3, Math.floor((width * 0.86) / (fontSize * 0.58)));
  return label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
