'use client';

import { zoneColor, zoneInk, zoneLabel, zoneMeta } from './venueZones';
import { iconPaths, ZONE_ICON_VIEWBOX } from './zoneIcons';
import { inkOn, lookFont } from './mapStyle';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A zone drawn the way the organizer styled it (2026-11-18): its own shape,
 * fill, border and words — and the room itself, walls, door gaps and text.
 *
 * `ZoneShape` hands a zone here when it carries any style, or is one of the
 * room kinds. Unstyled furniture keeps its stock look there, so every map saved
 * before styling existed draws exactly as it did.
 *
 * Unlike stock furniture, a styled zone looks the same in the editor, on the
 * buyer's map and on paper: what the organizer designed is what is sold from.
 * Border widths are world units here, as the organizer set them, so they scale
 * with the room like the walls in a drawn plan; only the selection ring stays a
 * constant size on screen.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const DEFAULT_SHAPE = { wall: 'rect', door_gap: 'rect', text: 'rect', decor: 'rings' };
const TEXT_SCALE = { s: 0.78, m: 1, l: 1.4 };

export default function StyledZoneShape({
  zone, box, selected, interactive, scale = 1, look = null, onPointerDown, onKeyDown, children,
}) {
  const meta = zoneMeta(zone.kind);
  const isWall = zone.kind === 'wall';
  const isDoor = zone.kind === 'door_gap';
  const isText = zone.kind === 'text';
  const color = zone.color ? zoneColor(zone) : (isWall || isDoor) && look?.wall ? look.wall : zoneColor(zone);
  const shape = zone.shape || DEFAULT_SHAPE[zone.kind] || 'rounded';
  const inv = (n) => n / Math.max(scale, 0.0001);
  const label = zoneLabel(zone);
  const font = lookFont(look);
  const w = box.w;
  const h = box.h;

  // Fill: a door is the floor showing through the wall; a wall is solid; text
  // has none; everything else is its own fill, or its colour as a wash.
  let fill = zone.fill || color;
  let fillOpacity = zone.fill ? (zone.fillOpacity ?? 1) : (zone.fillOpacity ?? 0.16);
  if (isWall) { fill = color; fillOpacity = zone.fillOpacity ?? 1; }
  if (isDoor) { fill = look?.floor || 'var(--es-surface)'; fillOpacity = 1; }
  if (isText) { fillOpacity = zone.fill ? (zone.fillOpacity ?? 1) : 0; }

  const strokeStyle = zone.strokeStyle || (isWall || isDoor || isText ? 'none' : 'solid');
  const strokeWidth = strokeStyle === 'none' ? 0 : (zone.strokeWidth ?? 1.5);
  const dash = strokeStyle === 'dashed' ? `${strokeWidth * 4} ${strokeWidth * 3}`
    : strokeStyle === 'dotted' ? `0 ${strokeWidth * 2.2}` : undefined;

  // Words on the area's own fill are inked for that fill; words on the floor
  // (text, rings' name, a door's name) follow the look's label colour.
  const onFill = zone.fill && !isText && shape !== 'rings' && (zone.fillOpacity ?? 1) >= 0.5;
  const ink = zone.textColor || (onFill ? inkOn(zone.fill) : look?.label || zoneInk(color)) || '#111018';
  const showIcon = zone.showIcon ?? (!isWall && !isDoor && !isText && !zone.sublabel && shape !== 'rings');

  const base = clamp(Math.min(w, h) / 3.2, 8, 22) * (TEXT_SCALE[zone.textSize] || 1);
  const fontSize = isText ? clamp(h * 0.62, 8, 60) * (TEXT_SCALE[zone.textSize] || 1) : base;
  const subSize = Math.max(7, fontSize * 0.5);
  const iconSize = clamp(Math.min(w, h) / 3.4, 10, 22);
  // Rings carry no words unless the organizer named them, and then below.
  const rings = shape === 'rings';
  const showText = zone.showLabel !== false && !(rings && !String(zone.label || '').trim());
  const lines = [label, ...(zone.sublabel ? zone.sublabel.split(/\s*[·|]\s*|\n/).filter(Boolean).slice(0, 3) : [])];
  const stackH = (showIcon ? iconSize + fontSize * 0.3 : 0) + fontSize + (lines.length - 1) * (subSize * 1.25);

  // A wall a few units thick is too thin to grab; the hit area is not.
  const hitPad = interactive ? Math.max(0, inv(7) - Math.min(w, h) / 2) : 0;

  return (
    <g
      transform={`translate(${box.cx} ${box.cy}) rotate(${box.rotation})`}
      data-zone-id={zone.id}
      onPointerDown={interactive ? onPointerDown : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
      {...(interactive
        ? { role: 'button', tabIndex: 0, style: { cursor: 'move' }, 'aria-label': `${label}${label !== meta.label ? `, ${meta.label}` : ''}${selected ? ', selected' : ''}` }
        : { 'aria-hidden': true, style: { pointerEvents: 'none' } })}
    >
      {hitPad > 0 && (
        <rect x={-w / 2 - hitPad} y={-h / 2 - hitPad} width={w + hitPad * 2} height={h + hitPad * 2} fill="transparent" />
      )}

      {shape === 'rings' ? (
        <Rings w={w} h={h} color={color} fill={zone.fill} stroke={strokeWidth ? color : 'none'} strokeWidth={strokeWidth} dash={dash} />
      ) : (
        <Outline
          shape={shape} w={w} h={h}
          fill={fill} fillOpacity={fillOpacity}
          stroke={strokeWidth ? color : 'none'} strokeWidth={strokeWidth} dash={dash}
        />
      )}

      {/* Interactive text needs something to grab even with no fill. */}
      {isText && interactive && <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="transparent" />}

      {selected && (
        <rect
          x={-w / 2 - inv(4)} y={-h / 2 - inv(4)} width={w + inv(8)} height={h + inv(8)} rx={inv(4)}
          fill="none" stroke="var(--es-accent)" strokeWidth={inv(1.5)} strokeDasharray={`${inv(4)} ${inv(3)}`}
        />
      )}

      {isDoor && (
        <text
          y={-h / 2 - Math.max(5, h * 0.4)} textAnchor="middle" fill={ink}
          style={{ fontSize: clamp(w / 5, 8, 16), fontWeight: font.fontWeight, fontFamily: font.fontFamily, pointerEvents: 'none' }}
        >
          {label}
        </text>
      )}

      {!isWall && !isDoor && showText && (
        <g style={{ pointerEvents: 'none' }} transform={rings ? `translate(0 ${h / 2 + stackH / 2 + 6})` : undefined}>
          {showIcon && <Glyph name={meta.icon} size={iconSize} color={ink} y={-stackH / 2} />}
          {lines.map((line, i) => {
            const top = -stackH / 2 + (showIcon ? iconSize + fontSize * 0.3 : 0);
            const y = i === 0 ? top + fontSize * 0.8 : top + fontSize + (i - 0.15) * subSize * 1.25;
            const size = i === 0 ? fontSize : subSize;
            return (
              <text
                key={`${i}-${line}`} x={0} y={y} textAnchor="middle" fill={ink}
                style={{
                  fontSize: size,
                  fontWeight: i === 0 ? font.fontWeight : 400,
                  fontFamily: font.fontFamily,
                }}
              >
                {fit(line, rings ? w * 2 : w, size)}
              </text>
            );
          })}
        </g>
      )}

      {children}
    </g>
  );
}

/** A zone's outline in one of the styled shapes, centred on (0,0). */
export function Outline({ shape, w, h, ...paint }) {
  const props = {
    fill: paint.fill, fillOpacity: paint.fillOpacity,
    stroke: paint.stroke, strokeWidth: paint.strokeWidth, strokeDasharray: paint.dash,
    strokeLinecap: paint.dash && paint.dash.startsWith('0 ') ? 'round' : undefined,
  };
  if (shape === 'ellipse') return <ellipse rx={w / 2} ry={h / 2} {...props} />;
  if (shape === 'd') {
    const r = Math.min(h / 2, w);
    const xc = w / 2 - r;
    return <path d={`M${-w / 2} ${-h / 2}H${xc}A${r} ${h / 2} 0 0 1 ${xc} ${h / 2}H${-w / 2}Z`} {...props} />;
  }
  const rx = shape === 'pill' ? Math.min(w, h) / 2 : shape === 'rounded' ? Math.min(10, Math.min(w, h) / 5) : 0;
  return <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={rx} {...props} />;
}

/** The decorative centrepiece: three rings and a dot, like a fountain on a plan. */
function Rings({ w, h, color, fill, stroke, strokeWidth, dash }) {
  return (
    <g>
      <ellipse rx={w / 2} ry={h / 2} fill={color} fillOpacity={0.22} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dash} />
      <ellipse rx={w * 0.38} ry={h * 0.38} fill={color} fillOpacity={0.85} />
      <ellipse rx={w * 0.24} ry={h * 0.24} fill={fill || '#356e45'} />
      <ellipse rx={Math.max(2, w * 0.045)} ry={Math.max(2, h * 0.045)} fill="#e8c15a" />
    </g>
  );
}

function Glyph({ name, size, color, y }) {
  const paths = iconPaths(name);
  if (paths.length === 0) return null;
  const k = size / ZONE_ICON_VIEWBOX;
  return (
    <g
      transform={`translate(${-size / 2} ${y}) scale(${k})`}
      fill="none" stroke={color} strokeWidth={1.7 / k * (size / 20)} strokeLinecap="round" strokeLinejoin="round"
    >
      {paths.map((d) => <path key={d} d={d} />)}
    </g>
  );
}

function fit(label, width, fontSize) {
  const max = Math.max(3, Math.floor((width * 0.92) / (fontSize * 0.56)));
  return label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
