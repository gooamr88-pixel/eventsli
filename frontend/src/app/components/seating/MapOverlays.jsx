'use client';

/**
 * The Venue Studio's two layers on the buyer's 2D map, both scenery: a tinted
 * plate behind each section's seats (sectionPlates.js draws the outline), and
 * the section's name above them. Neither takes a pointer, so picking a seat
 * is unchanged.
 */
export function SectionPlates({ plates }) {
  return plates.map((pl) => (
    <path
      key={pl.key} d={pl.d} fill={pl.color} fillOpacity={0.13} stroke={pl.color} strokeOpacity={0.35}
      strokeWidth={2} strokeLinejoin="round" style={{ pointerEvents: 'none' }} aria-hidden="true"
    />
  ));
}

/** `scale` is `seatingGeometry.worldScale(world)`: 1 in a default-sized room,
 *  larger in a stadium, so a section name can still be read when it is fitted. */
export function SectionBadges({ badges, scale = 1, under = false }) {
  // `under`: drawn beneath the seats (the buyer's map), so the seats paint
  // over the name; `.es-mapbadges--under` lightens it to a floor label.
  return badges.map((b) => (
    <g key={b.key} className={under ? 'es-mapbadges--under' : undefined} transform={`translate(${b.x} ${b.y})${scale !== 1 ? ` scale(${scale})` : ''}`} style={{ pointerEvents: 'none' }} aria-hidden="true">
      <rect x={-b.text.length * 7.6 - 14} y={-17} width={b.text.length * 15.2 + 28} height={34} rx={17} className="es-mapbadge" />
      <text y={7} textAnchor="middle" className="es-mapbadge__text">{b.text}</text>
    </g>
  ));
}
