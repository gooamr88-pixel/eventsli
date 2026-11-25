const { publicUrl } = require('./mediaService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Venue Studio's part of `venue_maps.layout_json`.
 *
 * The map API round-trips the layout blob verbatim, and until the studio that
 * was safe: zones are numbers and short labels, which React prints as text.
 * The studio adds IMAGES to it (the venue's photo, and 360° panoramas), and an
 * image URL is different. It is loaded on the buyer's public page, so a blob
 * that carries one is a link the platform vouches for, and the blob is written
 * by a client.
 *
 * So the rule from mediaService applies here too: THE CLIENT SENDS A PATH,
 * NEVER A URL. Each path must be an object this event's upload step could have
 * created (`events/<eventId>/venue-…` or `…/panorama-…`), and the URL stored
 * beside it is computed from that path, here, on every save. A URL arriving from
 * the client is discarded without being read.
 *
 * Everything else in the studio's keys (`venue`, `scene`, `sections`, and the
 * venue size `world`) is plain text and numbers, clamped to sizes the
 * renderers draw. Keys this file does not
 * know about pass through untouched, as they always have: the save is a full
 * replace, and an older server must not strip what a newer editor wrote.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The whole blob, serialised. Every buyer's map load reads it. */
const MAX_LAYOUT_BYTES = 256 * 1024;
const MAX_VIEWS = 24;
const MAX_SECTIONS = 200;
const VIEW_KINDS = Object.freeze(['seat', 'stage', 'upper', 'entrance', 'other']);
const ACCESS_FEATURES = Object.freeze(['wheelchair', 'step_free', 'hearing_loop', 'accessible_restroom', 'companion']);
const VENUE_TYPES = Object.freeze(['arena', 'theatre', 'ballroom', 'club', 'outdoor', 'conference']);
/**
 * The map's world — the size every stored percentage is resolved against.
 * Mirrors `seatingGeometry.WORLD` and `MAX_WORLD` on the frontend (a frontend
 * test reads this file and holds the numbers equal). The default is the size of
 * every map saved before worlds were per map; the maximum is a stadium bowl.
 */
const DEFAULT_WORLD = Object.freeze({ width: 1000, height: 700 });
const MAX_WORLD = Object.freeze({ width: 10000, height: 10000 });

class StudioError extends Error {
  constructor(message) {
    super(message);
    this.code = 'VALIDATION_ERROR';
  }
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * The file types each studio upload is signed as (mediaService.signUpload):
 * the stage screen's soundtrack is audio, everything else an image.
 */
const AUDIO_KINDS = Object.freeze(['soundtrack']);
const extensionsFor = (kind) => (AUDIO_KINDS.includes(kind) ? 'mp3|m4a' : 'jpg|png|webp');

/** True when `path` is an object the studio's upload step signs for THIS event. */
function ownPath(eventId, path, kinds) {
  if (typeof path !== 'string' || path.length > 300) return false;
  const prefix = `events/${eventId}/`;
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  // Each kind with its own extensions: a panorama is never an .mp3.
  return kinds.some((kind) => new RegExp(`^${kind}-[0-9a-f]{16}\\.(${extensionsFor(kind)})$`).test(name));
}

function image(eventId, raw, kinds) {
  if (!raw || !ownPath(eventId, raw.path, kinds)) return null;
  return { path: raw.path, url: publicUrl(raw.path) };
}

function cleanVenue(eventId, raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    name: text(raw.name, 120),
    type: VENUE_TYPES.includes(raw.type) ? raw.type : 'arena',
    standingCapacity: Math.round(num(raw.standingCapacity, 0, 200000, 0)),
    access: Array.isArray(raw.access) ? ACCESS_FEATURES.filter((k) => raw.access.includes(k)) : [],
    notes: text(raw.notes, 600),
    photo: image(eventId, raw.photo, ['venue']),
  };
}

function cleanViews(eventId, raw) {
  if (!Array.isArray(raw)) return undefined;
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    if (out.length >= MAX_VIEWS) break;
    const img = image(eventId, v, ['panorama']);
    if (!img) continue;
    const id = text(v.id, 40) || img.path.slice(-26, -4);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      ...img,
      name: text(v.name, 60) || 'View',
      kind: VIEW_KINDS.includes(v.kind) ? v.kind : 'other',
      // Table labels this view is taken from. Labels, not ids: a new table has
      // no id until the save that this blob travels with.
      tables: Array.isArray(v.tables)
        ? [...new Set(v.tables.map((t) => text(t, 60)).filter(Boolean))].slice(0, 400)
        : [],
      heading: num(v.heading, -180, 180, 0),
      // Where the photo was taken, so the buyer's page can put a tappable dot
      // on every seat in it: x/y are percentages of the map (as table
      // positions are) and h is the camera's height above the floor in
      // metres. Absent until the organizer lines the photo up; a photo
      // without it shows no dots, never guessed ones.
      ...(spot(v.spot) ? { spot: spot(v.spot) } : {}),
    });
  }
  return out;
}

function spot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const round = (n) => Math.round(n * 1000) / 1000;
  return {
    x: round(Math.min(100, Math.max(0, x))),
    y: round(Math.min(100, Math.max(0, y))),
    h: round(num(raw.h, 0.3, 6, 1.5)),
  };
}

function cleanSections(raw) {
  if (!Array.isArray(raw)) return undefined;
  return raw.slice(0, MAX_SECTIONS).filter((s) => s && typeof s === 'object').map((s) => ({
    id: text(s.id, 40),
    name: text(s.name, 40),
    rows: Array.isArray(s.rows)
      ? s.rows.slice(0, 60).map((r) => ({ table: text(r?.table, 60), row: text(r?.row, 8) })).filter((r) => r.table)
      : [],
  })).filter((s) => s.id && s.name);
}

function cleanScene(eventId, raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const screen = cleanScreen(eventId, raw.screen);
  return {
    rake: num(raw.rake, 0, 40, 12),
    stageHeight: num(raw.stageHeight, 0, 4, 1.2),
    mood: ['concert', 'daylight', 'gala'].includes(raw.mood) ? raw.mood : 'concert',
    screens: raw.screens !== false,
    roof: raw.roof !== false,
    ...(screen ? { screen } : {}),
  };
}

/* ── the stage screen (2026-11-25) ─────────────────────────────────────────
 * What the 3D room's LED wall plays: slides, their look, and Showtime's
 * music. The frontend reads it the same way (components/venue/stage/
 * screenModel.js, `readScreen`); this is the server's copy of the rule, so
 * a hand-made request stores only known words, numbers in range, short text,
 * and files this event's upload step signed: a slide's photo (`screen-…`)
 * and the soundtrack (`soundtrack-….mp3|m4a`), each URL derived here.
 * The screen's SHAPE is never stored: it is always 16:9.
 */
const SLIDE_KINDS = Object.freeze(['title', 'countdown', 'artist', 'lineup', 'photo', 'sponsors', 'message', 'visualizer']);
const MAX_SLIDES = 12;
const SCREEN_STYLES = Object.freeze(['bold', 'elegant', 'neon']);
const SCREEN_TRANSITIONS = Object.freeze(['fade', 'slide', 'cut']);
const SOUND_SOURCES = Object.freeze(['preset', 'track', 'off']);
const SOUND_PRESETS = Object.freeze(['arena', 'lounge', 'cinematic', 'chill']);

function focus(raw) {
  return { x: Math.round(num(raw?.x, 0, 100, 50)), y: Math.round(num(raw?.y, 0, 100, 40)) };
}

function cleanSlide(eventId, raw) {
  if (!raw || typeof raw !== 'object' || !SLIDE_KINDS.includes(raw.kind)) return null;
  const id = text(raw.id, 40);
  if (!id) return null;
  const slide = { id, kind: raw.kind };
  if (raw.kind === 'artist' || raw.kind === 'photo') {
    slide.image = image(eventId, raw.image, ['screen']);
    slide.focus = focus(raw.focus);
    if (raw.kind === 'artist') {
      slide.name = text(raw.name, 60);
      slide.tagline = text(raw.tagline, 80);
    } else {
      slide.caption = text(raw.caption, 100);
    }
  } else if (raw.kind === 'message') {
    slide.text = text(raw.text, 80);
    slide.sub = text(raw.sub, 80);
  }
  return slide;
}

function cleanScreen(eventId, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const seen = new Set();
  const slides = [];
  for (const r of Array.isArray(raw.slides) ? raw.slides : []) {
    if (slides.length >= MAX_SLIDES) break;
    const slide = cleanSlide(eventId, r);
    if (!slide || seen.has(slide.id)) continue;
    seen.add(slide.id);
    slides.push(slide);
  }
  const sound = raw.sound && typeof raw.sound === 'object' ? raw.sound : {};
  const track = image(eventId, sound.track, AUDIO_KINDS);
  return {
    slides,
    seconds: Math.round(num(raw.seconds, 4, 20, 8)),
    transition: SCREEN_TRANSITIONS.includes(raw.transition) ? raw.transition : 'fade',
    style: SCREEN_STYLES.includes(raw.style) ? raw.style : 'bold',
    accent: hex(raw.accent) || null,
    pixels: raw.pixels !== false,
    size: Math.round(num(raw.size, 60, 100, 100)),
    sides: raw.sides !== false,
    sound: {
      source: SOUND_SOURCES.includes(sound.source) ? sound.source : 'preset',
      preset: SOUND_PRESETS.includes(sound.preset) ? sound.preset : null,
      track: track ? { ...track, name: text(sound.track?.name, 80) } : null,
      volume: Math.round(num(sound.volume, 0, 100, 70)),
    },
    react: raw.react !== false,
  };
}

/**
 * Whole units between the default world and the maximum, or undefined (the key
 * is dropped, and the map draws in the default world) when it is unreadable.
 * Positions are percentages, so this never moves a seat: it only says how big
 * the floor they are percentages of is, and the editor sends tables moved to
 * match in the same save.
 */
function cleanWorld(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const w = Number(raw.width);
  const h = Number(raw.height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return undefined;
  return {
    width: Math.round(Math.min(MAX_WORLD.width, Math.max(DEFAULT_WORLD.width, w))),
    height: Math.round(Math.min(MAX_WORLD.height, Math.max(DEFAULT_WORLD.height, h))),
  };
}

/* ── map styling (2026-11-18) ─────────────────────────────────────────────
 * The organizer's colours: per-table styles keyed by label, and the map's
 * look. The frontend cleans both the same way (components/seating/mapStyle.js);
 * this is the server's copy of that rule, so a hand-made request stores only
 * colours, numbers in range and known words.
 */
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_TABLE_STYLES = 400;
const LOOK_COLOURS = ['floor', 'wall', 'table', 'label', 'seat', 'accent'];
const LOOK_FONTS = ['sans', 'bold', 'serif'];
const SIDE_KEYS = ['top', 'right', 'bottom', 'left'];
const hex = (v) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : undefined);
const bounded = (v, lo, hi) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined;
};

function cleanTableStyle(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  if (raw.sides && typeof raw.sides === 'object') {
    const sides = {};
    for (const k of SIDE_KEYS) {
      const v = bounded(raw.sides[k], 0, 60);
      if (v !== undefined) sides[k] = Math.round(v);
    }
    if (Object.keys(sides).length) out.sides = sides;
  }
  for (const k of ['fill', 'labelColor', 'stroke', 'seatColor']) {
    const c = hex(raw[k]);
    if (c) out[k] = c;
  }
  const sw = bounded(raw.strokeWidth, 0, 8);
  if (sw !== undefined) out.strokeWidth = sw;
  const radius = bounded(raw.radius, 0, 26);
  if (radius !== undefined) out.radius = Math.round(radius);
  // The table's drawn size, 50%–150% (seatingGeometry.tableScale); 1 is left out.
  const scale = bounded(raw.scale, 0.5, 1.5);
  if (scale !== undefined && Math.round(scale * 100) !== 100) out.scale = Math.round(scale * 100) / 100;
  return Object.keys(out).length ? out : undefined;
}

function cleanTableStyles(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  for (const [label, style] of Object.entries(raw).slice(0, MAX_TABLE_STYLES)) {
    const key = text(label, 40).toLowerCase();
    const clean = cleanTableStyle(style);
    if (key && clean) out[key] = clean;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanLook(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  for (const k of LOOK_COLOURS) {
    const c = hex(raw[k]);
    if (c) out[k] = c;
  }
  if (LOOK_FONTS.includes(raw.font)) out.font = raw.font;
  const name = text(raw.name, 40);
  if (name) out.name = name;
  return Object.keys(out).length ? out : undefined;
}

/**
 * The layout as buyers receive it: table styles only for the tables they can
 * see. A style is keyed by the table's name, so a private table's style would
 * announce that table to everyone.
 */
function publicLayout(layout, visibleLabels) {
  if (!layout || typeof layout !== 'object' || !layout.tableStyles) return layout;
  const keep = new Set((visibleLabels || []).map((l) => String(l).trim().toLowerCase()));
  const styles = {};
  for (const [label, style] of Object.entries(layout.tableStyles)) {
    if (keep.has(label)) styles[label] = style;
  }
  const out = { ...layout, tableStyles: styles };
  if (Object.keys(styles).length === 0) delete out.tableStyles;
  return out;
}

/**
 * The layout as it will be stored. Throws a VALIDATION_ERROR only for a blob
 * too large to serve; anything malformed inside the studio's keys is dropped
 * rather than refused, the same contract `layoutZones.readZones` keeps.
 */
function sanitizeLayout(eventId, layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return {};
  const out = { ...layout };
  const set = (key, value) => { if (value === undefined) delete out[key]; else out[key] = value; };
  if ('venue' in layout) set('venue', cleanVenue(eventId, layout.venue));
  if ('views' in layout) set('views', cleanViews(eventId, layout.views));
  if ('sections' in layout) set('sections', cleanSections(layout.sections));
  if ('scene' in layout) set('scene', cleanScene(eventId, layout.scene));
  if ('world' in layout) set('world', cleanWorld(layout.world));
  if ('tableStyles' in layout) set('tableStyles', cleanTableStyles(layout.tableStyles));
  if ('look' in layout) set('look', cleanLook(layout.look));

  if (Buffer.byteLength(JSON.stringify(out), 'utf8') > MAX_LAYOUT_BYTES) {
    throw new StudioError('This venue layout is too large to save. Remove some areas or views and try again.');
  }
  return out;
}

module.exports = {
  sanitizeLayout, publicLayout, cleanLook, ownPath, MAX_LAYOUT_BYTES, MAX_VIEWS, VIEW_KINDS, ACCESS_FEATURES, VENUE_TYPES,
  DEFAULT_WORLD, MAX_WORLD, cleanScreen, SLIDE_KINDS, MAX_SLIDES, STUDIO_KINDS: Object.freeze(['venue', 'panorama', 'screen', 'soundtrack']),
};
