'use client';

import { zoneMeta } from '../../../../components/seating/venueZones';
import { iconPaths, ZONE_ICON_VIEWBOX } from '../../../../components/seating/zoneIcons';

/**
 * A zone's glyph, on its own, at interface size.
 *
 * Separate from `ZoneShape` because the two draw for different reasons.
 * `ZoneShape` draws a zone AS IT IS ON THE MAP — at its stored size, in the
 * canvas's world units, inside a transform that is being panned and zoomed.
 * This draws the KIND, in a fixed box, in ordinary layout flow: a tile in the
 * Add dialog, a marker beside the label in the inspector.
 *
 * Making `ZoneShape` do both would mean giving it a second sizing mode and a
 * second coordinate convention, which is precisely the kind of "one component,
 * two jobs" that ends up wrong in the job nobody was looking at.
 */
export default function ZonePreview({ kind, size = 24, color }) {
  const meta = zoneMeta(kind);
  const paths = iconPaths(meta.icon);
  const ink = color || meta.color;

  return (
    <svg
      width={size} height={size}
      viewBox={`0 0 ${ZONE_ICON_VIEWBOX} ${ZONE_ICON_VIEWBOX}`}
      fill="none"
      stroke={ink}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      role="presentation"
    >
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
