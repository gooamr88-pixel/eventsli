/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The shape catalogue and the coordinate system. ONE definition.
 *
 * This module is imported by the buyer's map, the organizer's editor and the
 * print export. It must never be copied, re-implemented "just for this view",
 * or forked to add a shape. `seatingGeometry.test.js` fails if the catalogue
 * drifts from the shapes the database will accept.
 *
 * That rule is not stylistic. In the codebase this pattern was taken from, the
 * same catalogue existed in three places and the copies diverged: a guest saw a
 * buffet table drawn as a round one, and the print path read a coordinate as a
 * centre where the editor had written a corner, so the whole map scattered.
 * Both bugs are invisible in the view you happen to be looking at.
 *
 *
 * THE COORDINATE SYSTEM
 *
 * `tables.position_x` and `position_y` are `NUMERIC(6,3)` and the base schema
 * calls them "% of the logical world". So a table's stored position is a
 * PERCENTAGE, 0–100, not a pixel.
 *
 * That is what makes a saved map survive anything. The organizer lays it out on
 * a 27-inch monitor; the buyer opens it on a 375px phone; the door staff print
 * it on A4. A pixel coordinate is correct in exactly one of those three. A
 * percentage is correct in all of them, and the same numbers still mean the
 * same thing after a redesign changes every dimension in this file.
 *
 * WORLD is the aspect ratio those percentages are resolved against — the SVG
 * viewBox, and the units every function below returns. Changing it rescales
 * every drawing consistently and changes nothing in the database.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The logical drawing surface. 10:7 — a room is wider than it is deep. */
export const WORLD = Object.freeze({ width: 1000, height: 700 });

/** One seat's drawn radius, in world units. */
export const SEAT_RADIUS = 9;

/**
 * Centre-to-centre spacing between adjacent seats.
 *
 * `2 × SEAT_RADIUS` would put them exactly touching, which reads as a solid bar
 * rather than as seats. The extra 6 is the gap that makes a row countable at a
 * glance, which is the entire job of a seat map.
 */
export const SEAT_PITCH = SEAT_RADIUS * 2 + 6;

/**
 * The shapes a table may be. `tables.shape` is TEXT with DEFAULT 'round', so
 * the database accepts anything — which makes this list the only real
 * constraint, and the reason it is exported rather than inlined.
 */
export const SHAPES = Object.freeze(['round', 'oval', 'rect', 'square', 'row']);

export const DEFAULT_SHAPE = 'round';

/** An unknown shape draws as a round table rather than as nothing. A map with
 *  one bad row should lose one table, not the whole room. */
export function normaliseShape(shape) {
  return SHAPES.includes(shape) ? shape : DEFAULT_SHAPE;
}

/**
 * The table's own body, centred on (0,0), in world units.
 *
 * Sized from the seat count, not fixed: a 2-top and a 12-top drawn the same
 * size is a map that lies about the room. Every shape returns the same
 * `{ kind, width, height, rx }` so a renderer never switches on the shape name
 * — adding a sixth shape must not mean editing every consumer.
 */
export function tableBody(shape, seatCount) {
  const n = clampSeats(seatCount);

  switch (normaliseShape(shape)) {
    case 'round': {
      // The circumference has to hold n seats at SEAT_PITCH, so the radius
      // follows from the seat count rather than being chosen and then
      // overflowing at 14 seats.
      const r = Math.max(26, (n * SEAT_PITCH) / (2 * Math.PI) - SEAT_RADIUS - 4);
      return { kind: 'ellipse', width: r * 2, height: r * 2, rx: r };
    }

    case 'oval': {
      const r = Math.max(26, (n * SEAT_PITCH) / (2 * Math.PI) - SEAT_RADIUS - 4);
      return { kind: 'ellipse', width: r * 2.6, height: r * 1.5, rx: r * 1.3 };
    }

    case 'square': {
      // Seats spread over four sides.
      const perSide = Math.ceil(n / 4);
      const side = Math.max(48, perSide * SEAT_PITCH + 12);
      return { kind: 'rect', width: side, height: side, rx: 6 };
    }

    case 'rect': {
      // The long sides take the seats; the ends take one each when the count
      // is not divisible by two, which is how a real banquet table works.
      const perSide = Math.ceil(n / 2);
      return {
        kind: 'rect',
        width: Math.max(70, perSide * SEAT_PITCH + 12),
        height: 52,
        rx: 6,
      };
    }

    case 'row':
    default:
      // A row has no table body — the seats ARE the object. Returning a zero
      // box rather than null keeps every consumer on one code path.
      return { kind: 'none', width: n * SEAT_PITCH, height: SEAT_RADIUS * 2, rx: 0 };
  }
}

/**
 * Where each seat sits, relative to the table's centre, before rotation.
 *
 * Returns `{ x, y, angle }` per seat, in world units, in seat-number order —
 * so index 0 is seat "1". `angle` is the outward-facing direction in degrees,
 * which a renderer needs to orient a seat-back or a label and which is
 * genuinely awkward to recover afterwards.
 *
 * Seat 1 starts at the TOP and they run clockwise, matching how people number
 * a table when they walk up to it.
 */
export function seatPositions(shape, seatCount) {
  const n = clampSeats(seatCount);
  const body = tableBody(shape, n);
  const kind = normaliseShape(shape);

  if (kind === 'round' || kind === 'oval') {
    const rx = body.width / 2 + SEAT_RADIUS + 4;
    const ry = body.height / 2 + SEAT_RADIUS + 4;
    return Array.from({ length: n }, (_, i) => {
      // −90° so seat 1 is at the top rather than at 3 o'clock.
      const theta = (i / n) * 2 * Math.PI - Math.PI / 2;
      return {
        x: round3(Math.cos(theta) * rx),
        y: round3(Math.sin(theta) * ry),
        angle: round3((theta * 180) / Math.PI + 90),
      };
    });
  }

  if (kind === 'row') {
    // Centred on the table's own point, so a row's stored position means its
    // middle — the same as every other shape. Anything else makes a row drift
    // sideways when a seat is added, which in an editor feels like a bug.
    const span = (n - 1) * SEAT_PITCH;
    return Array.from({ length: n }, (_, i) => ({
      x: round3(i * SEAT_PITCH - span / 2),
      y: 0,
      angle: 0,
    }));
  }

  return rectangularSeats(kind, n, body);
}

/**
 * Seats around a rectangle or a square.
 *
 * A rect fills its two long sides first, because that is how a banquet table is
 * actually laid; a square distributes over all four. Both walk the perimeter
 * clockwise from the top-left so numbering is continuous, which matters at the
 * door — staff read "table 4, seat 7" off a printed map and have to find it.
 */
function rectangularSeats(kind, n, body) {
  const halfW = body.width / 2;
  const halfH = body.height / 2;
  const out = [];

  // How many seats each side gets, clockwise from the top.
  let counts;
  if (kind === 'square') {
    const base = Math.floor(n / 4);
    counts = [base, base, base, base];
    for (let i = 0; i < n % 4; i += 1) counts[i] += 1;
  } else {
    const top = Math.ceil(n / 2);
    const bottom = n - top;
    counts = [top, 0, bottom, 0];
    // With an odd seat left over on a small table, put it on an end rather than
    // crowding a long side.
    if (n >= 6 && n % 2 === 1) { counts[0] -= 1; counts[1] = 1; }
  }

  const spread = (count, length) =>
    Array.from({ length: count }, (_, i) => (count === 1 ? 0 : -length / 2 + (i * length) / (count - 1)));

  const gap = SEAT_RADIUS + 5;
  const usableW = body.width - SEAT_PITCH;
  const usableH = body.height - SEAT_PITCH;

  spread(counts[0], usableW).forEach((x) => out.push({ x: round3(x), y: round3(-halfH - gap), angle: 0 }));
  spread(counts[1], usableH).forEach((y) => out.push({ x: round3(halfW + gap), y: round3(y), angle: 90 }));
  spread(counts[2], usableW).reverse().forEach((x) => out.push({ x: round3(x), y: round3(halfH + gap), angle: 180 }));
  spread(counts[3], usableH).reverse().forEach((y) => out.push({ x: round3(-halfW - gap), y: round3(y), angle: 270 }));

  return out.slice(0, n);
}

/**
 * A stored percentage → world units.
 *
 * The one place the percentage contract is applied. Every renderer calls this
 * rather than multiplying by WORLD itself, so the day the world changes shape
 * there is a single line to edit instead of four files that each looked right.
 */
export function toWorld(position) {
  return {
    x: (Number(position?.x) || 0) / 100 * WORLD.width,
    y: (Number(position?.y) || 0) / 100 * WORLD.height,
    rotation: Number(position?.rotation) || 0,
  };
}

/** World units → a stored percentage. The exact inverse of toWorld, and the
 *  editor's only way to write a position. */
export function toPercent(x, y) {
  return {
    x: round3(clamp((x / WORLD.width) * 100, 0, 100)),
    y: round3(clamp((y / WORLD.height) * 100, 0, 100)),
  };
}

/**
 * The bounding box of everything drawn, in world units.
 *
 * Used to frame the map on open. Without it a room whose tables all sit in one
 * corner — which is most rooms mid-layout — opens showing mostly empty floor,
 * and the buyer's first action is to pan looking for the seats.
 */
export function contentBounds(tables) {
  if (!tables || tables.length === 0) {
    return { x: 0, y: 0, width: WORLD.width, height: WORLD.height };
  }

  let minX = Infinity; let minY = Infinity;
  let maxX = -Infinity; let maxY = -Infinity;

  for (const t of tables) {
    const { x, y } = toWorld(t.position);
    const body = tableBody(t.shape, t.seatCount);
    // The seats sit outside the body, so the extent is the body plus a seat
    // and its pitch — measured, not guessed, or labels clip on the edges.
    const reach = Math.max(body.width, body.height) / 2 + SEAT_PITCH + SEAT_RADIUS;
    minX = Math.min(minX, x - reach);
    minY = Math.min(minY, y - reach);
    maxX = Math.max(maxX, x + reach);
    maxY = Math.max(maxY, y + reach);
  }

  const pad = 30;
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(120, maxX - minX + pad * 2),
    height: Math.max(120, maxY - minY + pad * 2),
  };
}

/**
 * Keeps a pan/zoom viewport over the content.
 *
 * The rule: you may zoom out until the whole world fits, and you may not pan so
 * far that the content leaves the screen entirely. Without this an organizer
 * drags once on a trackpad, the map is gone, and there is no visible way back —
 * the canvas is empty in every direction and nothing says which way to go.
 *
 * Deliberately permissive at the edges: half a viewport of overscroll is
 * allowed, so a table near the boundary can still be centred to work on.
 */
export function clampView(view, bounds) {
  const width = clamp(view.width, bounds.width / 24, bounds.width * 1.6);
  const height = width * (view.height / view.width || 1);

  const slackX = width / 2;
  const slackY = height / 2;

  return {
    x: clamp(view.x, bounds.x - slackX, bounds.x + bounds.width + slackX - width),
    y: clamp(view.y, bounds.y - slackY, bounds.y + bounds.height + slackY - height),
    width,
    height,
  };
}

function clamp(v, lo, hi) {
  // A lo above hi happens when the content is smaller than the minimum zoom —
  // a one-table map. Centring is the only sensible answer; Math.min/max alone
  // would snap it to an edge.
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, v));
}

/** Matches the database: `seat_count INT CHECK (seat_count BETWEEN 1 AND 60)`. */
function clampSeats(n) {
  const v = Math.round(Number(n) || 0);
  return Math.min(60, Math.max(1, v));
}

/** Three decimals, matching NUMERIC(6,3) — so a value written by the editor
 *  reads back byte-identical instead of drifting on every save. */
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
