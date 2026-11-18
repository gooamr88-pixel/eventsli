/**
 * What each table shape is called in the interface.
 *
 * Separated from `TablePanel`, where it used to live, the moment a second
 * surface needed it: the Add dialog labels its shape tiles from this and the
 * toolbar's filter menu names its options from it. Two copies of a label list
 * is how a shape ends up called "Rectangle" in one place and "Rect" in another,
 * and the organizer cannot tell whether they are the same thing.
 *
 * The KEYS are the contract — `seatingGeometry.SHAPES` is what the map can
 * draw, and this only names them. A shape with no entry falls back to its raw
 * key, which is ugly but correct; a NAME with no shape is dead text nobody
 * sees. `seatingGeometry.test.js` is where the catalogue itself is pinned.
 */
export const SHAPE_NAMES = Object.freeze({
  round: 'Round',
  oval: 'Oval',
  rect: 'Rectangle',
  square: 'Square',
  row: 'Row of seats',
  d_shape: 'D-shape booth',
  rounded_end: 'Rounded end',
  pill: 'Pill',
  hexagon: 'Hexagon',
  u_shape: 'U-shape',
  half_moon: 'Half-moon',
  high_top: 'High-top',
});

/** A one-line description for the Add dialog, where the organizer is choosing
 *  between shapes rather than confirming one they already picked. */
export const SHAPE_HINTS = Object.freeze({
  round: 'Seats all the way around.',
  oval: 'A long round table.',
  rect: 'Banquet style — seats down both long sides.',
  square: 'Seats spread over four sides.',
  row: 'A straight bank of seats with no table.',
  d_shape: 'A booth: flat back, curved front.',
  rounded_end: 'Long table with one rounded end.',
  pill: 'Long table, both ends rounded.',
  hexagon: 'Six sides, seats on the long ones.',
  u_shape: 'Head table, seats around the outside.',
  half_moon: 'Seats along the curve only.',
  high_top: 'A small standing table with stools.',
});
