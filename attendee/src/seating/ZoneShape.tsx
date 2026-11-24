import { memo } from 'react';
import { Defs, Ellipse, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { fonts } from '@/ui/theme';

import type { MapModel, Zone } from './model';
import { venueZones, zoneIcons } from './shared';

const { zoneBox, zoneColor, zoneInk, zoneLabel, zoneMeta } = venueZones;
const { iconPaths, ZONE_ICON_VIEWBOX } = zoneIcons;

/**
 * One piece of the venue's furniture — the stage, a bar, the entrances, a
 * wall — drawn the way the website's buyer map draws it (ZoneShape.jsx in its
 * "showcase" mode): the stage as a dark deck with a lit front edge, small
 * areas as a solid badge, the rest as a tinted area with its icon and name.
 *
 * Scenery only. Nothing here takes a touch: the map's hit-test looks at seats
 * and tables, never at zones, so a dance floor can never swallow a tap meant
 * for the seat beside it.
 */
type Props = { zone: Zone; world: MapModel['world']; floor: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** As many characters as fit across `width` at this size, with an ellipsis. */
function fit(text: string, width: number, size: number) {
  const max = Math.max(3, Math.floor(width / (size * 0.62)));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function Glyph({ name, size, color, y }: { name: string; size: number; color: string; y: number }) {
  const paths = iconPaths(name);
  if (!paths.length) return null;
  const k = size / ZONE_ICON_VIEWBOX;
  return (
    <G transform={`translate(${-size / 2} ${y}) scale(${k})`}>
      {paths.map((d) => (
        <Path key={d} d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </G>
  );
}

function ZoneShapeImpl({ zone, world, floor }: Props) {
  const box = zoneBox(zone, world);
  const { w, h } = box;
  const at = `translate(${box.cx} ${box.cy}) rotate(${box.rotation})`;
  const label = zoneLabel(zone);
  const color = zoneColor(zone);

  if (zone.kind === 'stage') {
    const r = Math.min(10, Math.min(w, h) / 4);
    const size = clamp(Math.min(h * 0.32, (w / Math.max(label.length, 4)) * 1.3), 9, 22);
    const id = `stage-${zone.id}`;
    return (
      <G transform={at}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#2a2936" />
            <Stop offset="1" stopColor="#111018" />
          </LinearGradient>
        </Defs>
        <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={r} fill={`url(#${id})`} />
        <Rect x={-w / 2 + r} y={h / 2 - 3.5} width={Math.max(0, w - r * 2)} height={3.5} rx={1.75} fill="#ffcc00" />
        <SvgText x={0} y={size * 0.36} textAnchor="middle" fill="#ffffff" fontSize={size} fontFamily={fonts.display} letterSpacing={size * 0.14}>
          {fit(label.toUpperCase(), w - 8, size * 1.1)}
        </SvgText>
      </G>
    );
  }

  if (zone.kind === 'barrier' || zone.kind === 'aisle') {
    const barrier = zone.kind === 'barrier';
    return (
      <G transform={at}>
        <Rect x={-w / 2} y={barrier ? -3 : -h / 2} width={w} height={barrier ? 6 : h} rx={barrier ? 3 : h / 2}
          fill={barrier ? '#55595f' : '#e3e3e8'} fillOpacity={barrier ? 0.85 : 0.7} />
      </G>
    );
  }

  if (zone.kind === 'wall') {
    return <G transform={at}><Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={color} /></G>;
  }

  if (zone.kind === 'door_gap') {
    return (
      <G transform={at}>
        <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill={floor} />
        <SvgText y={-h / 2 - Math.max(5, h * 0.4)} textAnchor="middle" fill={zoneInk(color)} fontSize={clamp(w / 5, 8, 16)} fontFamily={fonts.semibold}>
          {label}
        </SvgText>
      </G>
    );
  }

  if (zone.kind === 'text') {
    if (zone.showLabel === false) return null;
    const size = clamp(h * 0.62, 8, 60);
    return (
      <G transform={at}>
        <SvgText y={size * 0.35} textAnchor="middle" fill={zoneInk(color)} fontSize={size} fontFamily={fonts.bold}>{fit(label, w, size)}</SvgText>
      </G>
    );
  }

  if (zone.shape === 'rings' || zone.kind === 'decor') {
    return (
      <G transform={at}>
        <Ellipse rx={w / 2} ry={h / 2} fill={color} fillOpacity={0.22} />
        <Ellipse rx={w * 0.38} ry={h * 0.38} fill={color} fillOpacity={0.85} />
        <Ellipse rx={w * 0.24} ry={h * 0.24} fill={zone.fill || '#356e45'} />
        <Ellipse rx={Math.max(2, w * 0.045)} ry={Math.max(2, h * 0.045)} fill="#e8c15a" />
      </G>
    );
  }

  if (zone.kind === 'booth') {
    const size = clamp(Math.min(w, h) / 3, 7, 14);
    return (
      <G transform={at}>
        <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3} fill={color} fillOpacity={0.22} stroke={color} strokeOpacity={0.6} strokeWidth={1} />
        <SvgText y={size * 0.35} textAnchor="middle" fill={zoneInk(color)} fontSize={size} fontFamily={fonts.bold}>{fit(label, w - 2, size)}</SvgText>
      </G>
    );
  }

  const meta = zoneMeta(zone.kind);
  const ink = zoneInk(color);

  // A small area — an entrance, the restrooms — is a solid badge with its
  // name in plain words under it, as on the website: squeezed into its own
  // box the name came out as "ACCESSI…".
  if (Math.min(w, h) < 56) {
    const s = 30;
    const k = (s * 0.7) / ZONE_ICON_VIEWBOX;
    return (
      <G transform={`translate(${box.cx} ${box.cy})`}>
        <Rect x={-s / 2} y={-s / 2} width={s} height={s} rx={7} fill={color} />
        <G transform={`translate(${-s * 0.35} ${-s * 0.35}) scale(${k})`}>
          {iconPaths(meta.icon).map((d) => (
            <Path key={d} d={d} fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </G>
        <SvgText y={s / 2 + 14} textAnchor="middle" fill="#111018" fontSize={12} fontFamily={fonts.semibold}>{fit(label, 160, 12)}</SvgText>
      </G>
    );
  }

  const shape = zone.shape || 'rounded';
  const fill = zone.fill || color;
  const fillOpacity = zone.fill ? zone.fillOpacity ?? 1 : zone.fillOpacity ?? 0.16;
  const textInk = zone.fill && fillOpacity >= 0.5 ? '#ffffff' : ink;
  const iconSize = clamp(Math.min(w, h) / 3.4, 11, 22);
  const fontSize = clamp(Math.min(w, h) / 3.6, 8, 16);
  const stackH = iconSize + fontSize * 0.34 + fontSize;
  return (
    <G transform={at}>
      {shape === 'ellipse' ? (
        <Ellipse rx={w / 2} ry={h / 2} fill={fill} fillOpacity={fillOpacity} stroke={color} strokeOpacity={0.45} strokeWidth={1.25} />
      ) : (
        <Rect x={-w / 2} y={-h / 2} width={w} height={h}
          rx={shape === 'pill' ? Math.min(w, h) / 2 : shape === 'rect' ? 0 : Math.min(10, Math.min(w, h) / 5)}
          fill={fill} fillOpacity={fillOpacity} stroke={color} strokeOpacity={0.45} strokeWidth={1.25} />
      )}
      {zone.showLabel === false ? null : (
        <>
          <Glyph name={meta.icon} size={iconSize} color={textInk} y={-stackH / 2} />
          <SvgText y={-stackH / 2 + iconSize + fontSize * 0.34 + fontSize * 0.8} textAnchor="middle" fill={textInk} fontSize={fontSize} fontFamily={fonts.semibold} letterSpacing={fontSize * 0.04}>
            {fit(label.toUpperCase(), w, fontSize)}
          </SvgText>
        </>
      )}
    </G>
  );
}

export const ZoneShape = memo(ZoneShapeImpl);
