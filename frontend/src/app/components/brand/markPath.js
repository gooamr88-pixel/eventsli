/**
 * The Eventsli mark — the framed star — as vector path data, in a 512 x 500 box.
 *
 * RESTORED 2026-10-16. This is the mark Via Marketing's brand guide is built on,
 * and the mark the product carried until 2026-09-16, when a leaf with a spiral
 * replaced it. The guide puts the star back on everything: the masthead, the app
 * icon, the ticket, the badges, the signage. The leaf is gone.
 *
 * DRAWN, not traced, from the geometry of the original artwork
 * (`events platform/dist/assets/favicon-v2.png`): a frame with chamfered top
 * corners and a stepped base, and a regular five-point star inside it. A trace
 * of a 512px PNG carries every wobble of its own anti-aliasing; these are the
 * shapes the artwork was made from, exact at 16px and at 2,000.
 *
 * `FRAME` needs `fill-rule="evenodd"`: its second subpath is the square window
 * the star sits in, and only even-odd makes that a hole rather than a second
 * solid square painted over the first.
 *
 * Read by three things that must agree: `Logo.jsx`, `app/icon.svg` (the
 * favicon, which never sees a stylesheet so it carries the paths literally) and
 * `scripts/brandIcons.js`, which renders every PNG icon from them.
 * `test/logo.test.js` fails if the favicon's copy ever drifts from this one.
 */
export const MARK_VIEWBOX = '0 0 512 500';

export const MARK_FRAME = 'M90 0H420L512 90V432H420V500H92V432H0V90ZM92 70V432H420V70Z';

export const MARK_STAR = 'M256 118L284.2 204.7H375.4L301.7 258.3L329.8 345L256 291.5L182.2 345L210.3 258.3L136.6 204.7H227.8Z';
