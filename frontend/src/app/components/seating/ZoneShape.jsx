'use client';

import { worldOf } from './seatingGeometry';
import { zoneBox, zoneColor, zoneInk, zoneLabel, zoneMeta } from './venueZones';
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
  // The map's world (seatingGeometry.worldOf); the zone's x/y are percentages of it.
  world = worldOf(null),
  onPointerDown,
  onKeyDown,
  children,
  // The buyer's map: see StageShowcase and the solid tile below. Off for the
  // editor and the printed pack, whose dashed outlines survive a photocopier.
  showcase = false,
}) {
  const box = zoneBox(zone, world);
  if (showcase && zone.kind === 'stage') return <StageShowcase box={box} label={zoneLabel(zone)} />;
  if (showcase && SHOWCASE_PLAIN.has(zone.kind)) return <PlainShowcase box={box} kind={zone.kind} />;
  if (showcase && Math.min(box.w, box.h) < 56) {
    return <BadgeShowcase box={box} label={zoneLabel(zone)} icon={zoneMeta(zone.kind).icon} color={zoneColor(zone)} />;
  }
  const meta = zoneMeta(zone.kind);
  const color = zoneColor(zone);
  // The words and the glyph, darkened just enough to read on the zone's own wash.
  const ink = zoneInk(color);
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
        fillOpacity={selected ? 0.2 : showcase ? 0.16 : 0.12}
        stroke={selected ? 'var(--es-accent)' : color}
        strokeOpacity={showcase ? 0.45 : 1}
        strokeWidth={selected ? inv(2.5) : inv(1.25)}
        // Dashed, and that carries real weight on the printed pack: half of
        // these go through a mono laser where every zone colour arrives as the
        // same grey. A dashed outline still says "this is floor, not a table"
        // after the colour is gone.
        strokeDasharray={selected || showcase ? undefined : `${inv(5)} ${inv(4)}`}
      />

      {roomForIcon && (
        <ZoneGlyph name={meta.icon} size={iconSize} color={ink} y={-stackH / 2} />
      )}

      <text
        x={0}
        // Baseline, not centre: `dominant-baseline` is the one SVG text
        // property that is unreliable across print renderers, and this text has
        // to land in the same place on paper as it does on screen.
        y={-stackH / 2 + (roomForIcon ? iconSize + gap : 0) + fontSize * 0.8}
        textAnchor="middle"
        fill={ink}
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

/**
 * The stage on the buyer's map: a dark deck with a lit front edge and its name
 * in white. It is the one thing every seat on the map is chosen in relation
 * to, so it is drawn as the room's anchor rather than as one more pale box.
 * Fixed colours, not theme roles: it is a picture of a stage, dark in both
 * themes, and the white label on #12262a measures 15:1.
 */
function StageShowcase({ box, label }) {
  const id = `stage-${Math.round(box.cx)}-${Math.round(box.cy)}`;
  const r = Math.min(10, Math.min(box.w, box.h) / 4);
  const size = clamp(Math.min(box.h * 0.32, box.w / Math.max(label.length, 4) * 1.3), 9, 22);
  return (
    <g transform={`translate(${box.cx} ${box.cy}) rotate(${box.rotation})`} aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d3a3e" />
          <stop offset="1" stopColor="#0b1a1c" />
        </linearGradient>
      </defs>
      <rect x={-box.w / 2} y={-box.h / 2} width={box.w} height={box.h} rx={r} fill={`url(#${id})`} />
      <rect x={-box.w / 2 + r} y={box.h / 2 - 3.5} width={Math.max(0, box.w - r * 2)} height={3.5} rx={1.75} fill="#5fe0d6" />
      <text
        x={0} y={size * 0.36} textAnchor="middle" fill="#ffffff"
        style={{ fontSize: size, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}
      >
        {fit(label, box.w - 8, size)}
      </text>
    </g>
  );
}

/** Zones the buyer's map draws as plain shapes, with no words at all. */
const SHOWCASE_PLAIN = new Set(['barrier', 'aisle']);

/** A barrier is a solid rail; a walkway is a quiet band of floor. */
function PlainShowcase({ box, kind }) {
  const barrier = kind === 'barrier';
  return (
    <g transform={`translate(${box.cx} ${box.cy}) rotate(${box.rotation})`} aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <rect
        x={-box.w / 2} y={barrier ? -3 : -box.h / 2} width={box.w} height={barrier ? 6 : box.h} rx={barrier ? 3 : box.h / 2}
        fill={barrier ? '#55595f' : 'var(--es-border)'} fillOpacity={barrier ? 0.85 : 0.6}
      />
    </g>
  );
}

/**
 * A small area on the buyer's map — an entrance, accessible seating, the
 * restrooms — as a solid badge with its glyph in white and its name in plain
 * words beneath, at a size a buyer can read. Squeezed into its own box the
 * name came out as "ACCESSI…" in 8-point capitals.
 */
function BadgeShowcase({ box, label, icon, color }) {
  const s = 34;
  const k = (s * 0.7) / ZONE_ICON_VIEWBOX;
  return (
    <g transform={`translate(${box.cx} ${box.cy})`} aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <rect x={-s / 2} y={-s / 2} width={s} height={s} rx={7} fill={color} />
      <g transform={`translate(${-s * 0.35} ${-s * 0.35}) scale(${k})`} fill="none" stroke="#ffffff" strokeWidth={2 / k * (s / 26) * 0.9} strokeLinecap="round" strokeLinejoin="round">
        {iconPaths(icon).map((d) => <path key={d} d={d} />)}
      </g>
      <text y={s / 2 + 19} textAnchor="middle" className="fill-ink" style={{ fontSize: 17, fontWeight: 600 }}>
        {fit(label, 220, 17)}
      </text>
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
