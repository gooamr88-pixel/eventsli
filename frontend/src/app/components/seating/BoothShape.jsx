'use client';

import { zoneBox } from './venueZones';
import { worldOf } from './seatingGeometry';
import { BOOTH_INK, boothSentence, boothStatus } from './boothZones';
import { SoldBadge, BlockedMark } from '../vendors/floorPlan/FloorPlanShapes';
import { textOn } from '../vendors/floorPlan/floorPlanModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A vendor booth drawn ON THE VENUE MAP (2026-11-22) — the editor's canvas and
 * the buyer's seat map. The same look as the vendor floor plan
 * (FloorPlanShapes.Booth): the booth type's colour with its code, grey with a
 * pink SOLD rosette once booked, hatched while reserved, a "no entry" mark
 * when unavailable. A booth reads the same on every screen it appears on.
 *
 * Drawn about its centre, like every zone (venueZones.zoneBox), so the
 * editor's selection handles hang off it exactly as they do off a stage.
 *
 * `state` and `color` come from the caller (the editor looks them up live);
 * the buyer's map folds them into the zone itself (boothZones.boothsToZones).
 * `audience: 'buyer'` drops the sale status: a ticket buyer wants to know
 * where the coffee stand is, not which booths are still for sale.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const NS = { vectorEffect: 'non-scaling-stroke' };

export default function BoothShape({
  zone, world = worldOf(null), state = zone.state || null, color = zone.typeColor || null,
  selected = false, interactive = false, onPointerDown, onKeyDown, children, audience = 'organizer',
}) {
  const box = zoneBox(zone, world);
  const w = box.w;
  const h = box.h;
  const buyer = audience === 'buyer';
  const status = buyer ? 'available' : boothStatus(zone, state);
  const taken = status === 'sold' || status === 'blocked';
  const fill = buyer ? (state?.vendor ? (color || BOOTH_INK.free) : BOOTH_INK.free) : taken ? BOOTH_INK.taken : (color || BOOTH_INK.free);
  const ink = textOn(fill);
  const code = String(zone.label || '').trim();
  const short = Math.min(w, h);
  const badge = Math.max(4, short * 0.34);
  const codeSize = Math.max(6, Math.min(short * 0.3, (w / Math.max(2, code.length)) * 1.4));
  // The vendor's name, under the code, where the booth is big enough to carry it.
  const vendor = state?.vendor?.name || '';
  const nameSize = Math.max(5, Math.min(short * 0.15, (w * 0.9) / Math.max(4, Math.min(vendor.length, 18)) * 1.7));
  const showName = !!vendor && short >= 40 && status !== 'blocked';
  const showCode = !!code && (status === 'available' || status === 'held' || buyer);

  return (
    <g
      transform={`translate(${box.cx} ${box.cy}) rotate(${box.rotation})`}
      data-zone-id={zone.id}
      data-booth-status={status}
      onPointerDown={interactive ? onPointerDown : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
      style={interactive ? { cursor: 'move' } : { pointerEvents: 'none' }}
      {...(interactive
        ? { role: 'button', tabIndex: 0, 'aria-label': `${boothSentence(zone, state)}${selected ? ', selected' : ''}` }
        : { 'aria-hidden': true })}
    >
      <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={fill} stroke={BOOTH_INK.stroke} strokeWidth={1.2} style={NS} />
      {status === 'held' && <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="url(#es-booth-hatch)" stroke="none" />}
      {status === 'sold' && <SoldBadge cx={0} cy={showName ? -h * 0.1 : 0} r={showName ? badge * 0.8 : badge} />}
      {status === 'blocked' && <BlockedMark cx={0} cy={0} r={badge * 0.86} />}
      {showCode && (
        <text
          x={0} y={showName ? -nameSize * 0.55 : 0} fontSize={codeSize} fontWeight="700" textAnchor="middle"
          dominantBaseline="central" fill={ink} style={{ pointerEvents: 'none' }}
        >
          {code}
        </text>
      )}
      {showName && (
        <text
          x={0} y={status === 'sold' ? h * 0.32 : codeSize * 0.75} fontSize={nameSize} fontWeight="600" textAnchor="middle"
          dominantBaseline="central" fill={status === 'sold' ? '#ffffff' : ink} style={{ pointerEvents: 'none' }}
        >
          {fit(vendor, w * 0.92, nameSize)}
        </text>
      )}
      {selected && (
        <rect
          x={-w / 2 - 2} y={-h / 2 - 2} width={w + 4} height={h + 4} fill="none"
          stroke="var(--es-accent)" strokeWidth={2} style={NS}
        />
      )}
      {children}
    </g>
  );
}

/** The hatch a reserved booth wears. Rendered once inside each canvas's SVG. */
export function BoothDefs() {
  return (
    <defs>
      <pattern id="es-booth-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="rgb(255 255 255 / 0.25)" />
        <line x1="0" y1="0" x2="0" y2="8" stroke="rgb(17 16 24 / 0.35)" strokeWidth="3" />
      </pattern>
    </defs>
  );
}

function fit(label, width, fontSize) {
  const max = Math.max(3, Math.floor(width / (fontSize * 0.56)));
  return label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`;
}
