'use client';

import NavIcon from '../shell/NavIcon';

/**
 * A venue map's thumbnail (2026-11-24), drawn from the summary's `sketch`
 * (backend venueMapTemplateService.sketchOf): the walls, the stage, the
 * areas and every table or row — cropped to what is drawn. Light enough for
 * a grid of a hundred cards; the full map is the preview's job.
 */
export default function VenueMapThumb({ sketch, label }) {
  const t = sketch?.t || [];
  const z = sketch?.z || [];
  if (t.length === 0 && z.length === 0) {
    return <span className="es-vmthumb es-vmthumb--empty" aria-hidden="true"><NavIcon name="map" size={30} /></span>;
  }

  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const grow = (x, y, rx, ry) => {
    x0 = Math.min(x0, x - rx); y0 = Math.min(y0, y - ry);
    x1 = Math.max(x1, x + rx); y1 = Math.max(y1, y + ry);
  };
  for (const [x, y, row, size] of t) grow(x, y, row ? size / 2 : size, row ? size / 2 : size);
  for (const [x, y, w, h] of z) grow(x, y, Math.max(w, h) / 2, Math.max(w, h) / 2);
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06 + 4;
  const box = `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`;

  return (
    <svg className="es-vmthumb" viewBox={box} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      {z.map(([x, y, w, h, rot, k], i) => (
        <rect
          key={`z${i}`}
          x={x - w / 2} y={y - h / 2} width={w} height={h} rx={k === 'w' ? 0 : Math.min(w, h) * 0.12}
          transform={rot ? `rotate(${rot} ${x} ${y})` : undefined}
          className={`es-vmthumb__zone es-vmthumb__zone--${k}`}
        />
      ))}
      {t.map(([x, y, row, size, rot], i) => (row ? (
        <rect
          key={`t${i}`}
          x={x - size / 2} y={y - 8} width={size} height={16} rx={8}
          transform={rot ? `rotate(${rot} ${x} ${y})` : undefined}
          className="es-vmthumb__row"
        />
      ) : (
        <circle key={`t${i}`} cx={x} cy={y} r={size} className="es-vmthumb__table" />
      )))}
    </svg>
  );
}
