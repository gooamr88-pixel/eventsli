import {
  describe, test, expect, beforeAll, afterAll, vi,
} from 'vitest';
import * as THREE from 'three';
import {
  readScreen, screenSize, playableSlides, slideAt, countdown, soundFor, DEFAULT_SCREEN, MAX_SLIDES,
  SCREEN_ASPECT, SLIDE_KINDS, TRANSITION_MS,
} from '../src/app/components/venue/stage/screenModel';
import { createScreenPainter } from '../src/app/components/venue/stage/screenPainter';
import { PATTERNS, idleBeat } from '../src/app/components/venue/stage/stageSound';
import { readStudio } from '../src/app/components/venue/venueModel';
import { buildSceneModel } from '../src/app/components/venue/sceneModel';
import { buildRoom } from '../src/app/components/venue/roomBuilder';
import { emptyReason } from '../src/app/organizer/events/[id]/map/studio/ScreenSettings';
import { audioType, videoType } from '../src/app/organizer/events/[id]/map/studio/uploadStudioImage';

/**
 * THE STAGE SCREEN (2026-11-25): the 3D room's LED wall plays a show.
 *
 * The owner's one hard rule is that a screen is ALWAYS LANDSCAPE, and the
 * owner does not want browser checks, so this file is the proof: the shape
 * rule on its own, then the real room builder (three.js runs in node) and the
 * real painter (on a recording 2D context, since jsdom has no canvas) run
 * end to end.
 */

/** A 2D context that records nothing and draws nothing, but answers like one. */
function fakeContext(canvas) {
  const target = { canvas, font: '10px sans-serif', calls: 0 };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === 'measureText') {
        return (text) => ({ width: String(text).length * (parseFloat(/(\d+)px/.exec(t.font)?.[1] || '10') * 0.55) });
      }
      if (key === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(120) });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (key === 'createPattern') return () => ({});
      return () => { t.calls += 1; };
    },
    set(t, key, value) { t[key] = value; return true; },
  });
}

let restore;
beforeAll(() => {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.fake) this.fake = fakeContext(this);
    return this.fake;
  };
  // jsdom has no media playback; a video slide's play/pause must still be callable.
  const { play, pause } = HTMLMediaElement.prototype;
  HTMLMediaElement.prototype.play = function fakePlay() { return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function fakePause() {};
  restore = () => {
    HTMLCanvasElement.prototype.getContext = original;
    HTMLMediaElement.prototype.play = play;
    HTMLMediaElement.prototype.pause = pause;
  };
});
afterAll(() => restore());

const FEED = {
  title: 'Midnight Orchestra Live',
  startsAt: '2030-06-01T19:00:00Z',
  endsAt: '2030-06-01T23:00:00Z',
  timezone: 'America/Toronto',
  venueName: 'Riverside Arena',
  coverUrl: 'https://storage.test/cover.jpg',
  logoUrl: null,
  lineup: [
    { title: 'Doors', startsAt: '2030-06-01T18:00:00Z', endsAt: null, location: null },
    { title: 'The Headliner', startsAt: '2030-06-01T20:00:00Z', endsAt: '2030-06-01T22:00:00Z', location: 'Main stage' },
  ],
  sponsors: [{ name: 'Acme', logoUrl: null, level: 'gold' }],
  gallery: [{ url: 'https://storage.test/g1.jpg', caption: 'Last year' }, { url: 'https://storage.test/g2.jpg', caption: null }],
};

describe('the screen is always landscape', () => {
  test('every size is exactly 16:9', () => {
    for (const room of [0, 0.5, 1, 4, 12, 40, 200]) {
      for (const maxHeight of [0, 0.3, 1, 3, 9, 50, Infinity]) {
        for (const size of [60, 80, 100, 140, -5]) {
          const { w, h } = screenSize({ room, maxHeight, size });
          expect(w).toBeGreaterThan(h);
          expect(w / h).toBeCloseTo(SCREEN_ASPECT, 6);
        }
      }
    }
  });

  test('a tall, narrow space gets a small landscape screen, never a tall one', () => {
    const { w, h } = screenSize({ room: 1, maxHeight: 20 });
    expect(w).toBeGreaterThan(h);
    expect(w).toBeCloseTo(1.6, 6);
  });

  test('the stage screen can be WIDER than the stage, and is still 16:9', () => {
    const { w, h } = screenSize({ room: 10, size: 150 });
    expect(w).toBeCloseTo(15, 6);
    expect(w / h).toBeCloseTo(16 / 9, 6);
  });

  test('the height limit wins when it is the tighter one', () => {
    const { w, h } = screenSize({ room: 100, maxHeight: 4.5 });
    expect(h).toBeCloseTo(4.5, 6);
    expect(w).toBeCloseTo(8, 6);
  });

  describe('in the room', () => {
    const stage = { id: 'st', kind: 'stage', x: 50, y: 8, w: 300, h: 70, rotation: 0 };
    const rows = [{ id: 'r1', label: 'R1', shape: 'row', seatCount: 8, position: { x: 50, y: 50, rotation: 0 } }];
    const ratio = (mesh) => mesh.geometry.parameters.width / mesh.geometry.parameters.height;

    test('the stage screen and both side screens are 16:9 planes', () => {
      const model = buildSceneModel({ tables: rows, zones: [stage], scene: { rake: 0 } });
      const room = buildRoom(THREE, model, { mood: 'concert', screens: true, roof: true, stageHeight: 1.2 }, { title: 'Live' });
      expect(room.show.screens).toHaveLength(3);
      for (const s of room.show.screens) expect(ratio(s)).toBeCloseTo(16 / 9, 6);
      expect(room.show.anchor).not.toBeNull();
      expect(room.show.glow).not.toBeNull();
    });

    test('side screens off, and a smaller main screen, are still 16:9', () => {
      const model = buildSceneModel({ tables: rows, zones: [stage], scene: { rake: 0 } });
      const full = buildRoom(THREE, model, { mood: 'gala', screens: true }, { title: 'Live' });
      const small = buildRoom(THREE, model, { mood: 'gala', screens: true }, { title: 'Live', screenLayout: { size: 60, sides: false } });
      expect(small.show.screens).toHaveLength(1);
      expect(ratio(small.show.screens[0])).toBeCloseTo(16 / 9, 6);
      expect(small.show.screens[0].geometry.parameters.width).toBeLessThan(full.show.screens[0].geometry.parameters.width);
    });

    test('a screen wider than the stage: still 16:9, and the truss rises to clear it', () => {
      const model = buildSceneModel({ tables: rows, zones: [stage], scene: { rake: 0 } });
      const room = buildRoom(THREE, model, { mood: 'concert', screens: true, stageHeight: 1.2 }, { title: 'Live', screenLayout: { size: 150, sides: false } });
      const s = room.show.screens[0];
      expect(s.geometry.parameters.width).toBeCloseTo(model.zones[0].w * 1.5, 6);
      expect(ratio(s)).toBeCloseTo(16 / 9, 6);
      const screenTop = s.parent.position.y + s.geometry.parameters.height / 2;
      for (const b of room.show.beams) expect(b.pivot.position.y).toBeGreaterThan(screenTop);
    });

    test('a screen drawn TALL on the 2D map turns instead of standing on end', () => {
      const tall = { id: 'sc', kind: 'screen', x: 20, y: 50, w: 20, h: 200, rotation: 0 };
      const model = buildSceneModel({ tables: rows, zones: [tall], scene: { rake: 0 } });
      const room = buildRoom(THREE, model, { mood: 'concert', screens: true }, { title: 'Live' });
      expect(room.show.screens).toHaveLength(1);
      const s = room.show.screens[0];
      expect(ratio(s)).toBeCloseTo(16 / 9, 6);
      // As wide as the long side the organizer drew.
      expect(s.geometry.parameters.width).toBeCloseTo(model.zones[0].d, 6);
    });

    test('screens off: no screens, and nothing for Showtime to tap', () => {
      const model = buildSceneModel({ tables: rows, zones: [stage], scene: { rake: 0 } });
      const room = buildRoom(THREE, model, { mood: 'concert', screens: false }, { title: 'Live' });
      expect(room.show.screens).toHaveLength(0);
      // The house lights are still there to dim.
      expect(room.show.house.length).toBe(3);
    });

    test('every room has beams for Showtime; only a concert shows them at rest', () => {
      const model = buildSceneModel({ tables: rows, zones: [stage], scene: { rake: 0 } });
      const gala = buildRoom(THREE, model, { mood: 'gala', screens: true }, { title: 'Live' });
      expect(gala.show.beams.length).toBe(5);
      expect(gala.show.beams.every((b) => !b.pivot.visible)).toBe(true);
      const concert = buildRoom(THREE, model, { mood: 'concert', screens: true }, { title: 'Live' });
      expect(concert.show.beams.every((b) => b.pivot.visible)).toBe(true);
    });

    test('the show texture is shared by every screen', () => {
      const model = buildSceneModel({ tables: rows, zones: [stage], scene: { rake: 0 } });
      const tex = new THREE.CanvasTexture(document.createElement('canvas'));
      const room = buildRoom(THREE, model, { mood: 'concert', screens: true }, { title: 'Live', screenTexture: tex });
      expect(room.show.screens.every((s) => s.material.map === tex)).toBe(true);
    });
  });
});

describe('readScreen — nothing malformed reaches the painter', () => {
  test('nothing stored: the default show', () => {
    const s = readScreen(undefined);
    expect(s.slides.map((x) => x.kind)).toEqual(DEFAULT_SCREEN.slides.map((x) => x.kind));
    expect(s.seconds).toBe(8);
    expect(s.sound.source).toBe('preset');
    expect(s.sides).toBe(true);
  });

  test('unknown kinds, missing and repeated ids are dropped; the list is capped', () => {
    const slides = [
      { id: 'a', kind: 'title' }, { id: 'a', kind: 'message', text: 'dup' }, { kind: 'title' },
      { id: 'b', kind: 'hologram' }, ...Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, kind: 'message', text: 'x' })),
    ];
    const s = readScreen({ slides });
    expect(s.slides[0]).toEqual({ id: 'a', kind: 'title' });
    expect(s.slides.length).toBe(MAX_SLIDES);
    expect(s.slides.some((x) => x.kind === 'hologram')).toBe(false);
  });

  test('a photo URL that is not http(s) is dropped; text is cut to length', () => {
    const s = readScreen({
      slides: [
        { id: 'p', kind: 'photo', image: { path: 'x', url: 'javascript:alert(1)' }, caption: 'c'.repeat(500) },
        { id: 'a', kind: 'artist', name: 'n'.repeat(500), image: { path: 'p', url: 'https://storage.test/a.jpg' }, focus: { x: 900, y: -4 } },
      ],
    });
    expect(s.slides[0].image).toBeNull();
    expect(s.slides[0].caption).toHaveLength(100);
    expect(s.slides[1].name).toHaveLength(60);
    expect(s.slides[1].focus).toEqual({ x: 100, y: 0 });
  });

  test('numbers are clamped and words must be known', () => {
    const s = readScreen({
      seconds: 999, size: 5, style: 'vapor', transition: 'spin', accent: 'red',
      sound: { source: 'radio', preset: 'polka', volume: 400, track: { path: 'p', url: 'ftp://x' } },
    });
    expect(s.seconds).toBe(20);
    expect(s.size).toBe(40);
    expect(readScreen({ size: 900 }).size).toBe(150);
    expect(readScreen({}).size).toBe(80);
    expect(s.style).toBe('bold');
    expect(s.transition).toBe('fade');
    expect(s.accent).toBeNull();
    expect(s.sound).toEqual({ source: 'preset', preset: null, track: null, volume: 100 });
  });

  test('a video slide keeps an http(s) clip and its caption; anything else is dropped', () => {
    const s = readScreen({
      slides: [
        { id: 'v', kind: 'video', video: { path: 'p', url: 'https://storage.test/v.mp4' }, caption: 'Last year' },
        { id: 'w', kind: 'video', video: { path: 'p', url: 'data:video/mp4;base64,xx' } },
      ],
    });
    expect(s.slides[0].video.url).toBe('https://storage.test/v.mp4');
    expect(s.slides[0].caption).toBe('Last year');
    expect(s.slides[1].video).toBeNull();
    expect(playableSlides(s.slides, null).map((x) => x.id)).toEqual(['v']);
  });

  test('readStudio always carries a complete screen', () => {
    expect(readStudio(null).scene.screen.slides.length).toBeGreaterThan(0);
    expect(readStudio({ scene: { screen: { style: 'neon' } } }).scene.screen.style).toBe('neon');
  });
});

describe('the show’s clock', () => {
  const before = Date.parse('2030-05-30T19:00:00Z');

  test('a countdown, then live, then over', () => {
    expect(countdown(FEED.startsAt, FEED.endsAt, before)).toEqual({ state: 'before', days: 2, hours: 0, minutes: 0, seconds: 0 });
    expect(countdown(FEED.startsAt, FEED.endsAt, Date.parse('2030-06-01T20:00:00Z')).state).toBe('live');
    expect(countdown(FEED.startsAt, FEED.endsAt, Date.parse('2030-06-02T00:00:00Z')).state).toBe('over');
    // No end: five hours.
    expect(countdown(FEED.startsAt, null, Date.parse('2030-06-01T23:30:00Z')).state).toBe('live');
    expect(countdown(null, null, before)).toBeNull();
  });

  test('slides with nothing to show are skipped; nothing left is the title', () => {
    const slides = [
      { id: '1', kind: 'lineup' }, { id: '2', kind: 'sponsors' }, { id: '3', kind: 'photo' },
      { id: '4', kind: 'message', text: '' }, { id: '5', kind: 'countdown' }, { id: '6', kind: 'artist' },
    ];
    expect(playableSlides(slides, null, before)).toEqual([{ id: 'sl-fallback', kind: 'title' }]);
    expect(playableSlides(slides, FEED, before).map((s) => s.kind)).toEqual(['lineup', 'sponsors', 'countdown']);
    // Once the event is over the countdown goes too.
    expect(playableSlides(slides, FEED, Date.parse('2030-07-01T00:00:00Z')).map((s) => s.kind)).toEqual(['lineup', 'sponsors']);
  });

  test('each slide holds its seconds, and the first moments of each are a transition', () => {
    expect(slideAt(3, 8, 0)).toMatchObject({ index: 0, previous: null, mix: 1 });
    expect(slideAt(3, 8, 8000 + TRANSITION_MS / 2)).toMatchObject({ index: 1, previous: 0, mix: 0.5 });
    expect(slideAt(3, 8, 8000 + TRANSITION_MS)).toMatchObject({ index: 1, previous: null });
    expect(slideAt(3, 8, 24000).index).toBe(0);
    // One slide never transitions into itself.
    expect(slideAt(1, 8, 8100).previous).toBeNull();
  });
});

describe('the painter', () => {
  const slides = SLIDE_KINDS.map((k, i) => ({
    id: `s${i}`, kind: k.key, name: 'The Headliner', tagline: 'Live in concert', text: 'Welcome to the gala, everyone',
    sub: '#gala', caption: 'Doors at seven', image: { path: 'p', url: 'https://storage.test/p.jpg' }, focus: { x: 50, y: 40 },
    video: { path: 'v', url: 'https://storage.test/v.mp4' },
  }));

  test('every slide, in every style and transition, paints without an error', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-05-30T19:00:00Z'));
    for (const style of ['bold', 'elegant', 'neon']) {
      for (const transition of ['fade', 'slide', 'cut']) {
        const painter = createScreenPainter({ width: 640 });
        // The show's clock starts when the painter is made, on performance.now().
        const t0 = performance.now();
        expect(painter.canvas.width / painter.canvas.height).toBeCloseTo(16 / 9, 2);
        painter.setContent({ screen: readScreen({ slides, style, transition, seconds: 4 }), feed: FEED, title: FEED.title });
        // Through every slide, through the middle of each transition.
        const seen = new Set();
        for (let t = 0; t < slides.length * 4000 + 1000; t += 400) {
          const r = painter.paint(t0 + t, { level: 0.5, bass: 0.6, bins: new Uint8Array(128).fill(90) });
          seen.add(r.slide.kind);
        }
        expect([...seen].sort()).toEqual(SLIDE_KINDS.map((k) => k.key).sort());
        painter.dispose();
      }
    }
  });

  test('with every image loaded (photos, cover, logos), it still paints every slide', async () => {
    const OriginalImage = window.Image;
    let loaded = 0;
    // jsdom never loads an image; this one "loads" a 3:4 portrait at once.
    window.Image = class {
      constructor() { this.width = 900; this.height = 1200; }
      set src(v) { this.url = v; setTimeout(() => { loaded += 1; this.onload?.(); }, 0); }
    };
    try {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-05-30T19:00:00Z'));
      const assets = vi.fn();
      const painter = createScreenPainter({ width: 640, onAsset: assets });
      const t0 = performance.now();
      const feed = { ...FEED, logoUrl: 'https://storage.test/logo.png', sponsors: [{ name: 'Acme', logoUrl: 'https://storage.test/acme.png' }] };
      // One pass asks for every image (photo, cover, logo, sponsor logo, two gallery photos)…
      painter.setContent({ screen: readScreen({ slides, seconds: 4 }), feed, title: FEED.title });
      for (let t = 0; t < slides.length * 4000; t += 1000) painter.paint(t0 + t, null);
      await vi.waitFor(() => expect(loaded).toBe(6), { timeout: 3000 });
      expect(assets).toHaveBeenCalledTimes(6);
      // …then every style paints with all of them in hand.
      for (const style of ['bold', 'elegant', 'neon']) {
        painter.setContent({ screen: readScreen({ slides, style, seconds: 4 }), feed, title: FEED.title });
        for (let t = 0; t < slides.length * 4000; t += 500) painter.paint(t0 + t, null);
      }
    } finally {
      window.Image = OriginalImage;
    }
  });

  test('a tap goes straight to the next slide', () => {
    const painter = createScreenPainter({ width: 320 });
    painter.setContent({ screen: readScreen({ slides: slides.slice(0, 3), seconds: 10 }), feed: FEED, title: 'x' });
    const start = performance.now();
    const first = painter.paint(start + 100).index;
    painter.skip(start + 100);
    expect(painter.paint(start + 101).index).toBe((first + 1) % 3);
  });

  test('reduced motion still paints, and its colour sample is usable', () => {
    const painter = createScreenPainter({ width: 320 });
    painter.setStill(true);
    painter.setContent({ screen: DEFAULT_SCREEN, feed: null, title: 'Gala' });
    expect(() => painter.paint(5000, null)).not.toThrow();
    const [r, g, b] = painter.sample();
    for (const c of [r, g, b]) expect(c).toBeGreaterThanOrEqual(0);
  });
});

describe('the music', () => {
  /** A kit that only counts what it is asked to play. */
  const recorder = () => {
    const calls = [];
    const kit = new Proxy({}, { get: (_, name) => (...args) => calls.push({ name, t: args.find((a) => typeof a === 'number' && !Number.isInteger(a)) ?? args[1] }) });
    return { kit, calls };
  };

  test('every loop plays four bars without an error, and plays something every bar', () => {
    for (const [key, pattern] of Object.entries(PATTERNS)) {
      const { kit, calls } = recorder();
      const spb = 60 / pattern.bpm / 4;
      for (let step = 0; step < 64; step += 1) pattern.play(step, step * spb, kit, spb);
      expect(calls.length, key).toBeGreaterThan(16);
    }
  });

  test('the arena loop is four on the floor', () => {
    const { kit, calls } = recorder();
    for (let step = 0; step < 16; step += 1) PATTERNS.arena.play(step, step, kit, 0.1);
    expect(calls.filter((c) => c.name === 'kick')).toHaveLength(4);
  });

  test('the music that suits the lighting, the organizer’s track, or none', () => {
    expect(soundFor(readScreen({}), 'gala')).toMatchObject({ kind: 'preset', preset: 'lounge' });
    expect(soundFor(readScreen({}), 'concert')).toMatchObject({ kind: 'preset', preset: 'arena' });
    expect(soundFor(readScreen({ sound: { preset: 'cinematic' } }), 'gala').preset).toBe('cinematic');
    expect(soundFor(readScreen({ sound: { source: 'off' } }), 'gala')).toEqual({ kind: 'off' });
    const track = readScreen({ sound: { source: 'track', track: { path: 'p', url: 'https://storage.test/t.mp3', name: 'Anthem' } } });
    expect(soundFor(track, 'gala')).toMatchObject({ kind: 'track', name: 'Anthem' });
    // "Your track" with none uploaded yet plays Eventsli music.
    expect(soundFor(readScreen({ sound: { source: 'track' } }), 'gala').kind).toBe('preset');
  });

  test('with no music, Showtime still has a beat', () => {
    const a = idleBeat(0);
    const b = idleBeat(0.25);
    expect(a.bass).toBeGreaterThan(b.bass);
    expect(a.level).toBeGreaterThan(0);
  });

  test('a track is sent as one of the two types the server signs', () => {
    expect(audioType('audio/mpeg', 'mp3')).toBe('audio/mpeg');
    expect(audioType('audio/mp3', 'mp3')).toBe('audio/mpeg');
    expect(audioType('audio/x-m4a', 'm4a')).toBe('audio/mp4');
    expect(audioType('', 'm4a')).toBe('audio/mp4');
    expect(audioType('audio/wav', 'wav')).toBeNull();
    expect(audioType('image/png', 'png')).toBeNull();
  });

  test('a video is sent as MP4 or WebM, nothing else', () => {
    expect(videoType('video/mp4', 'mp4')).toBe('video/mp4');
    expect(videoType('', 'webm')).toBe('video/webm');
    expect(videoType('video/quicktime', 'mov')).toBeNull();
    expect(videoType('image/gif', 'gif')).toBeNull();
  });
});

describe('the settings say why a slide will not show', () => {
  test('each empty slide names what it needs', () => {
    expect(emptyReason({ kind: 'lineup' }, { lineup: [] })).toMatch(/schedule/);
    expect(emptyReason({ kind: 'sponsors' }, null)).toMatch(/sponsors/);
    expect(emptyReason({ kind: 'photo' }, FEED)).toMatch(/photo/);
    expect(emptyReason({ kind: 'message', text: '' }, FEED)).toMatch(/words/);
    expect(emptyReason({ kind: 'countdown' }, {})).toMatch(/date/);
    expect(emptyReason({ kind: 'video' }, FEED)).toMatch(/video/);
    expect(emptyReason({ kind: 'gallery' }, {})).toMatch(/gallery/);
    expect(emptyReason({ kind: 'gallery' }, FEED)).toBeNull();
    expect(emptyReason({ kind: 'lineup' }, FEED)).toBeNull();
    expect(emptyReason({ kind: 'title' }, null)).toBeNull();
  });
});
