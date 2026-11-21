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
  screen: [
    'M3 5h18v11H3z',
    'M8 20h8', 'M12 16v4',
  ],
  crowd: [
    'M5 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M15 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M10 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M3 17v-2a3 3 0 0 1 3-3h2', 'M21 17v-2a3 3 0 0 0-3-3h-2',
    'M8 20v-2a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v2',
  ],
  walk: [
    'M12 3a1.6 1.6 0 1 0 0.01 0',
    'M9 21l2-6 2 2v4', 'M11 15l-1-5 4 2 2 3', 'M10 10l-3 2',
  ],
  wheelchair: [
    'M10 3.5a1.5 1.5 0 1 0 0.01 0',
    'M10 7v6h5l2 5',
    'M7.5 10.5a5 5 0 1 0 6.9 6.6',
  ],
  barrier: [
    'M3 9h18v5H3z',
    'M7 9l-3 5', 'M13 9l-3 5', 'M19 9l-3 5',
    'M5 14v6', 'M19 14v6',
  ],
  area: [
    'M12 3l2.6 5.6 6.1.8-4.5 4.3 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z',
  ],
  // The room tools (2026-11-18): walls, door gaps, words on the floor, and a
  // decorative feature (fountain, tree, centrepiece).
  wall: [
    'M3 5h18v14H3z', 'M3 12h18', 'M9 5v7', 'M15 12v7',
  ],
  text: [
    'M5 6V4h14v2', 'M12 4v16', 'M9 20h6',
  ],
  decor: [
    'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0',
    'M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
    'M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  ],
  // The professional set (2026-11-21). Same rules: stroked, 24-unit grid,
  // circles as two arcs.
  podium: [
    'M6 11h12l-1.5 4h-9z', 'M12 15v5', 'M8 20h8', 'M10 11V8h4v3', 'M12 8V5',
  ],
  runway: [
    'M9 3h6v18H9z', 'M12 6v2', 'M12 11v2', 'M12 16v2',
  ],
  curtain: [
    'M3 4h18', 'M5 4v16', 'M19 4v16', 'M5 4c0 6 2 10 5 12', 'M19 4c0 6-2 10-5 12', 'M3 20h18',
  ],
  star: [
    'M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
  ],
  mixer: [
    'M3 6h18v12H3z', 'M8 9v6', 'M12 9v6', 'M16 9v6', 'M7 13h2', 'M11 10h2', 'M15 12h2',
  ],
  speaker: [
    'M7 3h10v18H7z',
    'M9 15a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    'M11 7.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  ],
  video: [
    'M3 7h12v10H3z', 'M15 10.5l6-3.5v10l-6-3.5',
  ],
  ticket: [
    'M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z',
    'M14 6v12',
  ],
  shirt: [
    'M9 4L4 7l2 4 2-1v10h8V10l2 1 2-4-5-3a3 3 0 0 1-6 0z',
  ],
  crown: [
    'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z', 'M5 19h14',
  ],
  stand: [
    'M3 9l2-5h14l2 5z', 'M4 9v11', 'M20 9v11', 'M4 14h16',
  ],
  truck: [
    'M2 7h12v9H2z', 'M14 10h4l3 3v3h-7',
    'M4 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M15 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  cup: [
    'M5 9h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z', 'M16 10h1.5a2.5 2.5 0 0 1 0 5H16', 'M8 3v3', 'M12 3v3', 'M4 21h13',
  ],
  drop: [
    'M12 3c2.5 3.5 6 7.4 6 11a6 6 0 0 1-12 0c0-3.6 3.5-7.5 6-11z',
  ],
  chef: [
    'M7 14a4 4 0 0 1-.6-7.9A5 5 0 0 1 12 3a5 5 0 0 1 5.6 3.1A4 4 0 0 1 17 14', 'M7 14h10v6H7z',
  ],
  info: [
    'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 11v5', 'M12 7.5v.5',
  ],
  aid: [
    'M3 7h18v13H3z', 'M9 7V4h6v3', 'M12 10.5v6', 'M9 13.5h6',
  ],
  shield: [
    'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z', 'M9 12l2 2 4-4',
  ],
  exit: [
    'M4 4h9v16H4z', 'M13 12h8', 'M18 9l3 3-3 3', 'M10 12h.01',
  ],
  lift: [
    'M5 3h14v18H5z', 'M9 9.5l3-3 3 3', 'M9 14.5l3 3 3-3',
  ],
  stairs: [
    'M3 20h5v-5h5v-5h5V5h3',
  ],
  pillar: [
    'M6 4h12', 'M6 20h12', 'M9 4v16', 'M15 4v16', 'M12 4v16',
  ],
  plant: [
    'M12 20v-8', 'M12 12c0-4-3-7-7-7 0 4 3 7 7 7z', 'M12 10c0-4 3-7 7-7 0 4-3 7-7 7z', 'M8 20h8',
  ],
  balloon: [
    'M12 3a5 5 0 0 0-5 5c0 3.5 3 6 5 7 2-1 5-3.5 5-7a5 5 0 0 0-5-5z', 'M11 16.5h2', 'M12 16.5c0 2-1.5 3-1 4.5',
  ],
  bolt: [
    'M13 2L5 13h6l-1 9 8-11h-6z',
  ],
  smoke: [
    'M3 15h13v3H3z', 'M18 15v3', 'M21 15v3', 'M18 12c0-2 3-2 3-4', 'M15 12c0-2 3-2 3-4',
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
