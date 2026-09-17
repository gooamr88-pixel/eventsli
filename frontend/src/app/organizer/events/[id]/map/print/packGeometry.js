/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Page geometry for the printed pack. Millimetres, not guesses.
 *
 * The preview on screen IS the printed page. That is the whole reason this
 * module exists rather than a couple of Tailwind widths: a preview that is
 * merely "about the right shape" cannot answer the only question anybody has
 * before pressing Print, which is whether the thing they are looking at will
 * fit on the paper in the machine.
 *
 * So a sheet is sized in real millimetres from a real paper, the browser is
 * told the same size through `@page`, and the on-screen version is that page
 * scaled by a zoom the organizer controls and nothing else.
 *
 *
 * NOTHING IS EVER CLIPPED, AND THAT IS A RULE WITH A HISTORY.
 *
 * The export this replaces put the floor plan and the whole table roster side
 * by side inside a fixed-height box with `overflow: hidden`, and threw away
 * whatever did not fit. On a forty-table room that is not a layout compromise,
 * it is missing tables on the one document the door staff are holding. Here the
 * document flows and the browser paginates it; the floor plan is the single
 * fixed-height page, and it cannot clip either, because an SVG with
 * `preserveAspectRatio="xMidYMid meet"` scales into whatever box it is given.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** CSS pixels per millimetre. The CSS spec pins 1in to 96px, so this is exact
 *  rather than a calibration — the same number in every browser. */
export const PX_PER_MM = 96 / 25.4;

/** The margin on every side, in millimetres. 12 is a little inside what a
 *  domestic laser can reach, so nothing lands in a printer's dead zone. */
export const PAGE_MARGIN_MM = 12;

export const PAPERS = Object.freeze({
  a4: { label: 'A4', width: 210, height: 297 },
  letter: { label: 'US Letter', width: 216, height: 279 },
});

export const PAPER_KEYS = Object.freeze(Object.keys(PAPERS));

/**
 * The sheet and its printable area, in millimetres.
 *
 * Returns both the outer page and the inner box, because the two are needed by
 * different things — the outer sizes the sheet and the `@page` rule, the inner
 * is what the floor plan is scaled to fit.
 */
export function paperBox(paperKey, orientation) {
  const paper = PAPERS[paperKey] || PAPERS.a4;
  const landscape = orientation === 'landscape';
  const width = landscape ? paper.height : paper.width;
  const height = landscape ? paper.width : paper.height;

  return {
    label: paper.label,
    width,
    height,
    inner: {
      width: width - PAGE_MARGIN_MM * 2,
      height: height - PAGE_MARGIN_MM * 2,
    },
  };
}

/**
 * How many millimetres on paper one world unit becomes, when the room is fitted
 * into a box.
 *
 * ONE scale for both axes, taken from whichever is tighter. Scaling each axis
 * to its own box would stretch the room — and a floor plan that is not to scale
 * is worse than no floor plan, because it is used to judge whether a walkway
 * fits between two tables.
 */
export function planScale(world, box) {
  return Math.min(box.width / world.width, box.height / world.height);
}

/**
 * Sorts table labels the way a person reads them.
 *
 * "T2" before "T10", which a plain string sort gets backwards — and gets
 * backwards in exactly the document where it matters most, the index somebody
 * is scanning with a finger at the door. `numeric: true` handles the mixed
 * letter-and-digit labels these almost always are; `sensitivity: 'base'` means
 * "vip" and "VIP" sort together, which matches the uniqueness rule the API
 * enforces on them.
 */
export function compareLabels(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Millimetres → CSS pixels, for anything that has to be a pixel length. */
export const mm = (value) => `${value}mm`;
