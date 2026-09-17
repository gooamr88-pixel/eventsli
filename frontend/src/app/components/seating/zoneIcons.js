/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The zone glyphs, as path data on a 24×24 grid.
 *
 * PATHS, NOT COMPONENTS, and not an icon package. Three things need these and
 * only one of them is a React tree rendering to a screen: the editor draws them
 * inside an SVG that is already being panned and scaled, the buyer's map does
 * the same, and the printed pack draws them into a document that must survive
 * an office mono laser. Path data is the one form all three can take — a
 * component would have to be re-implemented for the print path, which is
 * exactly how the two versions drift.
 *
 * Every glyph is STROKED, never filled, for the same printing reason: a filled
 * shape at 6mm on a photocopier is a black blob, an outline is still a picture
 * of a thing. Consumers set `stroke`, `stroke-width` and `fill="none"`; nothing
 * here carries a colour.
 *
 * A circle is written as two arcs rather than a `<circle>` because the whole
 * catalogue has to be one uniform list of `d` strings — a renderer that has to
 * switch on the element type per glyph is a renderer each of the three
 * consumers gets subtly wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const ZONE_ICONS = Object.freeze({
  mic: [
    'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z',
    'M5 11v1a7 7 0 0 0 14 0v-1',
    'M12 19v3',
  ],
  disco: [
    'M6 10a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
    'M6 10h12', 'M12 4v12', 'M7.8 5.8l8.4 8.4', 'M16.2 5.8l-8.4 8.4',
    'M12 4V2',
  ],
  cocktail: [
    'M4 5h16l-8 8z',
    'M12 13v6', 'M8 19h8',
  ],
  headphones: [
    'M4 14v-2a8 8 0 0 1 16 0v2',
    'M4 14h3v6H5a1 1 0 0 1-1-1z',
    'M20 14h-3v6h2a1 1 0 0 0 1-1z',
  ],
  door: [
    'M5 21V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v17',
    'M3 21h18',
    'M13.5 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  ],
  restroom: [
    'M5.7 4.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0',
    'M7.5 8v6', 'M5 10.5h5', 'M6 14v6', 'M9 14v6',
    'M14.7 4.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0',
    'M16.5 8l-3 7h6z', 'M15 15v5', 'M18 15v5',
  ],
  coat: [
    'M12 5.5a2 2 0 1 1 2 2c-1.2 0-2 .8-2 2v.8',
    'M12 10.3L3.6 16.2A1 1 0 0 0 4.2 18h15.6a1 1 0 0 0 .6-1.8z',
  ],
  gift: [
    'M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8',
    'M3 7h18v5H3z',
    'M12 7v14',
    'M12 7S10.5 3 8 3a2.5 2.5 0 0 0 0 5',
    'M12 7s1.5-4 4-4a2.5 2.5 0 0 1 0 5',
  ],
  cake: [
    'M4 20h16',
    'M5 20v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6',
    'M5 16c2 0 2-1.4 3.5-1.4S10 16 12 16s2-1.4 3.5-1.4S17 16 19 16',
    'M12 9V7',
    'M11 6a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  ],
  camera: [
    'M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
    'M8.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0',
  ],
  clipboard: [
    'M9 4H7a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-2',
    'M9 2h6v4H9z',
    'M9 12h6', 'M9 16h4',
  ],
  buffet: [
    'M3 18h18',
    'M5 18a7 7 0 0 1 14 0',
    'M12 5V4',
    'M11 3.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  ],
  sofa: [
    'M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3',
    'M3 13a2 2 0 0 1 4 0v3h10v-3a2 2 0 0 1 4 0v5H3z',
    'M7 16h10',
  ],
  area: [
    'M12 3l2.6 5.6 6.1.8-4.5 4.3 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z',
  ],
});

/** The grid every path above is drawn on. Consumers scale by this, rather than
 *  each one hard-coding 24 and one of them eventually not. */
export const ZONE_ICON_VIEWBOX = 24;

/** Path data for a glyph, or an empty list. An unknown name draws NOTHING
 *  rather than throwing — a zone with a bad icon should lose its picture, not
 *  take the map down with it. */
export function iconPaths(name) {
  return ZONE_ICONS[name] || [];
}
