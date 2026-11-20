import { INK, textOn, typeColor } from './floorPlanModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Drawing the vendor floor plan (2026-11-20), element by element, in the look
 * of the owner's reference plans. Pure SVG, no state: the editor, the
 * organizer's booth picker, the vendor's booking and the public page all draw
 * through this one file, so a booth looks the same everywhere.
 *
 * Strokes are `non-scaling-stroke`: a wall is the same hairline at every zoom,
 * as on the reference, instead of a fat smear when zoomed in.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const NS = { vectorEffect: 'non-scaling-stroke' };
const rot = (r, cx, cy) => (r ? `rotate(${r} ${cx} ${cy})` : undefined);

/** The pink SOLD rosette: a scalloped badge with a white ring and the word. */
function SoldBadge({ cx, cy, r }) {
  const points = [];
  const n = 18;
  for (let i = 0; i < n * 2; i += 1) {
    const rr = i % 2 === 0 ? r : r * 0.9;
    const a = (Math.PI * i) / n;
    points.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return (
    <g aria-hidden="true">
      <polygon points={points.join(' ')} fill={INK.pink} />
      <circle cx={cx} cy={cy} r={r * 0.76} fill="none" stroke="#ffffff" strokeWidth={r * 0.06} />
      <text x={cx} y={cy} fill="#ffffff" fontSize={r * 0.42} fontWeight="800" textAnchor="middle" dominantBaseline="central" letterSpacing="0.02em">SOLD</text>
    </g>
  );
}

/** Unavailable: a pink "no entry" circle with its slash. */
function BlockedMark({ cx, cy, r }) {
  const d = r * 0.7071;
  return (
    <g aria-hidden="true" stroke={INK.pink} strokeWidth={r * 0.13} fill="none" strokeLinecap="round">
      <circle cx={cx} cy={cy} r={r} />
      <line x1={cx - d} y1={cy - d} x2={cx + d} y2={cy + d} />
    </g>
  );
}

/**
 * A booth. `state` is its status from the server (available, held, sold,
 * blocked; `mine`; `vendor`). The badge shrinks with the booth so the long
 * thin corridor tables of the reference still carry one.
 */
export function Booth({ e, state, boothTypes, selected = false, interactive = false, onClick, highlight = false }) {
  const status = state?.status || (e.blocked ? 'blocked' : 'available');
  const taken = status === 'sold' || status === 'blocked';
  const fill = taken ? INK.boothTaken : typeColor(boothTypes, e.boothTypeId);
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const short = Math.min(e.w, e.h);
  const badge = Math.max(4, short * 0.36);
  const fontSize = Math.max(6, Math.min(short * 0.36, (e.w / Math.max(2, (e.code || '').length)) * 1.45));
  const label = status === 'sold' ? `${e.code || 'Booth'}, sold${state?.vendor ? ` to ${state.vendor.name}` : ''}`
    : status === 'blocked' ? `${e.code || 'Booth'}, unavailable`
      : status === 'held' ? `${e.code || 'Booth'}, reserved` : `${e.code || 'Booth'}, available`;

  return (
    <g
      transform={rot(e.r, cx, cy)}
      className={interactive ? 'es-fp-booth es-fp-booth--interactive' : 'es-fp-booth'}
      data-status={status}
      {...(interactive ? {
        role: 'button', tabIndex: 0, 'aria-label': label,
        onClick, onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick?.(ev); } },
      } : {})}
    >
      <rect x={e.x} y={e.y} width={e.w} height={e.h} fill={fill} stroke={INK.boothStroke} strokeWidth={1.4} style={NS} />
      {status === 'held' && (
        <rect x={e.x} y={e.y} width={e.w} height={e.h} fill="url(#es-fp-hatch)" stroke="none" />
      )}
      {status === 'sold' && <SoldBadge cx={cx} cy={cy} r={badge} />}
      {status === 'blocked' && <BlockedMark cx={cx} cy={cy} r={badge * 0.86} />}
      {(status === 'available' || status === 'held') && e.code && (
        <text x={cx} y={cy} fontSize={fontSize} fontWeight="600" textAnchor="middle" dominantBaseline="central"
          fill={textOn(fill)} style={{ pointerEvents: 'none' }}>{e.code}</text>
      )}
      {(selected || highlight || state?.mine) && (
        <rect x={e.x - 2} y={e.y - 2} width={e.w + 4} height={e.h + 4} fill="none"
          stroke={state?.mine || highlight ? INK.mine : INK.selected} strokeWidth={state?.mine || highlight ? 3 : 2}
          strokeDasharray={selected && !state?.mine && !highlight ? '5 3' : undefined} style={NS} />
      )}
    </g>
  );
}

export function Wall({ e }) {
  const d = e.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') + (e.closed ? ' Z' : '');
  return <path d={d} fill="none" stroke={INK.wall} strokeWidth={1.6} strokeLinejoin="round" style={NS} />;
}

/** A door: the leaf and its quarter-circle swing; `double` mirrors a second leaf. */
export function Door({ e }) {
  const s = e.size;
  const leaf = (dir) => (
    <g>
      <line x1={0} y1={0} x2={0} y2={-s} stroke={INK.wall} strokeWidth={1.6} style={NS} />
      <path d={`M0 ${-s} A${s} ${s} 0 0 ${dir > 0 ? 1 : 0} ${dir * s} 0`} fill="none" stroke={INK.wall} strokeWidth={1.2} style={NS} />
    </g>
  );
  return (
    <g transform={`translate(${e.x} ${e.y}) rotate(${e.r || 0})`}>
      {e.double ? (
        <>
          <g transform={`translate(${-s} 0)`}>{leaf(1)}</g>
          <g transform={`translate(${s} 0)`}>{leaf(-1)}</g>
        </>
      ) : leaf(1)}
    </g>
  );
}

/** A labelled block: the stage, the restaurant, a bar. */
export function Area({ e }) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const main = Math.max(8, Math.min(e.h * (e.sub ? 0.24 : 0.3), (e.w / Math.max(3, e.text.length)) * 1.5));
  return (
    <g transform={rot(e.r, cx, cy)}>
      <rect x={e.x} y={e.y} width={e.w} height={e.h} fill={e.fill} rx={Math.min(6, e.w * 0.04)} />
      {e.text && (
        <text x={cx} y={e.sub ? cy - main * 0.35 : cy} fill={e.textColor} fontSize={main} fontWeight="600"
          textAnchor="middle" dominantBaseline="central">{e.text}</text>
      )}
      {e.sub && (
        <text x={cx} y={cy + main * 0.75} fill={e.textColor} fontSize={main * 0.6} textAnchor="middle" dominantBaseline="central">{e.sub}</text>
      )}
    </g>
  );
}

export function Label({ e }) {
  return (
    <text x={e.x} y={e.y} fill={e.color} fontSize={e.size} fontWeight="500" textAnchor="middle" dominantBaseline="central"
      transform={rot(e.r, e.x, e.y)}>{e.text}</text>
  );
}

/** A thick traffic arrow with an open chevron head. */
export function Arrow({ e }) {
  const ang = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
  const len = Math.min(18, Math.hypot(e.x2 - e.x1, e.y2 - e.y1) * 0.45);
  const a1 = ang + Math.PI * 0.78;
  const a2 = ang - Math.PI * 0.78;
  return (
    <g stroke={e.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none">
      <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} style={NS} />
      <polyline points={`${e.x2 + len * Math.cos(a1)},${e.y2 + len * Math.sin(a1)} ${e.x2},${e.y2} ${e.x2 + len * Math.cos(a2)},${e.y2 + len * Math.sin(a2)}`} style={NS} />
    </g>
  );
}

/** A round table ringed with chairs. */
export function Table({ e }) {
  const chairs = [];
  const ring = e.size * 0.78;
  const cr = e.size * 0.2;
  for (let i = 0; i < e.seats; i += 1) {
    const a = (Math.PI * 2 * i) / e.seats - Math.PI / 2;
    chairs.push(<circle key={i} cx={e.x + ring * Math.cos(a)} cy={e.y + ring * Math.sin(a)} r={cr} fill="#ffffff" stroke={INK.furniture} strokeWidth={1.2} style={NS} />);
  }
  return (
    <g aria-hidden="true">
      {chairs}
      <circle cx={e.x} cy={e.y} r={e.size * 0.5} fill="#ffffff" stroke={INK.furniture} strokeWidth={1.4} style={NS} />
    </g>
  );
}

/**
 * An arc of theatre seats facing (x, y) — the stage. `r` is the direction the
 * audience sits in from the stage (0 = to the right), `spread` the arc's width.
 */
export function SeatArc({ e }) {
  const seats = [];
  const pitch = 15;
  const rowGap = 17;
  const base = (e.r * Math.PI) / 180;
  const half = (e.spread * Math.PI) / 360;
  for (let row = 0; row < e.rows; row += 1) {
    const rr = e.radius + row * rowGap;
    const n = Math.max(1, Math.floor((rr * half * 2) / pitch) + 1);
    for (let i = 0; i < n; i += 1) {
      const a = base - half + (n === 1 ? half : (2 * half * i) / (n - 1));
      const sx = e.x + rr * Math.cos(a);
      const sy = e.y + rr * Math.sin(a);
      const face = (a * 180) / Math.PI + 90;
      seats.push(
        <path key={`${row}-${i}`} d="M-5 -3 L-5 3 Q-5 5 -3 5 L3 5 Q5 5 5 3 L5 -3 M-5 -1 L5 -1"
          transform={`translate(${sx.toFixed(1)} ${sy.toFixed(1)}) rotate(${face.toFixed(1)})`}
          fill="#ffffff" stroke="#2b2b30" strokeWidth={1.1} style={NS} />,
      );
    }
  }
  return <g aria-hidden="true">{seats}</g>;
}

/** The hatch a reserved (offered) booth carries. Put once in the <svg>'s <defs>. */
export function FloorPlanDefs() {
  return (
    <defs>
      <pattern id="es-fp-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="rgb(255 255 255 / 0.25)" />
        <line x1="0" y1="0" x2="0" y2="8" stroke="rgb(17 16 24 / 0.35)" strokeWidth="3" />
      </pattern>
    </defs>
  );
}

/** Everything that is not a booth, in paint order: floor items first, walls and labels on top. */
const ORDER = { area: 0, table: 1, seats: 1, booth: 2, arrow: 3, wall: 4, door: 4, label: 5 };
export function paintOrder(elements) {
  return [...elements].sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9));
}

/** A non-booth element. */
export function Decor({ e }) {
  switch (e.kind) {
    case 'wall': return <Wall e={e} />;
    case 'door': return <Door e={e} />;
    case 'area': return <Area e={e} />;
    case 'label': return <Label e={e} />;
    case 'arrow': return <Arrow e={e} />;
    case 'table': return <Table e={e} />;
    case 'seats': return <SeatArc e={e} />;
    default: return null;
  }
}
