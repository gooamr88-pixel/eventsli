/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STAGE SCREEN (2026-11-25): what the LED wall over the stage plays.
 *
 * The screen was a still picture of the event's name. It is now a show: a
 * playlist of slides (the event's title, a live countdown, the headliner, the
 * lineup, photos, sponsors, a message, a music visualizer) that the organizer
 * orders and fills in the 3D settings, painted onto the screen by
 * `screenPainter.js` and, in Showtime, moved by the music (`stageSound.js`).
 *
 * Stored in the layout blob as `scene.screen`. The same contract as the rest
 * of the studio's keys (venueModel.js): READING IS DEFENSIVE. Anything
 * malformed is dropped here, before a painter sees it; the server repeats the
 * cleaning (backend/services/stageScreen.js) and is the one that decides
 * image and audio URLs.
 *
 * ALWAYS LANDSCAPE (owner, 2026-11-25). Every screen is 16:9, whatever it
 * shows and however the organizer drew it: `screenSize` is the one place a
 * screen's shape is decided, and it has no portrait answer. A photo is never
 * stretched to fit: it is cropped to 16:9 around the organizer's focus point.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const SCREEN_ASPECT = 16 / 9;
export const MAX_SLIDES = 12;
/** The time each slide holds the screen, in seconds. */
export const SLIDE_SECONDS = Object.freeze({ min: 4, max: 20, default: 8 });
/** A transition's length, in milliseconds. Part of the slide's own time. */
export const TRANSITION_MS = 800;

export const SLIDE_KINDS = Object.freeze([
  { key: 'title', label: 'Event title', icon: 'sparkle', hint: 'The event name, date and venue, over your cover image.' },
  { key: 'countdown', label: 'Countdown', icon: 'clock', hint: 'A live clock to the start. Says “Live now” once it begins.' },
  { key: 'artist', label: 'Headliner', icon: 'mic', hint: 'A performer’s photo and name, full screen.' },
  { key: 'lineup', label: 'Lineup', icon: 'list', hint: 'The running order from your event’s schedule.' },
  { key: 'photo', label: 'Photo', icon: 'image', hint: 'A poster, a promo or an ad, with a caption.' },
  { key: 'video', label: 'Video', icon: 'film', hint: 'A clip (MP4 or WebM). Its sound plays in Showtime, from the stage.' },
  { key: 'gallery', label: 'Event photos', icon: 'grid', hint: 'The photos from your event page’s gallery, as a photo wall.' },
  { key: 'sponsors', label: 'Sponsors', icon: 'handshake', hint: 'Your event’s sponsors’ logos.' },
  { key: 'message', label: 'Message', icon: 'chat', hint: 'Your words, big: a welcome, a hashtag, a dress code.' },
  { key: 'visualizer', label: 'Music visualizer', icon: 'music', hint: 'Light that moves to the soundtrack.' },
]);
const KIND_KEYS = SLIDE_KINDS.map((k) => k.key);

export const SCREEN_STYLES = Object.freeze([
  { key: 'bold', label: 'Bold', hint: 'Heavy type and moving colour' },
  { key: 'elegant', label: 'Elegant', hint: 'Serif type, gold light' },
  { key: 'neon', label: 'Neon', hint: 'Glowing type, a grid horizon' },
]);

export const TRANSITIONS = Object.freeze([
  { key: 'fade', label: 'Fade' },
  { key: 'slide', label: 'Slide' },
  { key: 'cut', label: 'Cut' },
]);

/** Eventsli's own music: generated in the browser, so there is nothing to license or download. */
export const SOUND_PRESETS = Object.freeze([
  { key: 'arena', label: 'Arena', hint: 'A driving pulse for a big room' },
  { key: 'lounge', label: 'Lounge', hint: 'Warm keys and soft brushes' },
  { key: 'cinematic', label: 'Cinematic', hint: 'Slow swells and deep drums' },
  { key: 'chill', label: 'Chill', hint: 'Light plucks and an easy groove' },
]);
const PRESET_KEYS = SOUND_PRESETS.map((p) => p.key);

export const SOUND_SOURCES = Object.freeze([
  { key: 'preset', label: 'Eventsli music' },
  { key: 'track', label: 'Your track' },
  { key: 'off', label: 'No music' },
]);

/** The music that suits the room's lighting, when the organizer has not chosen. */
export const PRESET_FOR_MOOD = Object.freeze({ concert: 'arena', gala: 'lounge', daylight: 'chill' });

/** Seconds of an organizer's track the bucket takes: 8 MB, about 4 minutes of MP3. */
export const MAX_TRACK_BYTES = 8 * 1024 * 1024;
/** A screen video: 40 MB, a minute or so of 1080p. */
export const MAX_CLIP_BYTES = 40 * 1024 * 1024;
/** The main screen's width as a % of the stage's: wider than the stage is allowed, as real LED walls are. */
export const SCREEN_WIDTH = Object.freeze({ min: 40, max: 150, default: 80 });

export const DEFAULT_SCREEN = Object.freeze({
  slides: Object.freeze([
    Object.freeze({ id: 'sl-title', kind: 'title' }),
    Object.freeze({ id: 'sl-count', kind: 'countdown' }),
    Object.freeze({ id: 'sl-lineup', kind: 'lineup' }),
    Object.freeze({ id: 'sl-sponsors', kind: 'sponsors' }),
  ]),
  seconds: SLIDE_SECONDS.default,
  transition: 'fade',
  style: 'bold',
  accent: null,
  pixels: true,
  // The main screen's width, as a % of the stage's width (SCREEN_WIDTH).
  size: SCREEN_WIDTH.default,
  sides: true,
  sound: Object.freeze({ source: 'preset', preset: null, track: null, volume: 85 }),
  // Stage lights, the rim and the screen's glow pulse with the music.
  react: true,
  // Showtime starts by itself when the 3D view opens (owner, 2026-11-25).
  autoplay: true,
});

const HEX = /^#[0-9a-f]{6}$/i;
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const oneOf = (list, v, fallback) => (list.some((x) => x.key === v) ? v : fallback);

/** An uploaded file the server vouched for: an http(s) URL beside its path. */
function readFile(raw) {
  if (!raw || typeof raw.path !== 'string' || typeof raw.url !== 'string') return null;
  if (!/^https?:\/\//i.test(raw.url)) return null;
  return { path: raw.path, url: raw.url };
}

/** Where a photo's subject is, as % across and down: what a 16:9 crop keeps. */
function readFocus(raw) {
  return { x: num(raw?.x, 0, 100, 50), y: num(raw?.y, 0, 100, 40) };
}

function readSlide(raw) {
  if (!raw || typeof raw !== 'object' || !KIND_KEYS.includes(raw.kind)) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : null;
  if (!id) return null;
  const slide = { id, kind: raw.kind };
  if (raw.kind === 'artist') {
    slide.name = text(raw.name, 60);
    slide.tagline = text(raw.tagline, 80);
    slide.image = readFile(raw.image);
    slide.focus = readFocus(raw.focus);
  } else if (raw.kind === 'photo') {
    slide.caption = text(raw.caption, 100);
    slide.image = readFile(raw.image);
    slide.focus = readFocus(raw.focus);
  } else if (raw.kind === 'video') {
    slide.caption = text(raw.caption, 100);
    slide.video = readFile(raw.video);
    slide.focus = readFocus(raw.focus);
    // Its own sound plays in Showtime unless the organizer turns it off.
    slide.sound = raw.sound !== false;
  } else if (raw.kind === 'message') {
    slide.text = text(raw.text, 80);
    slide.sub = text(raw.sub, 80);
  }
  return slide;
}

/** The screen's settings, always complete and always paintable. */
export function readScreen(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  let slides = DEFAULT_SCREEN.slides.map((x) => ({ ...x }));
  if (Array.isArray(s.slides)) {
    const seen = new Set();
    slides = [];
    for (const r of s.slides) {
      if (slides.length >= MAX_SLIDES) break;
      const slide = readSlide(r);
      if (!slide || seen.has(slide.id)) continue;
      seen.add(slide.id);
      slides.push(slide);
    }
  }
  const sound = s.sound && typeof s.sound === 'object' ? s.sound : {};
  const track = readFile(sound.track);
  return {
    slides,
    seconds: Math.round(num(s.seconds, SLIDE_SECONDS.min, SLIDE_SECONDS.max, SLIDE_SECONDS.default)),
    transition: oneOf(TRANSITIONS, s.transition, DEFAULT_SCREEN.transition),
    style: oneOf(SCREEN_STYLES, s.style, DEFAULT_SCREEN.style),
    accent: typeof s.accent === 'string' && HEX.test(s.accent) ? s.accent.toLowerCase() : null,
    pixels: s.pixels !== false,
    size: Math.round(num(s.size, SCREEN_WIDTH.min, SCREEN_WIDTH.max, SCREEN_WIDTH.default)),
    sides: s.sides !== false,
    sound: {
      source: oneOf(SOUND_SOURCES, sound.source, 'preset'),
      preset: PRESET_KEYS.includes(sound.preset) ? sound.preset : null,
      track: track ? { ...track, name: text(sound.track?.name, 80) } : null,
      volume: Math.round(num(sound.volume, 0, 100, 85)),
    },
    react: s.react !== false,
    autoplay: s.autoplay !== false,
  };
}

/** What `scene.screen` saves as: the same shape, nothing a reader would drop. */
export function writeScreen(screen) {
  return readScreen(screen);
}

/**
 * THE SHAPE OF EVERY SCREEN, decided here and nowhere else: 16:9, landscape.
 *
 * `room` is the width the screen may take and `maxHeight` the height it may
 * take. The screen is the largest 16:9 rectangle inside both, times `size`
 * (a percentage). There is no portrait answer: a tall, narrow space gets a
 * small landscape screen, never a tall one.
 */
export function screenSize({ room, maxHeight = Infinity, size = 100, minWidth = 1.6 }) {
  const fit = Math.min(Math.max(0, room), Math.max(0, maxHeight) * SCREEN_ASPECT);
  const w = Math.max(minWidth, fit * (num(size, 10, 200, 100) / 100));
  return { w, h: w / SCREEN_ASPECT };
}

/** The music a show plays: a preset key, a track URL, or nothing. */
export function soundFor(screen, mood) {
  const sound = screen?.sound || DEFAULT_SCREEN.sound;
  if (sound.source === 'off') return { kind: 'off', volume: sound.volume / 100 };
  if (sound.source === 'track' && sound.track?.url) {
    return { kind: 'track', url: sound.track.url, name: sound.track.name || 'Your track', volume: sound.volume / 100 };
  }
  const preset = sound.preset || PRESET_FOR_MOOD[mood] || 'arena';
  const label = SOUND_PRESETS.find((p) => p.key === preset)?.label || 'Arena';
  return { kind: 'preset', preset, name: `${label} · Eventsli music`, volume: sound.volume / 100 };
}

// ── the clock ────────────────────────────────────────────────────────────────

const SHOW_LENGTH_FALLBACK_MS = 5 * 3600 * 1000;

/**
 * Where an event stands against the clock: counting down, on now, or over.
 * An event with no end is taken to run five hours, long enough for a concert
 * and short enough that a past event stops saying "Live now".
 */
export function countdown(startsAt, endsAt, now = Date.now()) {
  const start = Date.parse(startsAt || '');
  if (!Number.isFinite(start)) return null;
  const endParsed = Date.parse(endsAt || '');
  const end = Number.isFinite(endParsed) && endParsed > start ? endParsed : start + SHOW_LENGTH_FALLBACK_MS;
  if (now >= end) return { state: 'over' };
  if (now >= start) return { state: 'live' };
  let left = Math.floor((start - now) / 1000);
  const days = Math.floor(left / 86400); left -= days * 86400;
  const hours = Math.floor(left / 3600); left -= hours * 3600;
  const minutes = Math.floor(left / 60);
  const seconds = left - minutes * 60;
  return { state: 'before', days, hours, minutes, seconds };
}

/**
 * The slides that have something to show right now, in the organizer's order.
 * A lineup with no schedule, sponsors with none added, a photo with no photo,
 * a message with no words and a countdown to an event that is over are all
 * skipped, so the screen never shows an empty frame. Nothing left: the title.
 */
export function playableSlides(slides, feed, now = Date.now()) {
  const list = (slides || []).filter((s) => {
    switch (s.kind) {
      case 'lineup': return (feed?.lineup?.length || 0) > 0;
      case 'sponsors': return (feed?.sponsors?.length || 0) > 0;
      case 'photo': return Boolean(s.image?.url);
      case 'video': return Boolean(s.video?.url);
      case 'gallery': return (feed?.gallery?.length || 0) > 0;
      case 'artist': return Boolean(s.image?.url || s.name);
      case 'message': return Boolean(s.text);
      case 'countdown': {
        const c = countdown(feed?.startsAt, feed?.endsAt, now);
        return Boolean(c && c.state !== 'over');
      }
      default: return true;
    }
  });
  return list.length ? list : [{ id: 'sl-fallback', kind: 'title' }];
}

/**
 * Which slide is on at `elapsedMs` into the show, how far into it, and — for
 * the first TRANSITION_MS of each — the one it is taking over from.
 */
export function slideAt(count, seconds, elapsedMs) {
  const n = Math.max(1, count);
  const dur = Math.max(1, seconds) * 1000;
  const t = Math.max(0, elapsedMs);
  const turn = Math.floor(t / dur);
  const into = t - turn * dur;
  const index = turn % n;
  const blending = n > 1 && turn > 0 && into < TRANSITION_MS;
  return {
    index,
    previous: blending ? (index - 1 + n) % n : null,
    // 0 → 1 across the transition; 1 once it is done.
    mix: blending ? into / TRANSITION_MS : 1,
    // 0 → 1 across the slide's whole time on screen.
    progress: into / dur,
    turn,
  };
}
