const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// A unit test: no database and no environment. Both modules below require
// config/supabase, which throws at load without credentials (CI's unit job
// has none), so it and mediaService are stubbed the way venueStudio.test.js
// stubs them. The URL stub keeps the property tested here: a URL is derived
// from a path, never taken from the client.
const stub = (rel, exports) => {
  const file = require.resolve(path.join(__dirname, '..', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('services/mediaService', { publicUrl: (p) => `https://storage.test/object/public/media/${p}` });
stub('config/supabase', { supabase: {} });

const { sanitizeLayout, cleanScreen, ownPath, MAX_SLIDES } = require('../services/venueStudio');
const { shapeFeed } = require('../services/screenFeed');

/**
 * THE STAGE SCREEN (2026-11-25): `scene.screen` in the layout blob, read on
 * the buyer's public seat page. What matters: a photo or a soundtrack URL on
 * that page is always one derived from a file this event's upload step
 * signed, an image path is never an audio file and the reverse, and every
 * other value is a known word, a number in range or short text.
 */
const EVENT = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const shot = (ext = 'jpg') => `events/${EVENT}/screen-0123456789abcdef.${ext}`;
const song = (ext = 'mp3') => `events/${EVENT}/soundtrack-0123456789abcdef.${ext}`;

test('a slide photo keeps its path and gets a derived URL; a client URL is ignored', () => {
  const out = cleanScreen(EVENT, {
    slides: [{ id: 'a', kind: 'artist', name: 'Nova', image: { path: shot(), url: 'https://evil.test/x.jpg' } }],
  });
  assert.equal(out.slides[0].image.path, shot());
  assert.ok(out.slides[0].image.url.endsWith(shot()));
  assert.ok(!out.slides[0].image.url.includes('evil'));
});

test('a photo from another event, another kind or an audio file is dropped', () => {
  const out = cleanScreen(EVENT, {
    slides: [
      { id: 'a', kind: 'photo', image: { path: `events/${OTHER}/screen-0123456789abcdef.jpg` } },
      { id: 'b', kind: 'photo', image: { path: `events/${EVENT}/panorama-0123456789abcdef.jpg` } },
      { id: 'c', kind: 'photo', image: { path: shot('mp3') } },
      { id: 'd', kind: 'photo', image: { path: `events/${EVENT}/../${OTHER}/screen-0123456789abcdef.jpg` } },
    ],
  });
  assert.deepEqual(out.slides.map((s) => s.image), [null, null, null, null]);
});

test('the soundtrack must be an mp3 or m4a soundtrack upload of this event', () => {
  const ok = cleanScreen(EVENT, { sound: { source: 'track', track: { path: song('m4a'), name: 'Anthem' } } });
  assert.equal(ok.sound.track.path, song('m4a'));
  assert.equal(ok.sound.track.name, 'Anthem');
  assert.ok(ok.sound.track.url.endsWith(song('m4a')));
  for (const bad of [shot('jpg'), song('wav'), `events/${OTHER}/soundtrack-0123456789abcdef.mp3`, 'https://cdn.test/a.mp3']) {
    assert.equal(cleanScreen(EVENT, { sound: { source: 'track', track: { path: bad } } }).sound.track, null, bad);
  }
});

test('a video slide keeps only this event\'s clip-….mp4|webm, its URL derived', () => {
  const clip = (ext) => `events/${EVENT}/clip-0123456789abcdef.${ext}`;
  const ok = cleanScreen(EVENT, { slides: [{ id: 'v', kind: 'video', video: { path: clip('mp4'), url: 'https://evil.test/v.mp4' }, caption: 'Hi' }] });
  assert.equal(ok.slides[0].video.path, clip('mp4'));
  assert.ok(ok.slides[0].video.url.endsWith(clip('mp4')));
  assert.equal(ok.slides[0].caption, 'Hi');
  for (const bad of [clip('mov'), shot('jpg'), song('mp3'), `events/${OTHER}/clip-0123456789abcdef.mp4`]) {
    assert.equal(cleanScreen(EVENT, { slides: [{ id: 'v', kind: 'video', video: { path: bad } }] }).slides[0].video, null, bad);
  }
  assert.ok(ownPath(EVENT, clip('webm'), ['clip']));
  assert.ok(!ownPath(EVENT, clip('webm'), ['screen']));
});

test('the gallery in the feed is images only', () => {
  const feed = shapeFeed({ id: EVENT, title: 'x' }, [], [], [
    { kind: 'image', url: 'https://storage.test/a.jpg', caption: 'A' }, { kind: 'video', url: 'https://youtube.test/v' }, { kind: 'image', url: null },
  ]);
  assert.deepEqual(feed.gallery, [{ url: 'https://storage.test/a.jpg', caption: 'A' }]);
});

test('ownPath keeps each kind to its own extensions', () => {
  assert.ok(ownPath(EVENT, song('mp3'), ['soundtrack']));
  assert.ok(!ownPath(EVENT, song('mp3'), ['screen']));
  assert.ok(!ownPath(EVENT, shot('jpg'), ['soundtrack']));
  assert.ok(ownPath(EVENT, shot('webp'), ['venue', 'panorama', 'screen', 'soundtrack']));
  assert.ok(!ownPath(EVENT, `events/${EVENT}/panorama-0123456789abcdef.mp3`, ['venue', 'panorama', 'screen', 'soundtrack']));
});

test('unknown words become defaults; numbers are clamped; slides are capped and unique', () => {
  const slides = [
    { id: 'x', kind: 'title' }, { id: 'x', kind: 'countdown' }, { kind: 'title' }, { id: 'y', kind: 'laser' },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, kind: 'message', text: 'w'.repeat(300) })),
  ];
  const out = cleanScreen(EVENT, {
    slides, seconds: 0, size: 900, style: '<script>', transition: 'warp', accent: 'url(x)',
    sound: { source: 'stream', preset: 'dubstep', volume: -3 }, pixels: 'no', react: false,
  });
  assert.equal(out.slides.length, MAX_SLIDES);
  assert.deepEqual(out.slides[0], { id: 'x', kind: 'title' });
  assert.equal(out.slides[1].text.length, 80);
  assert.equal(out.seconds, 4);
  assert.equal(out.size, 150);
  assert.equal(out.style, 'bold');
  assert.equal(out.transition, 'fade');
  assert.equal(out.accent, null);
  assert.deepEqual(out.sound, { source: 'preset', preset: null, track: null, volume: 0 });
  assert.equal(out.pixels, true);
  assert.equal(out.react, false);
});

test('the screen rides the map save inside scene, and a layout without one is untouched', () => {
  const out = sanitizeLayout(EVENT, { scene: { mood: 'gala', screen: { style: 'elegant', slides: [{ id: 's', kind: 'visualizer' }] } } });
  assert.equal(out.scene.screen.style, 'elegant');
  assert.equal(out.scene.screen.slides[0].kind, 'visualizer');
  const bare = sanitizeLayout(EVENT, { scene: { mood: 'gala' } });
  assert.equal('screen' in bare.scene, false);
});

test('the feed is what the event page already shows, cut to size', () => {
  const event = {
    id: EVENT, title: 'Gala', starts_at: '2030-06-01T19:00:00Z', ends_at: null, timezone: 'America/Toronto',
    venue_name: 'Hall', cover_url: 'https://storage.test/c.jpg', logo_url: null, password_hash: 'secret',
  };
  const feed = shapeFeed(
    event,
    [{ title: 'Doors', starts_at: '2030-06-01T18:00:00Z', ends_at: null, location: null }, { title: '' }, ...Array.from({ length: 20 }, () => ({ title: 'Act' }))],
    [{ name: 'Acme', logo_url: 'https://storage.test/a.png', level: 'gold' }, { name: null }],
  );
  assert.deepEqual(Object.keys(feed).sort(), ['coverUrl', 'endsAt', 'gallery', 'lineup', 'logoUrl', 'sponsors', 'startsAt', 'timezone', 'title', 'venueName']);
  assert.equal(feed.lineup.length, 12);
  assert.equal(feed.lineup[0].title, 'Doors');
  assert.deepEqual(feed.sponsors, [{ name: 'Acme', logoUrl: 'https://storage.test/a.png', level: 'gold' }]);
  assert.ok(!JSON.stringify(feed).includes('secret'));
});

test('a video slide keeps its sound switch: on unless turned off', () => {
  const out = cleanScreen(EVENT, { slides: [{ id: 'a', kind: 'video' }, { id: 'b', kind: 'video', sound: false }, { id: 'c', kind: 'video', sound: 'no' }] });
  assert.deepEqual(out.slides.map((x) => x.sound), [true, false, true]);
});
