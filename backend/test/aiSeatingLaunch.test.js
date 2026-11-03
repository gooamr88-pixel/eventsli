const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const aiHttp = require('../services/ai/aiHttp');
const { aiConfig } = require('../services/ai/config');
const {
  validatePlan, generateSeatingPlan, buildSeatingRequest, planSchema,
} = require('../services/ai/seatingDesigner');
const {
  validateKit, buildKitRequest, scrubPost, channelUrl, namesForeignDate,
} = require('../services/ai/launchKit');
const { toStrictJsonSchema } = require('../services/ai/schema');

/**
 * The Seating Designer and the launch kit, without a model, a key or a network.
 * The rules under test: the model never places a table, never sets a price,
 * never names a ticket type the event does not have, and never puts a price,
 * a date or a link in a post that the event does not have.
 */

const ENV_KEYS = ['AI_ENABLED', 'AI_GEMINI_API_KEY', 'AI_GROQ_API_KEY', 'AI_PROVIDER_ORDER'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.AI_PROVIDER_ORDER;
  Object.assign(process.env, { AI_ENABLED: 'true', AI_GEMINI_API_KEY: 'k1', AI_GROQ_API_KEY: 'k2' });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  aiHttp.setTransport(null);
});

const geminiOk = (json) => ({
  status: 200,
  text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(json) }] } }] }),
});

// ─── Seating Designer ──────────────────────────────────────────────────────
const CTX = { ticketTypes: ['VIP Table', 'General'], tableCategories: ['Family'] };

test('the plan schema has no coordinates and no money, so no model can return either', () => {
  const props = JSON.stringify(toStrictJsonSchema(planSchema()));
  assert.ok(!/"(x|y|position_x|price|priceCents|cost)"/.test(props), props);
});

test('a plan keeps what the map can draw and the event really has', () => {
  const plan = validatePlan({
    isSeatingRequest: true,
    sections: [
      { name: 'VIP', tableCount: 6, seatsPerTable: 10, shape: 'round', area: 'front', ticketType: 'vip table', tableCategory: null },
      { name: 'Guests', tableCount: 24, seatsPerTable: 80, shape: 'hexagon', area: 'nowhere', ticketType: 'Platinum', tableCategory: 'family' },
    ],
    zones: [
      { kind: 'stage', label: null, position: 'front' },
      { kind: 'stage', label: 'Second stage', position: 'back' },
      { kind: 'helipad', label: null, position: 'left' },
      { kind: 'dance_floor', label: null, position: 'middle-ish' },
    ],
    summary: 'Six VIP tables at the front and 24 guest tables behind.',
  }, CTX);

  assert.deepEqual(plan.sections[0], {
    name: 'VIP', tableCount: 6, seatsPerTable: 10, shape: 'round', area: 'front', ticketType: 'VIP Table', tableCategory: null,
  }, 'the ticket type is matched and returned as the organizer spelled it');
  assert.deepEqual(plan.sections[1], {
    name: 'Guests', tableCount: 24, seatsPerTable: 60, shape: 'round', area: 'anywhere', ticketType: null, tableCategory: 'Family',
  }, 'seats capped at 60, unknown shape and area made safe, invented ticket type dropped');
  assert.deepEqual(plan.zones.map((z) => [z.kind, z.position]), [['stage', 'front'], ['dance_floor', 'center']]);
});

test('a plan never asks for more than the 400 tables a map holds', () => {
  const plan = validatePlan({
    isSeatingRequest: true,
    sections: [
      { name: 'A', tableCount: 350, seatsPerTable: 10, shape: 'round', area: 'front', ticketType: null, tableCategory: null },
      { name: 'B', tableCount: 350, seatsPerTable: 10, shape: 'round', area: 'back', ticketType: null, tableCategory: null },
      { name: 'C', tableCount: 10, seatsPerTable: 10, shape: 'round', area: 'back', ticketType: null, tableCategory: null },
    ],
    zones: [],
    summary: '',
  }, CTX);
  assert.deepEqual(plan.sections.map((s) => s.tableCount), [350, 50]);
});

test('no tables is not a plan, and text that is not about a room is a final answer', async () => {
  assert.throws(() => validatePlan({ isSeatingRequest: true, sections: [], zones: [], summary: '' }), { code: 'AI_OUTPUT_INVALID' });
  const asked = [];
  aiHttp.setTransport(async (r) => { asked.push(r.url); return geminiOk({ isSeatingRequest: false, sections: [], zones: [], summary: '' }); });
  await assert.rejects(
    generateSeatingPlan({ description: 'Write me a poem about cats please', eventTitle: 'Gala', ticketTypes: [], tableCategories: [], cfg: aiConfig() }),
    { code: 'AI_NOT_A_ROOM' },
  );
  assert.equal(asked.length, 1, 'not sent on to the fallback');
});

test('the seating prompt lists the event’s own ticket types and fences the description', () => {
  const req = buildSeatingRequest({ description: '200 guests, tables of 10', eventTitle: 'Spring Gala', ...CTX, hasStage: true });
  assert.match(req.user, /Ticket types: VIP Table; General\./);
  assert.match(req.user, /The room already has a stage\./);
  assert.match(req.user, /<<<ROOM\n200 guests, tables of 10\nROOM>>>/);
  assert.match(req.system, /never give coordinates/);
});

// ─── Launch kit ────────────────────────────────────────────────────────────
const FACTS = {
  title: 'Neon Nights',
  when: 'Saturday, November 14, 2026, 9:00 PM to 2:00 AM EST',
  where: 'The Mod Club, 722 College St, Toronto',
  prices: 'Advance $25 CAD; Door $30 CAD',
  highlights: ['Live DJ set', 'Light show'],
  category: 'Nightlife',
  organizer: 'Neon Collective',
  description: 'A night of electronic music.',
};
const URL_ = 'https://eventsli.com/e/neon-nights';

function answer(over = {}) {
  return {
    instagram: 'Toronto, are you ready? 🔊\nNeon Nights lands Saturday, November 14.\nTickets from $25. Link in bio.',
    facebook: 'Neon Nights is back with a live DJ set and a full light show. VIP tables just $15! Get yours: [LINK]',
    whatsapp: 'Coming to Neon Nights on Saturday? It is on Friday, December 4 too. [LINK]',
    emailSubject: 'You are invited: Neon Nights',
    emailBody: 'Join us on Saturday, November 14. Questions? Call 416-555-0199 or write hello@neon.test.\nTickets: [LINK]',
    x: 'Neon Nights, Nov 14 at The Mod Club. Tickets from $25 →',
    hashtags: ['#NeonNights', 'Toronto Nightlife', '#!!', 'TorontoEvents'],
    taglines: ['One night. All neon.'],
    ...over,
  };
}

test('every post gets the real link, tagged for its channel, and Instagram gets none', () => {
  const kit = validateKit(answer(), { facts: FACTS, url: URL_ });
  assert.match(kit.facebook, /https:\/\/eventsli\.com\/e\/neon-nights\?utm_source=facebook&utm_medium=social&utm_campaign=launch-kit/);
  assert.match(kit.x, /utm_source=x/, 'a post that forgot [LINK] gets it appended');
  assert.match(kit.email.body, /utm_source=email&utm_medium=email/);
  assert.ok(!/https?:/.test(kit.instagram));
  assert.equal(kit.links.whatsapp, channelUrl(URL_, 'whatsapp'));
});

test('a price, a date or a contact the event does not have is cut from the posts', () => {
  const kit = validateKit(answer(), { facts: FACTS, url: URL_ });
  assert.ok(!kit.facebook.includes('$15'), 'an invented price goes, with its sentence');
  assert.match(kit.facebook, /live DJ set/);
  assert.ok(!/December|Friday/.test(kit.whatsapp), 'a date the event is not on goes');
  assert.match(kit.whatsapp, /Saturday\?/);
  assert.ok(!/555|hello@/.test(kit.email.body), 'contacts go');
  assert.match(kit.instagram, /Tickets from \$25\./, 'a real price stays');
  assert.match(kit.instagram, /\n/, 'line breaks survive');
});

test('hashtags are cleaned, and a kit with no usable posts is not a kit', () => {
  const kit = validateKit(answer(), { facts: FACTS, url: URL_ });
  assert.deepEqual(kit.hashtags, ['#NeonNights', '#TorontoNightlife', '#TorontoEvents']);
  assert.throws(() => validateKit(answer({ instagram: '', facebook: '', whatsapp: '' }), { facts: FACTS, url: URL_ }), { code: 'AI_OUTPUT_INVALID' });
});

test('"may" the verb is not a month', () => {
  assert.equal(namesForeignDate('You may bring a friend.', FACTS.when), false);
  assert.equal(namesForeignDate('See you May 3!', FACTS.when), true);
  assert.equal(namesForeignDate('See you in November.', FACTS.when), false);
  assert.equal(scrubPost('Doors at 9. Bring $10 for the coat check.', 'Doors at 9', 100), 'Doors at 9.');
});

test('the kit prompt carries the facts and the tone, fenced', () => {
  const req = buildKitRequest(FACTS, { tone: 'elegant', note: 'Mention the dress code' });
  assert.match(req.user, /^Tone: elegant\./);
  assert.match(req.user, /<<<FACTS\nTitle: Neon Nights\n/);
  assert.match(req.user, /<<<NOTE\nMention the dress code\nNOTE>>>/);
  assert.match(req.system, /Do not write any URL yourself/);
});
