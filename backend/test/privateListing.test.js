const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Private events on the listings, blurred (owner, 2026-11-23): "the point of
 * the blurry image is to list it on the main events page, but nobody can see
 * the details — only the organizer name, the date and the event name".
 *
 *   · `?withPrivate=true` lists private events whose organizer chose the
 *     blurred page; without it, or under a filter that could match a hidden
 *     detail (city, category, price, search, saved slugs), they stay out;
 *   · a listed private event carries its name, organizer and date only — no
 *     venue, city, price, category or cover URL — and its prices and seats
 *     are never even looked up.
 *
 * No database: Supabase is stubbed and records the filters it was given.
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

let rows = [];
let calls = [];
let rpcIds = [];
function from(table) {
  const chain = {};
  for (const m of ['select', 'eq', 'or', 'gte', 'lte', 'in', 'order', 'not', 'is', 'neq', 'limit']) {
    chain[m] = (...args) => { calls.push({ table, m, args }); return chain; };
  }
  chain.range = () => Promise.resolve({ data: table === 'events' ? rows : [], error: null, count: rows.length });
  // A price filter finds one cheap ticket type, so the listing goes on to build
  // its events query (the filters are applied when the query is built).
  chain.then = (ok, bad) => Promise.resolve({ data: table === 'ticket_tiers' ? [{ event_id: 'open-1' }] : [], error: null }).then(ok, bad);
  return chain;
}
stub('config/supabase.js', {
  supabase: {
    from,
    rpc: (name, args) => { rpcIds = args?.p_event_ids || []; return Promise.resolve({ data: [], error: null }); },
  },
});
stub('services/categoryService.js', { list: async () => [], assertKnownSlug: () => true });

const discovery = require('../controllers/discoveryController');

const open = {
  id: 'open-1', slug: 'jazz-night', title: 'Jazz Night', city: 'Toronto', venue_name: 'The Hall',
  venue_address: '1 King St', country: 'CA', timezone: 'America/Toronto', currency: 'CAD',
  starts_at: '2026-12-20T01:00:00Z', ends_at: '2026-12-20T04:00:00Z',
  listing_type: 'ticketed', admission_type: 'general', cover_url: 'https://cdn/jazz.jpg',
  is_private: false, coming_soon: false, organizers: { display_name: 'Jazz Co' },
};
const secret = {
  id: 'priv-1', slug: 'sara-and-omar', title: 'Sara & Omar’s Wedding', city: 'Mississauga',
  venue_name: 'Secret Garden', venue_address: '9 Hidden Rd', description: 'The details', category: 'wedding',
  country: 'CA', timezone: 'America/Toronto', currency: 'CAD',
  starts_at: '2026-12-27T22:00:00Z', ends_at: '2026-12-28T04:00:00Z',
  listing_type: 'ticketed', admission_type: 'reserved', cover_url: 'https://cdn/wedding.jpg',
  is_private: true, locked_preview: 'blur', locked_reveal: ['title', 'organizer'],
  organizers: [{ display_name: 'Golden Events' }],
};

async function list(query) {
  calls = []; rpcIds = [];
  let body = null;
  const res = { status() { return this; }, json(b) { body = b; return this; }, set() { return this; } };
  await discovery.listEvents({ query, headers: {} }, res, (err) => { throw err; });
  return body;
}
const privacyFilter = () => calls.find((c) => c.table === 'events'
  && ((c.m === 'eq' && c.args[0] === 'is_private') || (c.m === 'or' && String(c.args[0]).includes('is_private'))));

test('the homepage and /events ask for every private event — blurred or password box — and get them', async () => {
  // 2026-11-24 (owner): "also with the password only, make it appear".
  const boxed = { ...secret, id: 'priv-2', slug: 'adel-ogla-houston', locked_preview: 'card', locked_reveal: ['cover', 'date'] };
  rows = [open, secret, boxed];
  const body = await list({ withPrivate: 'true', limit: '24' });
  assert.equal(privacyFilter(), undefined, 'no privacy filter: public and private alike');
  assert.deepEqual(body.data.map((e) => e.slug), ['jazz-night', 'sara-and-omar', 'adel-ogla-houston']);
  const card = body.data[2];
  assert.equal(card.isPrivate, true);
  assert.equal(card.lockedPreview, 'card', 'drawn plain, not blurred');
  assert.equal(body.data[1].lockedPreview, 'blur');
  assert.equal(card.city, null, 'still only the locked card');
  assert.equal(card.venue, null);
  assert.equal(card.coverUrl, 'https://cdn/wedding.jpg', 'its cover was chosen to show');
});

test('a listed private event shows its name, organizer and date — nothing else', async () => {
  rows = [secret];
  const [card] = (await list({ withPrivate: 'true' })).data;
  assert.equal(card.isPrivate, true);
  assert.equal(card.title, 'Sara & Omar’s Wedding');
  assert.deepEqual(card.organizer, { name: 'Golden Events' });
  assert.equal(card.startsAt, '2026-12-27T22:00:00Z');
  assert.equal(card.timezone, 'America/Toronto');
  assert.equal(card.coverUrl, null, 'the cover URL is never sent');
  assert.equal(card.blurredCover, true, 'the blurred copy is drawn instead');
  for (const key of ['venue', 'city', 'venueAddress', 'category', 'fromPriceCents', 'availability']) {
    assert.equal(card[key], null, `${key} must be hidden`);
  }
  const sent = JSON.stringify(card);
  for (const hidden of ['Mississauga', 'Secret Garden', 'Hidden Rd', 'The details', 'wedding.jpg']) {
    assert.equal(sent.includes(hidden), false, `"${hidden}" leaked into the listing`);
  }
});

test('a private event’s prices are never looked up', async () => {
  rows = [open, secret];
  await list({ withPrivate: 'true' });
  assert.deepEqual(rpcIds, ['open-1']);
});

test('a cover the organizer chose to show is sent as it is', async () => {
  rows = [{ ...secret, locked_reveal: ['title', 'organizer', 'cover'] }];
  const [card] = (await list({ withPrivate: 'true' })).data;
  assert.equal(card.coverUrl, 'https://cdn/wedding.jpg');
  assert.equal(card.blurredCover, false);
});

test('without withPrivate, private events stay off the listing', async () => {
  rows = [open];
  await list({ limit: '24' });
  const f = privacyFilter();
  assert.deepEqual([f.m, ...f.args], ['eq', 'is_private', false]);
});

test('a filter that could match a hidden detail keeps private events out', async () => {
  for (const extra of [{ city: 'Toronto' }, { category: 'wedding' }, { maxPrice: 4000 }, { q: 'garden' }, { country: 'CA' }, { onSale: 'true' }]) {
    rows = [];
    await list({ withPrivate: 'true', ...extra });
    const f = privacyFilter();
    assert.deepEqual([f.m, ...f.args], ['eq', 'is_private', false], `with ${JSON.stringify(extra)}`);
  }
});

test('saved events come back private ones included, as locked cards (2026-11-24)', async () => {
  rows = [secret];
  const body = await list({ withPrivate: 'true', includePast: 'true', slugs: 'sara-and-omar' });
  assert.equal(privacyFilter(), undefined, 'no privacy filter on a saved-slugs lookup');
  assert.equal(body.data[0].isPrivate, true);
  assert.equal(body.data[0].venue, null, 'still only the locked card');
});

test('a date range is fine — the date is shown anyway', async () => {
  rows = [];
  await list({ withPrivate: 'true', from: '2026-12-01', to: '2026-12-31' });
  assert.equal(privacyFilter(), undefined, 'private events stay in under a date range');
});
