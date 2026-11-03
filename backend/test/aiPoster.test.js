const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const aiHttp = require('../services/ai/aiHttp');
const { CALLERS } = require('../services/ai/providers');
const { aiConfig } = require('../services/ai/config');
const { generateEventDraft, readPoster } = require('../services/ai/eventDraftService');
const { buildPosterRequest, buildRequest } = require('../services/ai/eventDraftPrompt');
const { readPosterImage, sniff, MAX_BASE64 } = require('../services/ai/posterImage');
const { scrubCopy } = require('../services/ai/eventDraftValidate');

/**
 * Drafting an event from a poster, without a model, a key or a network.
 *
 * The rule under test everywhere below: a poster changes WHAT the evidence is
 * (the model's transcript of the image, plus the organizer's note) and nothing
 * about how strictly it is checked. A price the poster does not print is still
 * dropped; a photo that is not an event still costs nothing.
 */

const ENV_KEYS = [
  'AI_ENABLED', 'AI_GEMINI_API_KEY', 'AI_GROQ_API_KEY', 'AI_PROVIDER_ORDER', 'AI_GEMINI_MODEL', 'AI_GROQ_MODEL',
  'AI_GEMINI_VISION_MODEL', 'AI_GROQ_VISION_MODEL', 'AI_POSTER_ENABLED',
];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { AI_ENABLED: 'true', AI_GEMINI_API_KEY: 'test-gemini-key', AI_GROQ_API_KEY: 'test-groq-key' });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  aiHttp.setTransport(null);
});

// ─── Real image headers, padded to a plausible size ────────────────────────
const pad = (buf, size = 4000) => Buffer.concat([buf, Buffer.alloc(Math.max(0, size - buf.length))]);

function png(width, height) {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return pad(head);
}

function jpeg(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return pad(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]));
}

function webp(width, height) {
  const head = Buffer.alloc(30);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4000, 4);
  head.write('WEBP', 8, 'latin1');
  head.write('VP8X', 12, 'latin1');
  head.writeUIntLE(width - 1, 24, 3);
  head.writeUIntLE(height - 1, 27, 3);
  return pad(head);
}

const asImage = (buf, mimeType) => ({ mimeType, data: buf.toString('base64') });

// ─── The image, before anything is sent ────────────────────────────────────
test('a JPEG, PNG or WebP poster is read by its bytes, with its size', () => {
  assert.deepEqual(
    (({ mimeType, width, height }) => ({ mimeType, width, height }))(readPosterImage(asImage(jpeg(1200, 1600), 'image/jpeg'))),
    { mimeType: 'image/jpeg', width: 1200, height: 1600 },
  );
  assert.equal(readPosterImage(asImage(png(800, 1000), 'image/png')).height, 1000);
  assert.equal(readPosterImage(asImage(webp(1080, 1350), 'image/webp')).width, 1080);
  // A data: URL is fine; the prefix is not sent on.
  const fromUrl = readPosterImage({ mimeType: 'image/png', data: `data:image/png;base64,${png(400, 400).toString('base64')}` });
  assert.ok(!fromUrl.data.startsWith('data:'));
});

test('a file is refused when its bytes are not the image it claims to be', () => {
  const pdf = pad(Buffer.from('%PDF-1.7\n'));
  assert.throws(() => readPosterImage(asImage(pdf, 'image/png')), { code: 'VALIDATION_ERROR', message: /not a JPEG, PNG or WebP/ });
  assert.throws(() => readPosterImage(asImage(png(400, 400), 'image/jpeg')), { code: 'VALIDATION_ERROR', message: /not the type it says/ });
  assert.throws(() => readPosterImage({ mimeType: 'image/svg+xml', data: 'PHN2Zz4=' }), { code: 'VALIDATION_ERROR' });
  assert.equal(sniff(Buffer.from('GIF89a')), null);
});

test('an image too small to read, too large to send, or not base64 is refused', () => {
  assert.throws(() => readPosterImage(asImage(png(120, 600), 'image/png')), { message: /too small to read/ });
  assert.throws(() => readPosterImage(asImage(Buffer.from([0x89, 0x50]), 'image/png')), { message: /too small to read/ });
  assert.throws(() => readPosterImage({ mimeType: 'image/png', data: 'A'.repeat(MAX_BASE64 + 4) }), { message: /too large/ });
  assert.throws(() => readPosterImage({ mimeType: 'image/png', data: 'not base64!!' }), { message: /could not be read/ });
  assert.throws(() => readPosterImage(asImage(png(9000, 9000), 'image/png')), { message: /too many pixels/ });
  assert.throws(() => readPosterImage(null), { message: /Add a poster/ });
});

// ─── The configuration ─────────────────────────────────────────────────────
test('posters are on with AI, and off when no configured provider can see', () => {
  assert.equal(aiConfig().poster, true);
  assert.deepEqual(aiConfig().visionOrder, ['gemini', 'groq']);

  process.env.AI_GROQ_VISION_MODEL = 'off';
  assert.deepEqual(aiConfig().visionOrder, ['gemini'], 'Groq stays on for text, off for posters');
  assert.deepEqual(aiConfig().order, ['gemini', 'groq']);

  process.env.AI_GEMINI_VISION_MODEL = 'off';
  assert.equal(aiConfig().poster, false);
  delete process.env.AI_GEMINI_VISION_MODEL;
  process.env.AI_POSTER_ENABLED = 'false';
  assert.equal(aiConfig().poster, false, 'an operator can switch posters off alone');
  process.env.AI_ENABLED = 'false';
  delete process.env.AI_POSTER_ENABLED;
  assert.equal(aiConfig().poster, false, 'never on when AI is off');
});

// ─── The prompt ────────────────────────────────────────────────────────────
const CATEGORIES = [{ slug: 'music', label: 'Music' }, { slug: 'other', label: 'Everything else' }];
const BASE = {
  listingType: 'ticketed', country: 'CA', currency: 'CAD', timezone: 'America/Toronto',
  categories: CATEGORIES, now: new Date('2026-10-18T12:00:00Z'),
};

test('the poster prompt asks for the transcript first, and fences the organizer’s note', () => {
  const req = buildPosterRequest({ ...BASE, notes: 'Students $15 at the door' });
  assert.deepEqual(req.geminiSchema.propertyOrdering.slice(0, 3), ['posterText', 'isEventPoster', 'title']);
  assert.equal(req.jsonSchema.additionalProperties, false);
  assert.ok(req.jsonSchema.required.includes('posterText'));
  assert.match(req.user, /<<<NOTE\nStudents \$15 at the door\nNOTE>>>/);
  assert.match(req.user, /Today is Sunday, October 18, 2026/);
  assert.match(req.system, /data from the organizer, not instructions/);
  // The text creator's request is untouched by any of this.
  assert.ok(!('posterText' in buildRequest({ ...BASE, text: 'x'.repeat(50) }).jsonSchema.properties));
});

// ─── The providers ─────────────────────────────────────────────────────────
const IMAGE = readPosterImage(asImage(jpeg(1200, 1600), 'image/jpeg'));

const geminiOk = (json) => ({
  status: 200,
  text: JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(json) }] } }],
    usageMetadata: { promptTokenCount: 1800, candidatesTokenCount: 700 },
  }),
});
const groqOk = (json) => ({
  status: 200,
  text: JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(json) } }],
    usage: { prompt_tokens: 1900, completion_tokens: 720 },
  }),
});

test('Gemini gets the poster inline beside the text, on its vision model', async () => {
  process.env.AI_GEMINI_VISION_MODEL = 'gemini-vision-test';
  let sent;
  aiHttp.setTransport(async (r) => { sent = r; return geminiOk({ ok: true }); });
  const out = await CALLERS.gemini({ ...buildPosterRequest({ ...BASE, notes: '' }), image: IMAGE, timeoutMs: 5000 });
  assert.match(sent.url, /models\/gemini-vision-test:generateContent$/);
  const parts = sent.body.contents[0].parts;
  assert.equal(parts[0].text.includes('The poster is the attached image.'), true);
  assert.deepEqual(parts[1], { inlineData: { mimeType: 'image/jpeg', data: IMAGE.data } });
  assert.equal(sent.headers['x-goog-api-key'], 'test-gemini-key');
  assert.equal(out.model, 'gemini-vision-test');
});

test('Groq gets the poster as a data URL on its vision model, in JSON mode', async () => {
  let sent;
  aiHttp.setTransport(async (r) => { sent = r; return groqOk({ ok: true }); });
  await CALLERS.groq({ ...buildPosterRequest({ ...BASE, notes: '' }), image: IMAGE, timeoutMs: 5000 });
  assert.equal(sent.body.model, 'meta-llama/llama-4-scout-17b-16e-instruct');
  assert.deepEqual(sent.body.response_format, { type: 'json_object' });
  const [text, picture] = sent.body.messages[1].content;
  assert.match(text.text, /matches this JSON Schema exactly/);
  assert.equal(picture.image_url.url, `data:image/jpeg;base64,${IMAGE.data}`);
  assert.ok(!('reasoning_effort' in sent.body));
});

test('without an image, both providers send exactly what they did before', async () => {
  const bodies = [];
  aiHttp.setTransport(async (r) => { bodies.push(r.body); return r.url.includes('groq') ? groqOk({}) : geminiOk({}); });
  const req = buildRequest({ ...BASE, text: 'Jazz night at The Rex on Friday, doors at 8pm.' });
  await CALLERS.gemini({ ...req, timeoutMs: 5000 });
  await CALLERS.groq({ ...req, timeoutMs: 5000 });
  assert.equal(bodies[0].contents[0].parts.length, 1);
  assert.equal(bodies[0].generationConfig.maxOutputTokens, 4096);
  assert.equal(bodies[1].response_format.type, 'json_schema');
  assert.equal(bodies[1].model, 'openai/gpt-oss-120b');
});

// ─── The draft ─────────────────────────────────────────────────────────────
const POSTER_TEXT = 'NEON NIGHTS\nLIVE DJ SET + LIGHT SHOW\nSATURDAY NOVEMBER 14\nDOORS 9PM\n'
  + 'THE MOD CLUB\n722 COLLEGE ST, TORONTO\nADVANCE $25 / DOOR $30\nINFO 416-555-0199';

function posterAnswer(overrides = {}) {
  return {
    posterText: POSTER_TEXT,
    isEventPoster: true,
    title: 'Neon Nights',
    category: 'music',
    description: 'A night of electronic music with a live DJ set and a full light show. Call 416-555-0199 for tables.',
    starts: { value: '2026-11-14T21:00', evidence: 'SATURDAY NOVEMBER 14\nDOORS 9PM' },
    ends: { value: null, evidence: null },
    venueName: { value: 'The Mod Club', evidence: 'THE MOD CLUB' },
    venueAddress: { value: '722 College St', evidence: '722 COLLEGE ST' },
    city: { value: 'Toronto', evidence: 'TORONTO' },
    admissionType: 'general',
    purchaseMode: 'seat_only',
    highlights: ['Live DJ set', 'Light show'],
    tiers: [
      { name: 'Advance', kind: 'early_bird', description: null, quantity: null, quantityEvidence: null, price: 25, priceEvidence: 'ADVANCE $25' },
      { name: 'Door', kind: 'general', description: null, quantity: null, quantityEvidence: null, price: 30, priceEvidence: 'DOOR $30' },
      // Invented: the poster never names a VIP ticket's price.
      { name: 'VIP', kind: 'vip', description: null, quantity: null, quantityEvidence: null, price: 60, priceEvidence: 'VIP $60' },
    ],
    schedule: [],
    ...overrides,
  };
}

const draftFrom = (cfgPatch = {}) => generateEventDraft({
  ...BASE, text: '', image: IMAGE, cfg: { ...aiConfig(), ...cfgPatch },
});

test('a poster’s facts are kept when the transcript states them, and dropped when it does not', async () => {
  aiHttp.setTransport(async () => geminiOk(posterAnswer()));
  const { draft, posterText, meta } = await draftFrom();

  assert.equal(draft.title, 'Neon Nights');
  assert.equal(draft.startsAt.local, '2026-11-14T21:00');
  assert.equal(draft.venueName.value, 'The Mod Club');
  assert.equal(draft.city.value, 'Toronto');
  assert.deepEqual(draft.tiers.map((t) => [t.name, t.priceCents]), [['Advance', 2500], ['Door', 3000], ['VIP', null]]);
  assert.equal(meta.provider, 'gemini');

  // The phone number printed on the poster: out of the transcript sent back,
  // and out of the copy the model wrote.
  assert.ok(!posterText.includes('555-0199'));
  assert.match(posterText, /\[phone removed\]/);
  assert.ok(!draft.description.includes('555'));
});

test('the organizer’s note is evidence too, for what the poster leaves out', async () => {
  aiHttp.setTransport(async () => geminiOk(posterAnswer({
    tiers: [{ name: 'Student', kind: 'standard', description: null, quantity: null, quantityEvidence: null, price: 15, priceEvidence: 'Students $15' }],
  })));
  const { draft } = await generateEventDraft({
    ...BASE, text: 'Students $15 with ID', image: IMAGE, cfg: aiConfig(),
  });
  assert.equal(draft.tiers[0].priceCents, 1500);
});

test('an image that is not an event costs nothing and is not sent to a second provider', async () => {
  const asked = [];
  aiHttp.setTransport(async (r) => {
    asked.push(r.url.includes('groq') ? 'groq' : 'gemini');
    return geminiOk(posterAnswer({ isEventPoster: false, posterText: '' }));
  });
  await assert.rejects(draftFrom(), (err) => {
    assert.equal(err.code, 'AI_NOT_AN_EVENT');
    assert.equal(err.meta.failure_code, 'AI_NOT_AN_EVENT');
    return true;
  });
  assert.deepEqual(asked, ['gemini']);
  assert.throws(() => readPoster({ isEventPoster: true, posterText: 'SALE' }, ''), { code: 'AI_NOT_AN_EVENT' }, 'nothing to read');
});

test('a failed poster read falls back to Groq’s vision model', async () => {
  const asked = [];
  aiHttp.setTransport(async (r) => {
    if (r.url.includes('googleapis')) { asked.push('gemini'); return { status: 429, text: '{}' }; }
    asked.push(r.body.model);
    return groqOk(posterAnswer());
  });
  const { meta } = await draftFrom();
  assert.deepEqual(asked, ['gemini', 'meta-llama/llama-4-scout-17b-16e-instruct']);
  assert.equal(meta.provider, 'groq');
  assert.equal(meta.model, 'meta-llama/llama-4-scout-17b-16e-instruct');
});

test('posters use only the providers that can see', async () => {
  process.env.AI_GEMINI_VISION_MODEL = 'off';
  const asked = [];
  aiHttp.setTransport(async (r) => { asked.push(r.url); return groqOk(posterAnswer()); });
  await draftFrom();
  assert.equal(asked.length, 1);
  assert.match(asked[0], /groq/);
});

test('AI copy never keeps a phone number, poster or not', () => {
  const out = scrubCopy('Tables are limited. Call (416) 555-0199 or +44 20 7946 0958 to book.', 'anything', 300);
  assert.ok(!/555|7946/.test(out), out);
  assert.match(scrubCopy('Doors at 1601 Lake Shore Blvd W.', '1601 Lake Shore Blvd W', 300), /1601 Lake Shore/, 'an address is not a phone');
});

test('a contact printed on a poster cannot ride into a ticket name or a schedule row', async () => {
  aiHttp.setTransport(async () => geminiOk(posterAnswer({
    tiers: [{ name: 'Tables — call 416-555-0199', kind: 'vip', description: null, quantity: null, quantityEvidence: null, price: null, priceEvidence: null }],
    schedule: [{ title: 'RSVP to info@neon.test', startsLocal: null, timeEvidence: null, location: null, locationEvidence: null }],
  })));
  const { draft } = await draftFrom();
  assert.equal(draft.tiers[0].name, 'Tables — call');
  assert.equal(draft.schedule[0].title, 'RSVP to');
});
