/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The styled table shapes (2026-11-18, the owner's floor-plan reference):
 * D-shape booths, rounded-end and pill tables, hexagons, U-shapes, half-moons
 * and high-tops — and the organizer's choice of how many seats go on each side.
 *
 * `seatingGeometry.js` is still the one catalogue (`SHAPES`) and the one entry
 * point (`tableBody`, `seatPositions`); it hands the shapes it does not draw
 * itself to this file. Nothing here is imported by a renderer directly.
 *
 * The constants arrive as an argument rather than an import, because this
 * module is imported BY seatingGeometry and an import back would be a cycle.
 *
 *
 * SIDES
 *
 * Every sided shape has the same four sides, clockwise from the top: top,
 * right, bottom, left — so `style.sides` is one shape of object everywhere and
 * seat 1 is always the first seat of the top side, left to right, like a rect
 * table has always been numbered. What a side IS differs by shape: the right
 * side of a D-shape or a rounded-end table is its curve, both ends of a pill
 * are curves, a hexagon's left and right are its points.
 *
 * Seats per side are layout only. The database still holds a seat count and
 * generates seats 1…n; which side seat 4 sits on is decided here, identically
 * for the editor, the buyer, the printed pack and the 3D view.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const SIDE_NAMES = Object.freeze(['top', 'right', 'bottom', 'left']);

/** Which sides each shape can seat, as indexes into SIDE_NAMES. A shape absent
 *  here seats all the way round (or along its arc) and has no per-side choice. */
export const SHAPE_SIDES = Object.freeze({
  rect: [0, 1, 2, 3],
  square: [0, 1, 2, 3],
  pill: [0, 1, 2, 3],
  rounded_end: [0, 1, 2, 3],
  d_shape: [0, 1, 2, 3],
  hexagon: [0, 1, 2, 3],
  u_shape: [0, 1, 3],
});

/** The organizer's words for a side, per shape — "Curved side" means more on a
 *  D-shape booth than "Right". */
export function sideLabel(shape, index) {
  if (shape === 'd_shape' && index === 1) return 'Curved side';
  if (shape === 'rounded_end' && index === 1) return 'Rounded end';
  if (shape === 'pill' && index === 1) return 'Right end';
  if (shape === 'pill' && index === 3) return 'Left end';
  if (shape === 'hexagon' && index === 1) return 'Right point';
  if (shape === 'hexagon' && index === 3) return 'Left point';
  return ['Top', 'Right', 'Bottom', 'Left'][index];
}

/**
 * The organizer's own counts when they are usable, else null.
 *
 * Usable means: this shape has per-side seating, every count is a whole number
 * on a side the shape has, and they add up to the table's seat count. The last
 * rule is what keeps the database and the drawing in step — a table whose seat
 * count was changed somewhere that does not know about sides falls back to the
 * default spread rather than drawing a different number of seats than it sells.
 */
export function customSides(shape, n, style) {
  const allowed = SHAPE_SIDES[shape];
  const raw = style && typeof style === 'object' ? style.sides : null;
  if (!allowed || !raw || typeof raw !== 'object') return null;
  const counts = SIDE_NAMES.map((name, i) => {
    const v = Number(raw[name]) || 0;
    return allowed.includes(i) ? Math.max(0, Math.round(v)) : 0;
  });
  return counts.reduce((a, b) => a + b, 0) === n ? counts : null;
}

/** The default spread over the four sides when the organizer has not set one. */
export function defaultSides(shape, n) {
  switch (shape) {
    case 'square': {
      const base = Math.floor(n / 4);
      const c = [base, base, base, base];
      for (let i = 0; i < n % 4; i += 1) c[i] += 1;
      return c;
    }
    case 'd_shape':
      // A booth: the flat back takes most, the curve the rest.
      return [0, Math.floor(n / 2), 0, Math.ceil(n / 2)];
    case 'u_shape': {
      const leg = Math.floor(n / 3);
      return [n - leg * 2, leg, 0, leg];
    }
    case 'hexagon':
      if (n >= 6) return [Math.ceil((n - 2) / 2), 1, Math.floor((n - 2) / 2), 1];
      return [Math.ceil(n / 2), 0, Math.floor(n / 2), 0];
    case 'rounded_end':
      if (n >= 5 && n % 2 === 1) return [(n - 1) / 2, 1, (n - 1) / 2, 0];
      return [Math.ceil(n / 2), 0, Math.floor(n / 2), 0];
    case 'pill':
      if (n >= 6 && n % 2 === 0) return [(n - 2) / 2, 1, (n - 2) / 2, 1];
      if (n >= 5) return [Math.floor((n - 1) / 2), 1, Math.ceil((n - 1) / 2), 0];
      return [Math.ceil(n / 2), 0, Math.floor(n / 2), 0];
    case 'rect':
    default: {
      const top = Math.ceil(n / 2);
      const c = [top, 0, n - top, 0];
      if (n >= 6 && n % 2 === 1) { c[0] -= 1; c[1] = 1; }
      return c;
    }
  }
}

/* ── the new shapes ─────────────────────────────────────────────────────── */

/** The shapes this file draws (rect and square stay in seatingGeometry). */
export const STYLED_SHAPES = Object.freeze(['d_shape', 'rounded_end', 'pill', 'hexagon', 'u_shape', 'half_moon', 'high_top']);

/**
 * The radius an end curve needs to hold `k` seats at a full pitch apart within
 * ±60° of its middle — past that a curve seat crowds the last seat of the side.
 */
function arcRadius(k, min, { R, P }) {
  const gap = R + 5;
  const needed = k > 1 ? ((k - 1) * P) / (2 * (Math.PI / 3)) - gap : 0;
  return Math.max(min, needed);
}

/** Even spacing of `count` centres over `length`, centred on 0. */
function spread(count, length) {
  return Array.from({ length: count }, (_, i) => (count === 1 ? 0 : -length / 2 + (i * length) / (count - 1)));
}

/** Seats along a curve: centre (cx, 0), radius r, `k` seats a pitch apart,
 *  centred on angle `mid` (0 = pointing right). Top to bottom on the right. */
function arcSeats(k, cx, r, mid, { R, P }) {
  const radius = r + R + 5;
  const step = P / radius;
  return Array.from({ length: k }, (_, i) => {
    const a = mid + (i - (k - 1) / 2) * step * (mid === 0 ? 1 : -1);
    return { x: cx + Math.cos(a) * radius, y: Math.sin(a) * radius, angle: (a * 180) / Math.PI + 90 };
  });
}

/**
 * The body of a styled shape, centred on (0,0): `{ kind: 'path', d, width,
 * height, rx: 0, labelY }`, or an ellipse for the high-top.
 */
export function styledBody(shape, n, counts, k) {
  const { R, P } = k;
  const run = (c) => c * P + 12;
  const [t, r, b, l] = counts;
  const long = Math.max(t, b);

  switch (shape) {
    case 'high_top': {
      const rad = Math.max(16, (n * P) / (2 * Math.PI) - R - 4);
      return { kind: 'ellipse', width: rad * 2, height: rad * 2, rx: rad, labelY: 0 };
    }
    case 'half_moon': {
      // Seats along the arc only, ±80° of straight up.
      const rad = Math.max(32, n > 1 ? ((n - 1) * P) / (Math.PI * (160 / 180)) - R - 5 : 0);
      const d = `M${-rad} ${rad / 2}A${rad} ${rad} 0 0 1 ${rad} ${rad / 2}Z`;
      return { kind: 'path', d, width: rad * 2, height: rad, rx: 0, labelY: rad * 0.12 };
    }
    case 'pill':
    case 'rounded_end': {
      const ends = shape === 'pill' ? Math.max(r, l) : r;
      const rad = arcRadius(ends, 22, k);
      const h = Math.max(rad * 2, run(0));
      const straight = Math.max(long > 0 ? (long - 1) * P + 4 : 0, shape === 'pill' ? 24 : 36);
      if (shape === 'pill') {
        const w = straight + rad * 2;
        const d = `M${-straight / 2} ${-rad}H${straight / 2}A${rad} ${rad} 0 0 1 ${straight / 2} ${rad}H${-straight / 2}A${rad} ${rad} 0 0 1 ${-straight / 2} ${-rad}Z`;
        return { kind: 'path', d, width: w, height: h, rx: 0, labelY: 0, straight, rad };
      }
      const flatH = Math.max(h, run(l));
      const radius = flatH / 2;
      const w = straight + 14 + radius;
      const x0 = -w / 2;
      const xc = w / 2 - radius;
      const d = `M${x0} ${-radius}H${xc}A${radius} ${radius} 0 0 1 ${xc} ${radius}H${x0}Z`;
      return { kind: 'path', d, width: w, height: flatH, rx: 0, labelY: 0, straight, rad: radius, xc };
    }
    case 'd_shape': {
      const h = Math.max(48, run(l), arcRadius(r, 24, k) * 2);
      const radius = h / 2;
      const flat = Math.max(12, long > 0 ? (long - 1) * P + 8 : 12);
      const w = flat + radius;
      const x0 = -w / 2;
      const xc = x0 + flat;
      const d = `M${x0} ${-radius}H${xc}A${radius} ${radius} 0 0 1 ${xc} ${radius}H${x0}Z`;
      return { kind: 'path', d, width: w, height: h, rx: 0, labelY: 0, rad: radius, xc, flat };
    }
    case 'hexagon': {
      const h = Math.max(52, run(Math.max(r, l)) + 8);
      const q = h * 0.3;
      const w = Math.max(76, run(long) + q * 2);
      const d = `M${-w / 2 + q} ${-h / 2}H${w / 2 - q}L${w / 2} 0L${w / 2 - q} ${h / 2}H${-w / 2 + q}L${-w / 2} 0Z`;
      return { kind: 'path', d, width: w, height: h, rx: 0, labelY: 0, q };
    }
    case 'u_shape':
    default: {
      const leg = 22;
      const w = Math.max(84, run(t));
      const h = Math.max(64, run(Math.max(r, l)));
      const d = `M${-w / 2} ${-h / 2}H${w / 2}V${h / 2}H${w / 2 - leg}V${-h / 2 + leg}H${-w / 2 + leg}V${h / 2}H${-w / 2}Z`;
      return { kind: 'path', d, width: w, height: h, rx: 0, labelY: -h / 2 + leg / 2 + 1, leg };
    }
  }
}

/**
 * Where the seats of a styled shape sit, in seat-number order: the top side
 * left to right, the right side top to bottom, the bottom right to left, the
 * left bottom to top — clockwise, as every rect table has always been numbered.
 */
export function styledSeats(shape, n, counts, body, k) {
  const { R, P } = k;
  const gap = R + 5;
  const [t, r, b, l] = counts;
  const hw = body.width / 2;
  const hh = body.height / 2;
  const out = [];
  const push = (x, y, angle) => out.push({ x, y, angle });

  if (shape === 'high_top') {
    const rx = hw + gap - 1;
    for (let i = 0; i < n; i += 1) {
      const th = (i / n) * 2 * Math.PI - Math.PI / 2;
      push(Math.cos(th) * rx, Math.sin(th) * rx, (th * 180) / Math.PI + 90);
    }
    return out;
  }
  if (shape === 'half_moon') {
    const radius = hw + gap;
    const step = n > 1 ? Math.min(P / radius, (Math.PI * (160 / 180)) / (n - 1)) : 0;
    for (let i = 0; i < n; i += 1) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * step;
      push(Math.cos(a) * radius, hh + Math.sin(a) * radius, (a * 180) / Math.PI + 90);
    }
    return out;
  }

  // The straight run of the top and bottom sides, as [from, to] in x.
  let x0 = -hw; let x1 = hw;
  if (shape === 'pill') { x0 = -body.straight / 2; x1 = body.straight / 2; }
  if (shape === 'rounded_end' || shape === 'd_shape') { x1 = body.xc; }
  if (shape === 'hexagon') { x0 = -hw + body.q; x1 = hw - body.q; }
  const along = (c) => {
    const len = Math.max(0, (x1 - x0) - (shape === 'u_shape' ? P : shape === 'hexagon' ? 12 : 0));
    const mid = (x0 + x1) / 2;
    return spread(c, Math.min(len, Math.max(0, (c - 1) * P * 1.25))).map((v) => mid + v);
  };

  along(t).forEach((x) => push(x, -hh - gap, 0));

  // Right side.
  if (shape === 'pill') arcSeats(r, body.straight / 2, body.rad, 0, k).forEach((s) => out.push(s));
  else if (shape === 'rounded_end' || shape === 'd_shape') arcSeats(r, body.xc, body.rad, 0, k).forEach((s) => out.push(s));
  else if (shape === 'hexagon') {
    spread(r, (r - 1) * P).forEach((y) => push(hw - body.q * (Math.abs(y) / hh) + gap, y, 90));
  } else spread(r, Math.min(body.height - P, (r - 1) * P * 1.25)).forEach((y) => push(hw + gap, y, 90));

  along(b).reverse().forEach((x) => push(x, hh + gap, 180));

  // Left side, bottom to top.
  if (shape === 'pill') arcSeats(l, -body.straight / 2, body.rad, Math.PI, k).forEach((s) => out.push(s));
  else if (shape === 'hexagon') {
    spread(l, (l - 1) * P).reverse().forEach((y) => push(-hw + body.q * (Math.abs(y) / hh) - gap, y, 270));
  } else spread(l, Math.min(body.height - P, (l - 1) * P * 1.25)).reverse().forEach((y) => push(-hw - gap, y, 270));

  return out.slice(0, n);
}
