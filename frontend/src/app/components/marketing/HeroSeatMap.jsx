import {
  SEAT_RADIUS, tableBody, seatPositions, normaliseShape,
} from '../seating/seatingGeometry';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The homepage hero's picture: a seat map.
 *
 * WHY THIS EXISTS AT ALL. The homepage was ninety-four lines of text with no
 * image on it, and the product's one distinguishing feature — you pick the
 * actual seat, on the actual map — was a sentence rather than something you
 * could look at.
 *
 * WHY IT IS NOT A SCREENSHOT. The obvious fix is to photograph the real seat
 * picker and put the PNG here, which is what the codebase this design language
 * comes from does for its dashboard bands. A screenshot has to be re-taken
 * every time the thing it photographs changes, and the day it isn't, the
 * homepage is advertising a version of the product that no longer exists.
 *
 * So this imports `seatingGeometry.js` — the same module the real map draws
 * from, and the one with the contract test over it. The tables below are drawn
 * by the code that draws the tables a buyer clicks. Change the geometry and
 * this picture changes with it, correctly, with no second thing to remember.
 *
 * WHY IT IS NOT `<SeatMapCanvas>`. That component is `'use client'` and owns
 * pan, zoom and drag state — a real control, and the wrong thing to put in a
 * hero. A person landing on the homepage should not be able to drag the
 * illustration out of frame, and the homepage should not ship a pan-zoom
 * reducer to do it. This is a plain server component: it renders to SVG in the
 * HTML and ships no JavaScript whatsoever.
 *
 * ACCESSIBILITY. `aria-hidden`, deliberately. The hero heading and paragraph
 * beside it already say what this shows; announcing "seat map illustration"
 * after them is a second telling of the same thing, which is noise rather than
 * information. It carries no fact that is not in the text.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The room.
 *
 * Five tables and a stage — enough to read as a venue rather than as a
 * diagram, and few enough that every seat is still individually visible at the
 * size this renders on a phone.
 *
 * `sold` and `pick` are seat NUMBERS (1-based, matching what a ticket says),
 * not indices. A map where nothing is taken is a map of an event nobody is
 * going to, and it hides the one thing this picture has to prove: that the
 * seats have states and you can see them before you pay.
 */
const ROOM = [
  { shape: 'round', seats: 10, x: 148, y: 138, sold: [3, 4], pick: [] },
  { shape: 'round', seats: 8,  x: 332, y: 138, sold: [6],    pick: [] },
  { shape: 'oval',  seats: 10, x: 140, y: 272, sold: [8, 9], pick: [] },
  { shape: 'rect',  seats: 8,  x: 336, y: 272, sold: [],     pick: [] },
  // The near table is the one the eye lands on, so it carries the selection —
  // two seats together, which is what people actually buy.
  { shape: 'round', seats: 6,  x: 240, y: 392, sold: [5],    pick: [1, 2] },
];

/** The stage. A room reads as a room because something in it is not a table. */
const STAGE = { x: 96, y: 26, width: 288, height: 26 };

const VIEW = { width: 480, height: 456 };

export default function HeroSeatMap({ className = '' }) {
  return (
    <svg
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      className={`block h-auto w-full ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* The floor. `--es-bg-sunken` rather than a flat grey so the plate
          re-tones itself in dark mode along with everything else. */}
      <rect
        x="0" y="0" width={VIEW.width} height={VIEW.height}
        fill="var(--es-bg-sunken)"
      />

      <rect
        x={STAGE.x} y={STAGE.y} width={STAGE.width} height={STAGE.height}
        rx="4"
        fill="var(--es-surface)"
        stroke="var(--es-border-strong)"
        strokeWidth="1"
      />
      <text
        x={STAGE.x + STAGE.width / 2}
        y={STAGE.y + STAGE.height / 2 + 4}
        textAnchor="middle"
        fill="var(--es-text-subtle)"
        fontFamily="var(--es-font-mono)"
        fontSize="10"
        letterSpacing="2"
      >
        STAGE
      </text>

      {ROOM.map((table, i) => (
        <Table key={`${table.shape}-${i}`} {...table} />
      ))}
    </svg>
  );
}

/**
 * One table and its seats, translated into place.
 *
 * Everything positional comes out of `seatPositions` / `tableBody`. Nothing
 * here decides where a seat goes — which is the whole reason this file is
 * worth having rather than a hand-drawn SVG that looks approximately right.
 */
function Table({ shape, seats, x, y, sold = [], pick = [] }) {
  const body = tableBody(shape, seats);
  const positions = seatPositions(shape, seats);
  const soldSet = new Set(sold);
  const pickSet = new Set(pick);

  return (
    <g transform={`translate(${x} ${y})`}>
      {/* `kind`, not the shape name: `tableBody` returns one of three drawing
          kinds for five shapes, so a sixth shape needs no edit here. */}
      {body.kind === 'ellipse' && (
        <ellipse
          cx="0" cy="0" rx={body.width / 2} ry={body.height / 2}
          fill="var(--es-surface)"
          stroke="var(--es-border)"
          strokeWidth="1"
        />
      )}
      {body.kind === 'rect' && (
        <rect
          x={-body.width / 2} y={-body.height / 2}
          width={body.width} height={body.height}
          rx={body.rx}
          fill="var(--es-surface)"
          stroke="var(--es-border)"
          strokeWidth="1"
        />
      )}

      {positions.map((seat, i) => {
        const number = i + 1;
        const state = pickSet.has(number) ? 'selected'
          : soldSet.has(number) ? 'sold'
            : 'available';

        return (
          <circle
            key={number}
            cx={seat.x}
            cy={seat.y}
            r={SEAT_RADIUS}
            fill={`var(--es-seat-${state})`}
            /* A ring on the selected seats only. A selected seat has to be
               findable at a glance on a map of eighty of them, and a colour
               change alone does not survive being looked at on a phone in
               daylight — or being looked at by someone who cannot separate
               the two greens. The ring is the redundant, non-colour cue. */
            stroke={state === 'selected' ? 'var(--es-accent)' : 'transparent'}
            strokeWidth={state === 'selected' ? 3 : 0}
          />
        );
      })}
    </g>
  );
}

/** Re-exported so a caller can label the states without re-deriving them. */
export const SEAT_LEGEND = [
  { state: 'available', label: 'Available' },
  { state: 'selected', label: 'Your pick' },
  { state: 'sold', label: 'Taken' },
];

/** Kept honest: `normaliseShape` is what decides a bad shape falls back to
 *  round, and importing it here means an unknown shape in ROOM draws rather
 *  than throwing. */
export const SHAPES_IN_ROOM = ROOM.map((t) => normaliseShape(t.shape));
