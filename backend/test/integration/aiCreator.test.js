const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

require('../helpers/testEnv');

// AI on, with fake keys: the transport below answers instead of any provider.
process.env.AI_ENABLED = 'true';
process.env.AI_GEMINI_API_KEY = 'integration-gemini';
process.env.AI_GROQ_API_KEY = 'integration-groq';

const { supabase } = require('../../config/supabase');
const aiHttp = require('../../services/ai/aiHttp');
const app = require('../../app');

/**
 * The Smart Event Creator against the real database.
 *
 * What only this can prove: that two drafts a day is true under concurrency
 * (a row lock, not a JavaScript counter), that a failed generation costs
 * nothing, that a dead reservation stops counting, that nobody but the API can
 * call the quota functions, and that the draft saves as an ordinary private
 * event through the ordinary endpoints — general admission included (I-017).
 */

let server; let baseUrl;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const cleanup = { profiles: [], organizers: [], events: [] };
const ORG_SETUP = {
  legalName: 'AI Test Events Ltd.',
  description: 'Runs the events the AI integration suite creates and deletes.',
  acceptPolicies: true,
};

const TEXT = 'Comedy night at The Rex, 194 Queen St W, Toronto, Friday November 13 from 8pm until 10:30pm. '
  + '300 tickets, general admission $25. Doors 7:30, show at 8.';
const ANSWER = {
  title: 'Comedy Night at The Rex', category: 'comedy', description: 'Stand-up comedy at The Rex.',
  starts: { value: '2026-11-13T20:00', evidence: 'Friday November 13 from 8pm' },
  ends: { value: '2026-11-13T22:30', evidence: 'until 10:30pm' },
  venueName: { value: 'The Rex', evidence: 'at The Rex' },
  venueAddress: { value: '194 Queen St W', evidence: '194 Queen St W' },
  city: { value: 'Toronto', evidence: 'Toronto' },
  admissionType: 'general', purchaseMode: 'seat_only', highlights: ['Stand-up comedy at The Rex'],
  tiers: [{ name: 'General admission', kind: 'general', description: null, quantity: 300, quantityEvidence: '300 tickets', price: 25, priceEvidence: 'general admission $25' }],
  schedule: [{ title: 'Doors', startsLocal: '2026-11-13T19:30', timeEvidence: 'Doors 7:30', location: null, locationEvidence: null }],
};

let mode = 'ok';
aiHttp.setTransport(async ({ url }) => {
  if (mode === 'down') return { status: 503, text: '{}' };
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 400));
  const json = JSON.stringify(ANSWER);
  return url.includes('generativelanguage')
    ? { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: json }] } }] }) }
    : { status: 200, text: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: json } }] }) };
});

function client() {
  let cookie = null;
  return async function call(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

async function signedIn(tag, { role } = {}) {
  const call = client();
  const email = `ai-${tag}-${stamp}@eventsli-test.invalid`;
  const r = await call('POST', '/auth/register', { email, password: PASSWORD, fullName: `AI ${tag}` });
  assert.ok(r.body?.data?.id, `register ${tag}: ${r.status} ${JSON.stringify(r.body)}`);
  cleanup.profiles.push(r.body.data.id);
  await supabase.from('profiles')
    .update({ email_verified_at: new Date().toISOString(), ...(role ? { role } : {}) })
    .eq('id', r.body.data.id);
  await call('POST', '/auth/login', { email, password: PASSWORD });
  return { call, userId: r.body.data.id };
}

async function organizer(tag) {
  const o = await signedIn(tag);
  const res = await o.call('POST', '/organizer', { displayName: `AI ${tag} Co`, ...ORG_SETUP, country: 'CA' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  cleanup.organizers.push(res.body.data.id);
  return { ...o, organizerId: res.body.data.id };
}

const draftBody = (over = {}) => ({
  requestId: randomUUID(), listingType: 'ticketed', country: 'CA', timezone: 'America/Toronto', description: TEXT, ...over,
});

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(async () => {
  aiHttp.setTransport(null);
  for (const id of cleanup.events) await supabase.from('events').delete().eq('id', id);
  for (const id of cleanup.organizers) {
    await supabase.from('ai_generations').delete().eq('organizer_id', id);
    await supabase.from('organizers').delete().eq('id', id);
  }
  for (const id of cleanup.profiles) {
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

test('two drafts a day, then a refusal that says when the next one is', async () => {
  const o = await organizer('daily');
  const quota0 = await o.call('GET', '/ai/quota');
  assert.deepEqual(
    { enabled: quota0.body.data.enabled, remaining: quota0.body.data.remaining, limit: quota0.body.data.limit },
    { enabled: true, remaining: 2, limit: 2 },
  );

  const first = await o.call('POST', '/ai/event-drafts', draftBody());
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const { draft, quota, generationId } = first.body.data;
  assert.ok(generationId);
  assert.equal(quota.remaining, 1);
  assert.equal(draft.startsAt.at, '2026-11-14T01:00:00.000Z', '8 pm EST');
  assert.equal(draft.tiers[0].priceCents, 2500);
  assert.equal(draft.tiers[0].quantity, 300);
  assert.equal(draft.currency, 'CAD', 'currency follows the country, never the model');

  const second = await o.call('POST', '/ai/event-drafts', draftBody());
  assert.equal(second.status, 200);
  assert.equal(second.body.data.quota.remaining, 0);

  const third = await o.call('POST', '/ai/event-drafts', draftBody());
  assert.equal(third.status, 429);
  assert.equal(third.body.error, 'AI_QUOTA_EXHAUSTED');
  const next = new Date(third.body.meta.nextAvailableAt).getTime();
  assert.ok(next > Date.now() + 23 * 3600 * 1000, 'about 24 hours after the first one');

  const rows = await supabase.from('ai_generations').select('status, provider, input_chars').eq('organizer_id', o.organizerId);
  assert.equal(rows.data.filter((r) => r.status === 'succeeded').length, 2);
  assert.ok(rows.data.every((r) => r.provider === 'gemini'));
});

test('two drafts a day holds under concurrency', async () => {
  const o = await organizer('race');
  mode = 'slow';
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => o.call('POST', '/ai/event-drafts', draftBody())));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses.filter((s) => s === 200).length, 2, statuses.join(','));
    assert.ok(results.filter((r) => r.status !== 200).every((r) => r.body.error === 'AI_QUOTA_EXHAUSTED'));
  } finally {
    mode = 'ok';
  }
  const { count } = await supabase.from('ai_generations')
    .select('id', { count: 'exact', head: true }).eq('organizer_id', o.organizerId).eq('status', 'succeeded');
  assert.equal(count, 2);
});

test('a generation every provider failed costs nothing', async () => {
  const o = await organizer('down');
  mode = 'down';
  try {
    const res = await o.call('POST', '/ai/event-drafts', draftBody());
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'AI_UNAVAILABLE');
  } finally {
    mode = 'ok';
  }
  const quota = await o.call('GET', '/ai/quota');
  assert.equal(quota.body.data.remaining, 2);
  const rows = await supabase.from('ai_generations').select('status, attempts, failure_code').eq('organizer_id', o.organizerId);
  assert.equal(rows.data.length, 1);
  assert.equal(rows.data[0].status, 'released');
  assert.equal(rows.data[0].attempts, 2, 'Gemini, then Groq');
  assert.equal(rows.data[0].failure_code, 'AI_UPSTREAM');
});

test('the same request is never charged twice', async () => {
  const o = await organizer('dup');
  const body = draftBody();
  assert.equal((await o.call('POST', '/ai/event-drafts', body)).status, 200);
  const again = await o.call('POST', '/ai/event-drafts', body);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'AI_GENERATION_DUPLICATE');
  assert.equal((await o.call('GET', '/ai/quota')).body.data.remaining, 1);
});

test('a reservation whose worker died stops counting', async () => {
  const o = await organizer('stale');
  await supabase.from('ai_generations').insert([
    { organizer_id: o.organizerId, user_id: o.userId, feature: 'event_creator', request_id: randomUUID(), status: 'reserved', created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
    { organizer_id: o.organizerId, user_id: o.userId, feature: 'seating_designer', request_id: randomUUID(), status: 'succeeded', created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() },
  ]);
  const quota = await o.call('GET', '/ai/quota');
  assert.equal(quota.body.data.remaining, 2, 'a dead reservation and a day-old success both no longer count');

  // A success under 24 hours old counts, whichever AI feature spent it (D-002).
  await supabase.from('ai_generations').insert({
    organizer_id: o.organizerId, user_id: o.userId, feature: 'seating_designer', request_id: randomUUID(), status: 'succeeded',
  });
  assert.equal((await o.call('GET', '/ai/quota')).body.data.remaining, 1);
});

test('refusals before any provider call cost nothing', async () => {
  const o = await organizer('refuse');
  const short = await o.call('POST', '/ai/event-drafts', draftBody({ description: 'Gala on Saturday' }));
  assert.equal(short.status, 400);
  const market = await o.call('POST', '/ai/event-drafts', draftBody({ country: 'FR' }));
  assert.equal(market.status, 400);
  const zone = await o.call('POST', '/ai/event-drafts', draftBody({ timezone: 'Toronto' }));
  assert.equal(zone.status, 400);
  const { count } = await supabase.from('ai_generations')
    .select('id', { count: 'exact', head: true }).eq('organizer_id', o.organizerId);
  assert.equal(count, 0);
});

test('only an organizer can draft: an admin is refused, an attendee too', async () => {
  const adminUser = await signedIn('admin', { role: 'admin' });
  const a = await adminUser.call('POST', '/ai/event-drafts', draftBody());
  assert.equal(a.status, 403);
  assert.equal(a.body.error, 'AI_ORGANIZER_ONLY');
  assert.equal((await adminUser.call('GET', '/ai/quota')).body.data.enabled, false);

  const attendee = await signedIn('attendee');
  assert.equal((await attendee.call('POST', '/ai/event-drafts', draftBody())).status, 403);
  assert.equal((await client()('GET', '/ai/quota')).status, 401);
});

test('switched off, AI says so and spends nothing', async () => {
  const o = await organizer('off');
  process.env.AI_ENABLED = 'false';
  try {
    assert.equal((await o.call('GET', '/ai/quota')).body.data.enabled, false);
    const res = await o.call('POST', '/ai/event-drafts', draftBody());
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'AI_DISABLED');
  } finally {
    process.env.AI_ENABLED = 'true';
  }
});

test('the draft saves as an ordinary private draft, general admission kept (I-017), linked to its generation', async () => {
  const o = await organizer('save');
  const gen = await o.call('POST', '/ai/event-drafts', draftBody());
  const { draft, generationId } = gen.body.data;

  const created = await o.call('POST', '/events', {
    title: draft.title, category: 'other', country: 'CA', timezone: 'America/Toronto',
    startsAt: draft.startsAt.at, endsAt: draft.endsAt.at, listingType: 'ticketed',
    admissionType: draft.admissionType, venueName: draft.venueName.value,
    venueAddress: draft.venueAddress.value, city: draft.city.value, description: draft.description,
    aiGenerationId: generationId,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  cleanup.events.push(created.body.data.id);
  assert.equal(created.body.data.status, 'draft', 'never published, never submitted');
  assert.equal(created.body.data.admissionType, 'general', 'I-017: general admission survives creation');

  const tier = await o.call('POST', `/events/${created.body.data.id}/tiers`, {
    name: draft.tiers[0].name, priceCents: draft.tiers[0].priceCents, quantity: draft.tiers[0].quantity, kind: 'general',
  });
  assert.equal(tier.status, 201, JSON.stringify(tier.body));

  const link = await supabase.from('ai_generations').select('event_id').eq('id', generationId).single();
  assert.equal(link.data.event_id, created.body.data.id);

  // Somebody else's generation id links nothing.
  const other = await organizer('other');
  const stolen = await other.call('POST', '/events', {
    title: 'Not mine', country: 'CA', timezone: 'America/Toronto',
    startsAt: draft.startsAt.at, endsAt: draft.endsAt.at, aiGenerationId: generationId,
  });
  assert.equal(stolen.status, 201);
  cleanup.events.push(stolen.body.data.id);
  const still = await supabase.from('ai_generations').select('event_id').eq('id', generationId).single();
  assert.equal(still.data.event_id, created.body.data.id);
});

test('an event description is bounded on create and edit (I-018)', async () => {
  const o = await organizer('desc');
  const long = 'x'.repeat(5001);
  const res = await o.call('POST', '/events', {
    title: 'Too long', country: 'CA', timezone: 'America/Toronto',
    startsAt: '2026-12-01T20:00:00Z', endsAt: '2026-12-01T22:00:00Z', description: long,
  });
  assert.equal(res.status, 400);
  const ok = await o.call('POST', '/events', {
    title: 'Fine', country: 'CA', timezone: 'America/Toronto',
    startsAt: '2026-12-01T20:00:00Z', endsAt: '2026-12-01T22:00:00Z', description: 'x'.repeat(5000),
  });
  assert.equal(ok.status, 201);
  cleanup.events.push(ok.body.data.id);
  const patch = await o.call('PATCH', `/events/${ok.body.data.id}`, { description: long });
  assert.equal(patch.status, 400);
});

test('the browser’s public key can neither read the usage nor call the quota functions', { skip: !process.env.SUPABASE_ANON_KEY && 'SUPABASE_ANON_KEY is not set' }, async () => {
  const ANON = process.env.SUPABASE_ANON_KEY;
  const rest = (path, init = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1${path}`, {
    ...init, headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
  });
  const read = await rest('/ai_generations?select=*&limit=1');
  assert.ok([401, 403, 404].includes(read.status), `ai_generations: ${read.status}`);
  for (const fn of ['ai_reserve_generation', 'ai_finish_generation', 'ai_generation_status']) {
    const res = await rest(`/rpc/${fn}`, { method: 'POST', body: '{}' });
    assert.ok([401, 403, 404].includes(res.status), `${fn}: ${res.status}`);
  }
});
