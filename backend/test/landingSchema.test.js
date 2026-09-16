const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Pure modules only. `landingSchema` imports nothing, and `normalisePath` is
// exported from the controller for exactly this reason — the controller itself
// requires config/supabase, which throws at module load without credentials, so
// the whole file is loaded here only because that require happens to be lazy
// enough. It is not: see the note by the require below.
const {
  CONTENT_KEYS, defaultsFor, allDefaults, describe: describeBlocks, validateContent,
} = require('../utils/landingSchema');

const PREFIX = 'https://example.supabase.co/storage/v1/object/public/site-media';

// ── The shape of a block ────────────────────────────────────────────────────

test('every key has defaults, and the defaults are a complete object', () => {
  for (const key of CONTENT_KEYS) {
    const defaults = defaultsFor(key);
    assert.ok(defaults, `${key} has no defaults`);
    assert.equal(typeof defaults, 'object');
  }
  assert.deepEqual(Object.keys(allDefaults()).sort(), [...CONTENT_KEYS].sort());
});

test('a required field falls back to its default rather than failing the save', () => {
  // The page must always have a headline. An operator who clears the field gets
  // the shipped copy back; they do not get a form that refuses to submit.
  const result = validateContent('hero', { title: '' }, { mediaPrefix: PREFIX });
  assert.equal(result.ok, true);
  assert.equal(result.value.title, defaultsFor('hero').title);
});

test('an unknown field is refused, not silently stored', () => {
  // The failure this prevents: `{"titel": "..."}` saving cleanly, rendering
  // nothing, and the operator concluding the CMS is broken.
  const result = validateContent('hero', { titel: 'typo' }, { mediaPrefix: PREFIX });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Not a field of Hero: titel/);
});

test('an unknown block is refused', () => {
  const result = validateContent('not_a_block', {}, { mediaPrefix: PREFIX });
  assert.equal(result.ok, false);
});

test('the saved value is COMPLETE, so no reader has to merge defaults itself', () => {
  const result = validateContent('sections', { featuredTitle: 'On this week' }, { mediaPrefix: PREFIX });
  assert.equal(result.ok, true);
  // Every other field of the block is present, at its default.
  assert.equal(result.value.sponsorsTitle, defaultsFor('sections').sponsorsTitle);
  assert.equal(result.value.featuredTitle, 'On this week');
});

// ── Links ───────────────────────────────────────────────────────────────────

test('a call-to-action cannot be pointed off Eventsli', () => {
  // A CMS field that accepts `https://` is a field through which the homepage's
  // primary button becomes somebody else's landing page.
  for (const href of [
    'https://evil.example',
    'http://evil.example',
    '//evil.example',                 // protocol-relative: starts with a slash
    'javascript:alert(1)',            // eslint-disable-line no-script-url
    '/events" onclick="x',
  ]) {
    const result = validateContent('hero', { primaryCtaHref: href }, { mediaPrefix: PREFIX });
    assert.equal(result.ok, false, `${href} was accepted`);
  }
});

test('an internal path and an anchor are accepted', () => {
  for (const href of ['/events', '/events?category=music', '#organizers']) {
    const result = validateContent('hero', { primaryCtaHref: href }, { mediaPrefix: PREFIX });
    assert.equal(result.ok, true, `${href} was refused`);
    assert.equal(result.value.primaryCtaHref, href);
  }
});

// ── Images ──────────────────────────────────────────────────────────────────

test('an image must live in our own bucket', () => {
  // Not a style rule. `next/image`'s remotePatterns admits the storage host and
  // nothing else, so a URL from anywhere else renders as nothing at the top of
  // the homepage with the only evidence in somebody else's console.
  const result = validateContent('hero', {
    imageUrl: 'https://images.unsplash.com/photo.jpg',
    imagePath: 'hero/x.jpg',
  }, { mediaPrefix: PREFIX });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /uploaded to Eventsli/);
});

test('an image and its object key must move together', () => {
  const orphanUrl = validateContent('hero', { imageUrl: `${PREFIX}/hero/a.png` }, { mediaPrefix: PREFIX });
  assert.equal(orphanUrl.ok, false, 'a URL with no object key was accepted');

  const both = validateContent('hero', {
    imageUrl: `${PREFIX}/hero/a.png`,
    imagePath: 'hero/a.png',
  }, { mediaPrefix: PREFIX });
  assert.equal(both.ok, true);
});

// ── Video ───────────────────────────────────────────────────────────────────

test('the video accepts the hosts the CSP admits, and refuses the rest', () => {
  const ok = [
    'https://www.youtube.com/watch?v=abc123',
    'https://youtu.be/abc123',
    'https://vimeo.com/123456',
    `${PREFIX}/video/film.mp4`,
    'https://cdn.example.com/film.webm',
  ];
  for (const url of ok) {
    const result = validateContent('video', { url }, { mediaPrefix: PREFIX });
    assert.equal(result.ok, true, `${url} was refused`);
  }

  for (const url of ['http://www.youtube.com/watch?v=a', 'https://tiktok.com/x', 'not a url']) {
    const result = validateContent('video', { url }, { mediaPrefix: PREFIX });
    assert.equal(result.ok, false, `${url} was accepted`);
  }
});

// ── The statistics block cannot carry a number ──────────────────────────────

test('NO FIELD ANYWHERE ACCEPTS A STATISTIC', () => {
  /**
   * The load-bearing test of this file.
   *
   * The brief the storefront was built to said "no fake hardcoded statistics",
   * and the design it came with showed "10K+ Events Created · 2M+ Happy
   * Guests". The protection against that is not a code review — it is that
   * there is nowhere to type one. Every figure is counted in `statsService`.
   *
   * If somebody later adds a `value` or `count` field to the stats block, this
   * fails, and the failure says why.
   */
  const stats = describeBlocks().find((b) => b.key === 'stats');
  assert.ok(stats, 'the stats block is gone');

  for (const field of stats.fields) {
    assert.ok(
      field.type === 'bool' || field.type === 'text',
      `stats.${field.name} is a ${field.type}; the strip may only carry labels and switches`,
    );
    assert.ok(
      !/count|value|total|number/i.test(field.name),
      `stats.${field.name} looks like a place to type a figure`,
    );
  }
});

test('the admin console renders from the schema, so internal fields never reach it', () => {
  const hero = describeBlocks().find((b) => b.key === 'hero');
  const names = hero.fields.map((f) => f.name);
  // The storage object keys travel with an image and are set by the upload, not
  // typed. A form offering them is a form where the two can disagree.
  assert.ok(!names.includes('imagePath'));
  assert.ok(names.includes('imageUrl'));
});

// ── The migration and the schema agree about the blocks ─────────────────────

test('site_content keys fit the shape the table enforces', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260916100000_storefront_cms.sql'),
    'utf8',
  );
  // The table's CHECK. A key the schema allows and the table refuses is a save
  // that fails with a constraint name instead of a sentence.
  assert.match(sql, /site_content_key_shape CHECK \(key ~ '\^\[a-z\]\[a-z0-9_\]\{1,38\}\$'\)/);
  for (const key of CONTENT_KEYS) {
    assert.match(key, /^[a-z][a-z0-9_]{1,38}$/, `${key} would be refused by the table`);
  }
});
