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
 * THE WORLD IS PER MAP (2026-11-09). The percentages are resolved against the
 * map's own world — `layout.world`, read by `worldOf` — which is the SVG
 * viewBox and the units every function below returns. Seats keep their size in
 * world units, so a bigger world is a bigger ROOM, not bigger seats: 1000 × 700
 * holds a ballroom (about 23 m × 16 m), 8000 × 6000 a stadium bowl. A map with
 * no `layout.world` — and every map the editor saved with the old fixed
 * 1000 × 700 — resolves to `WORLD` and draws exactly as it always did.
 *
 * So every function that turns a percentage into units takes the world as its
 * last argument, defaulting to `WORLD`, and nothing else in `src` imports
 * `WORLD` (seatingGeometry.test.js enforces it). A renderer that resolved
 * against the default would squeeze a stadium into a ballroom, and only on the
 * maps that are not the default — the kind of bug this file exists to prevent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The default world, and the size of every map that does not set its own.
 *  10:7 — a room is wider than it is deep. */
export const WORLD = Object.freeze({ width: 1000, height: 700 });

/**
 * The largest world a map may have: about 229 m × 229 m at 0.55 m a seat — a
 * stadium bowl with its concourse. `NUMERIC(6,3)` stores 0.001 %, so a
 * position still lands to a tenth of a unit. The API clamps to the same
 * numbers (`backend/services/venueStudio.js`); a test holds the two equal.
 */
export const MAX_WORLD = Object.freeze({ width: 10000, height: 10000 });

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

/** Real size: one seat pitch is 0.55 m. That turns a world into a venue in
 *  metres — the 3D model's scale and the venue size the organizer types. */
export const METRES_PER_UNIT = 0.55 / SEAT_PITCH;

/* ── the world ──────────────────────────────────────────────────────────── */

const worlds = new Map([[`${WORLD.width}x${WORLD.height}`, WORLD]]);

/**
 * A world of this size, normalised: whole units, clamped between `WORLD` and
 * `MAX_WORLD`, and the SAME frozen object for the same size — so a world can
 * sit in a React dependency list without re-framing the map on every render.
 * Anything unreadable is the default world.
 */
export function makeWorld(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return WORLD;
  const nw = Math.round(clamp(w, WORLD.width, MAX_WORLD.width));
  const nh = Math.round(clamp(h, WORLD.height, MAX_WORLD.height));
  const key = `${nw}x${nh}`;
  if (!worlds.has(key)) worlds.set(key, Object.freeze({ width: nw, height: nh }));
  return worlds.get(key);
}

/**
 * The world a saved layout is drawn in. The one place `layout.world` is read.
 *
 * Defensive like `readZones`: a missing, partial or unreadable world is the
 * default one, the size every map had before worlds were per map, so an old
 * map, or a blob written oddly, still draws as it always did.
 */
export function worldOf(layout) {
  const raw = layout && typeof layout === 'object' ? layout.world : null;
  if (!raw || typeof raw !== 'object') return WORLD;
  return makeWorld(raw.width, raw.height);
}

/** A world's size in metres, to a tenth — what the organizer reads. */
export function worldMetres(world = WORLD) {
  const m = (u) => Math.round(u * METRES_PER_UNIT * 10) / 10;
  return { width: m(world.width), depth: m(world.height) };
}

/** Metres → a world: the inverse of `worldMetres`, through `makeWorld`. */
export function worldFromMetres(width, depth) {
  return makeWorld(Number(width) / METRES_PER_UNIT, Number(depth) / METRES_PER_UNIT);
}

/**
 * How much a screen-constant mark (a border, a handle, a label) is divided by
 * at this viewport. Measured against the DEFAULT world's width, not the map's,
 * so a handle is the same size on screen in a ballroom and in a stadium: what
 * it answers is "how many units is a pixel", which does not depend on the room.
 */
export function screenScale(view) {
  return WORLD.width / Math.max(Number(view?.width) || 0, 1);
}

/** How many default rooms wide this world is: 1 for every map that predates
 *  per-map worlds. Map-wide labels (section names) grow by it, so they can
 *  still be read when a stadium is fitted to a phone. */
export function worldScale(world = WORLD) {
  return Math.max(1, world.width / WORLD.width);
}

/**
 * A distance in world units, as a step in percentages of this world. The
 * editor's nudges, copy offsets and snapping are defined in units so that they
 * are the same physical distance in every room.
 */
export function unitsToPercent(dx, dy, world = WORLD) {
  return { x: (dx / world.width) * 100, y: (dy / world.height) * 100 };
}

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
 * A stored percentage → units of this map's world.
 *
 * The one place the percentage contract is applied. Every renderer calls this
 * rather than multiplying by a world itself, so the rule lives in a single
 * line instead of in four files that each looked right.
 */
export function toWorld(position, world = WORLD) {
  return {
    x: (Number(position?.x) || 0) / 100 * world.width,
    y: (Number(position?.y) || 0) / 100 * world.height,
    rotation: Number(position?.rotation) || 0,
  };
}

/** World units → a stored percentage. The exact inverse of toWorld, and the
 *  editor's only way to write a position. */
export function toPercent(x, y, world = WORLD) {
  return {
    x: round3(clamp((x / world.width) * 100, 0, 100)),
    y: round3(clamp((y / world.height) * 100, 0, 100)),
  };
}

/**
 * Tables and zones moved into a world of another size, KEEPING THEIR SIZE AND
 * SPACING in units — which is what "make the venue bigger" means. Positions are
 * percentages, so a bare resize would spread every row apart (a bigger world)
 * or crush them together (a smaller one).
 *
 * The old room is centred in the new one, then shifted only as far as it takes
 * to keep everything inside. Returns null when the content cannot fit the new
 * world at all: the caller refuses the resize rather than clipping seats.
 */
export function moveToWorld({ tables = [], zones = [] }, from, to) {
  const box = extent(tables, zones, from);
  let dx = (to.width - from.width) / 2;
  let dy = (to.height - from.height) / 2;
  if (box) {
    if (box.maxX - box.minX > to.width || box.maxY - box.minY > to.height) return null;
    dx = clamp(dx, -box.minX, to.width - box.maxX);
    dy = clamp(dy, -box.minY, to.height - box.maxY);
  }
  const move = (px, py) => {
    const p = toWorld({ x: px, y: py }, from);
    return toPercent(p.x + dx, p.y + dy, to);
  };
  return {
    tables: tables.map((t) => ({ ...t, position: { ...t.position, ...move(t.position?.x, t.position?.y) } })),
    zones: zones.map((z) => ({ ...z, ...move(z.x, z.y) })),
  };
}

/**
 * The bounding box of everything drawn, in world units.
 *
 * Used to frame the map on open. Without it a room whose tables all sit in one
 * corner — which is most rooms mid-layout — opens showing mostly empty floor,
 * and the buyer's first action is to pan looking for the seats.
 *
 * ZONES COUNT AS CONTENT. They are furniture, not stock, but they are drawn,
 * and an opening frame that excludes them cuts the stage off the top of the
 * buyer's map — on a map whose whole purpose is showing which seats face it.
 * Optional, because the two callers that predate zones pass tables alone and a
 * required second argument would have framed their maps to `undefined`.
 */
export function contentBounds(tables, zones, world = WORLD) {
  const box = extent(tables, zones, world);
  if (!box) return { x: 0, y: 0, width: world.width, height: world.height };

  const pad = 30;
  return {
    x: box.minX - pad,
    y: box.minY - pad,
    width: Math.max(120, box.maxX - box.minX + pad * 2),
    height: Math.max(120, box.maxY - box.minY + pad * 2),
  };
}

/** The tight box around everything drawn, in units of `world`, or null for an
 *  empty map. Shared by the opening frame and by `moveToWorld`. */
function extent(tables, zones, world) {
  const hasTables = Array.isArray(tables) && tables.length > 0;
  const hasZones = Array.isArray(zones) && zones.length > 0;
  if (!hasTables && !hasZones) return null;

  let minX = Infinity; let minY = Infinity;
  let maxX = -Infinity; let maxY = -Infinity;

  for (const t of (hasTables ? tables : [])) {
    const { x, y } = toWorld(t.position, world);
    const body = tableBody(t.shape, t.seatCount);
    // The seats sit outside the body, so the extent is the body plus a seat
    // and its pitch — measured, not guessed, or labels clip on the edges.
    const reach = Math.max(body.width, body.height) / 2 + SEAT_PITCH + SEAT_RADIUS;
    minX = Math.min(minX, x - reach);
    minY = Math.min(minY, y - reach);
    maxX = Math.max(maxX, x + reach);
    maxY = Math.max(maxY, y + reach);
  }

  for (const z of (hasZones ? zones : [])) {
    // A rotated zone's corners swing outside its own box. Using the diagonal
    // as the reach is generous rather than exact — the alternative is four
    // trig calls per zone per frame to save a few units of padding.
    const w = Math.max(0, Number(z.w) || 0);
    const h = Math.max(0, Number(z.h) || 0);
    const cx = (Number(z.x) || 0) / 100 * world.width;
    const cy = (Number(z.y) || 0) / 100 * world.height;
    const reach = (Number(z.rotation) ? Math.hypot(w, h) : Math.max(w, h)) / 2;
    minX = Math.min(minX, cx - reach);
    minY = Math.min(minY, cy - reach);
    maxX = Math.max(maxX, cx + reach);
    maxY = Math.max(maxY, cy + reach);
  }

  return { minX, minY, maxX, maxY };
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
  // The deepest zoom is a 24th of the content, or ten seats across when that
  // is closer: a 24th of a stadium bowl is still too far out to tap a seat on a
  // phone. Every room up to the default world's size zooms exactly as before.
  const width = clamp(view.width, Math.min(bounds.width / 24, SEAT_PITCH * 10), bounds.width * 1.6);
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
