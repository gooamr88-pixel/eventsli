const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-placeholder';

const { supabase } = require('../config/supabase');
const venue = require('../services/venueService');
const V = require('../services/venueMapTemplateService');

/**
 * The venue map library (owner, 2026-11-24): map-only templates of real
 * venues. The same in-memory PostgREST stand-in as eventTemplates.test.js,
 * plus `.or()` for the admin search.
 */
let db;
let ids = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

function from(table) {
  const rows = (db[table] ||= []);
  const filters = [];
  let op = 'select';
  let payload = null;
  let single = null;
  let head = false;
  const matches = (r) => filters.every((f) => f(r));
  const run = () => {
    if (op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
        id: uuid(), use_count: 0, featured: false, verified: false, sort_order: 0, created_at: 'now', updated_at: 'now', ...r,
      }));
      rows.push(...list);
      return list;
    }
    const hit = rows.filter(matches);
    if (op === 'update') hit.forEach((r) => Object.assign(r, payload));
    if (op === 'delete') db[table] = rows.filter((r) => !matches(r));
    return hit;
  };
  const like = (v) => new RegExp(`^${String(v).replace(/\\/g, '').replace(/%/g, '.*')}$`, 'i');
  const b = {
    select(_cols, opts) { if (opts?.head) head = true; return b; },
    insert(p) { op = 'insert'; payload = p; return b; },
    update(p) { op = 'update'; payload = p; return b; },
    delete() { op = 'delete'; return b; },
    eq(k, v) { filters.push((r) => r[k] === v); return b; },
    ilike(k, v) { const re = like(v); filters.push((r) => re.test(r[k] || '')); return b; },
    or(expr) {
      const parts = expr.split(',').map((p) => { const [k, , ...v] = p.split('.'); return [k, like(v.join('.'))]; });
      filters.push((r) => parts.some(([k, re]) => re.test(r[k] || '')));
      return b;
    },
    order() { return b; },
    limit() { return b; },
    maybeSingle() { single = 'maybe'; return b; },
    single() { single = 'one'; return b; },
    then(resolve, reject) {
      try {
        const out = run();
        if (head) return resolve({ count: out.length, error: null });
        if (single) return resolve({ data: out[0] || null, error: single === 'one' && !out[0] ? { message: 'no row' } : null });
        return resolve({ data: out, error: null });
      } catch (err) { return reject(err); }
    },
  };
  return b;
}

const real = { from: supabase.from, rpc: supabase.rpc, getMap: venue.getMapForOrganizer };
let rpcCalls;

beforeEach(() => {
  rpcCalls = [];
  db = {
    events: [
      {
        id: 'ev-1', organizer_id: 'org-1', title: 'Spring Gala', venue_name: 'Grand Hall', venue_address: '1 Main St',
        venue_region: 'ON', city: 'Toronto', country: 'CA', venue_place_id: 'place-grand', venue_lat: 43.6, venue_lng: -79.4,
      },
      { id: 'ev-2', organizer_id: 'org-1', title: 'Other night', venue_name: 'Grand Hall', city: 'Toronto', country: 'CA', venue_place_id: null },
      { id: 'ev-empty', organizer_id: 'org-1', title: 'No map yet', venue_name: 'Somewhere', city: 'Ottawa' },
    ],
    table_categories: [
      { id: 'cat-1', event_id: 'ev-1', name: 'VIP', color: '#d61f2c', sort_order: 0 },
      { id: 'cat-2', event_id: 'ev-1', name: 'Unused', color: '#000000', sort_order: 1 },
    ],
    venue_map_templates: [],
  };
  supabase.from = from;
  supabase.rpc = async (name, args) => {
    rpcCalls.push([name, args]);
    const t = db.venue_map_templates.find((r) => r.id === args.p_id);
    if (t) t.use_count += 1;
    return { error: null };
  };
  venue.getMapForOrganizer = async (eventId) => (eventId !== 'ev-1' ? null : {
    layout: {
      zones: [{ id: 'z', kind: 'stage' }, { id: 'w', kind: 'wall' }],
      views: [{ id: 'v', path: 'events/ev-1/panorama-1.jpg' }],
      venue: { type: 'ballroom', photo: { path: 'events/ev-1/venue.jpg' }, standingCapacity: 300 },
      world: { width: 1600, height: 1000 },
      look: { floor: '#fffcf2' },
    },
    tables: [
      { id: 'tb-1', label: 'T1', seatCount: 8, priceCents: 90000, isPrivate: true, position: { x: 10, y: 10, rotation: 0 }, shape: 'round', categoryId: 'cat-1', tierId: 'tier-vip', seatPriceCents: 15000, seats: [{ id: 's' }] },
      { id: 'tb-2', label: 'A1', seatCount: 20, priceCents: null, isPrivate: false, position: { x: 30, y: 60, rotation: 0 }, shape: 'row', categoryId: null, tierId: 'tier-std', seatPriceCents: null, section: 'Floor', row: 'A', seats: [] },
    ],
  });
});

afterEach(() => {
  supabase.from = real.from;
  supabase.rpc = real.rpc;
  venue.getMapForOrganizer = real.getMap;
});

test('a saved map is the room only: no prices, ticket types, passwords, photos or ids', async () => {
  const { data, summary } = await V.snapshotEvent('ev-1', { organizerId: 'org-1' });
  const json = JSON.stringify(data);
  for (const leak of ['tier-vip', 'tier-std', 'priceCents', 'seatPriceCents', 'isPrivate', 'tb-1', 'cat-1', 'panorama', 'venue.jpg']) {
    assert.equal(json.includes(leak), false, `${leak} must not be in a venue map`);
  }
  assert.equal('views' in data.layout, false);
  assert.equal('photo' in data.layout.venue, false);
  assert.equal(data.layout.venue.standingCapacity, 300, 'the rest of the venue settings stay');
  assert.deepEqual(data.groups, [{ key: 'g1', name: 'VIP', color: '#d61f2c' }], 'only the groups the map uses');
  assert.equal(data.tables[0].groupKey, 'g1');
  assert.deepEqual(data.tables[1], { label: 'A1', seatCount: 20, shape: 'row', position: { x: 30, y: 60, rotation: 0 }, section: 'Floor', row: 'A' });
  assert.deepEqual(
    { tables: summary.tables, rows: summary.rows, sections: summary.sections, seats: summary.seats, areas: summary.areas, walls: summary.walls },
    { tables: 1, rows: 1, sections: 1, seats: 28, areas: 1, walls: 1 },
  );
});

test('an organizer saves their own event’s map, with its venue, up to the cap', async () => {
  await assert.rejects(V.saveFromEvent({ organizerId: 'org-2', eventId: 'ev-1' }), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(V.saveFromEvent({ organizerId: 'org-1', eventId: 'ev-empty' }), (e) => e.code === 'VALIDATION_ERROR');
  const t = await V.saveFromEvent({ organizerId: 'org-1', eventId: 'ev-1', name: 'Gala rounds' });
  assert.equal(t.name, 'Gala rounds');
  assert.equal(t.scope, 'organizer');
  assert.equal(t.status, 'published');
  assert.equal(t.source, 'event');
  assert.deepEqual(
    [t.venue.name, t.venue.city, t.venue.region, t.venue.country, t.venue.placeId, t.venue.kind],
    ['Grand Hall', 'Toronto', 'ON', 'CA', 'place-grand', 'ballroom'],
    'venue from the event, kind from the Studio',
  );
  for (let i = 0; i < V.MAX_PER_ORGANIZER - 1; i += 1) db.venue_map_templates.push({ id: `x${i}`, scope: 'organizer', organizer_id: 'org-1' });
  await assert.rejects(V.saveFromEvent({ organizerId: 'org-1', eventId: 'ev-1' }), (e) => e.code === 'VALIDATION_ERROR' && /50/.test(e.message));
});

test('map data from a picture is checked before it is kept', () => {
  const table = (label, extra = {}) => ({ label, seatCount: 6, shape: 'round', position: { x: 10, y: 10 }, ...extra });
  assert.throws(() => V.cleanData({ tables: [], layout: {} }), (e) => e.code === 'VALIDATION_ERROR' && /empty/.test(e.message));
  assert.throws(() => V.cleanData({ tables: [table('T1'), table('t1')] }), (e) => /Two tables/.test(e.message));
  assert.throws(() => V.cleanData({ tables: [table('T1', { seatCount: 61 })] }), (e) => e.code === 'VALIDATION_ERROR');
  assert.throws(() => V.cleanData({ tables: [table('T1', { position: { x: 'a' } })] }), (e) => e.code === 'VALIDATION_ERROR');
  assert.throws(() => V.cleanData({ tables: Array.from({ length: 401 }, (_, i) => table(`T${i}`)) }), (e) => /400/.test(e.message));

  const out = V.cleanData({
    tables: [table('T1', { shape: 'Bad Shape!', priceCents: 500, tierId: 'x', groupKey: 'nope' })],
    layout: { zones: [{ id: 'z', kind: 'stage' }], views: [{ id: 'v' }] },
  });
  assert.equal(out.tables[0].shape, 'round', 'an unknown shape falls back');
  assert.equal('priceCents' in out.tables[0], false);
  assert.equal('tierId' in out.tables[0], false);
  assert.equal('groupKey' in out.tables[0], false, 'a group that is not declared is dropped');
  assert.equal('views' in out.layout, false);
  assert.equal(out.tables[0].position.rotation, 0);
});

test('Eventsli maps start as drafts; organizers see published ones, and their venue’s first', async () => {
  const fromPicture = await V.createPlatform({
    data: { tables: [{ label: 'Sec 101', seatCount: 30, shape: 'row', position: { x: 50, y: 50 }, section: '101' }], layout: {} },
    venue: { name: 'Grand Hall', city: 'Toronto', country: 'ca', placeId: 'place-grand', kind: 'arena' },
    name: 'Concert — end stage', sourceNote: 'Based on the venue’s published chart', verified: true,
  });
  assert.equal(fromPicture.status, 'draft');
  assert.equal(fromPicture.source, 'image');
  assert.equal(fromPicture.verified, true);
  assert.equal(fromPicture.venue.country, 'CA');
  assert.equal(fromPicture.sourceNote, 'Based on the venue’s published chart');

  await assert.rejects(V.createPlatform({ data: { tables: [], layout: { zones: [{ id: 'z' }] } }, venue: {} }), (e) => /Name the venue/.test(e.message));

  let list = await V.listForOrganizer('org-1', { eventId: 'ev-1' });
  assert.equal(list.library.length, 0, 'a draft is admins only');
  await assert.rejects(V.getForOrganizer('org-1', fromPicture.id), (e) => e.code === 'NOT_FOUND');

  await V.update(fromPicture.id, { status: 'published' }, { admin: true });
  const elsewhere = await V.createPlatform({
    data: { tables: [{ label: 'T1', seatCount: 8, position: { x: 1, y: 1 } }] }, venue: { name: 'Other Arena', city: 'Montreal' },
  });
  await V.update(elsewhere.id, { status: 'published' }, { admin: true });

  list = await V.listForOrganizer('org-1', { eventId: 'ev-1' });
  assert.equal(list.library.length, 2);
  assert.deepEqual(list.forVenue.map((t) => t.id), [fromPicture.id], 'matched on the Google place');
  assert.deepEqual(list.venue, { name: 'Grand Hall', city: 'Toronto' });

  // Without a place id on the event: the same name in the same city.
  list = await V.listForOrganizer('org-1', { eventId: 'ev-2' });
  assert.deepEqual(list.forVenue.map((t) => t.id), [fromPicture.id]);

  // Another organizer's event: no venue, no suggestions.
  list = await V.listForOrganizer('org-2', { eventId: 'ev-1' });
  assert.deepEqual(list.forVenue, []);
  assert.equal(list.venue, null);
});

test('only a super admin’s path changes status, venue or verification; organizers rename their own', async () => {
  const mine = await V.saveFromEvent({ organizerId: 'org-1', eventId: 'ev-1' });
  const renamed = await V.update(mine.id, { name: 'Ballroom, 40 rounds', venueKind: 'banquet_hall', status: 'hidden', verified: true }, { organizerId: 'org-1' });
  assert.equal(renamed.name, 'Ballroom, 40 rounds');
  assert.equal(renamed.venue.kind, 'banquet_hall');
  assert.equal(renamed.status, 'published', 'an organizer cannot change who sees it');
  assert.equal(renamed.verified, false);
  await assert.rejects(V.update(mine.id, { name: 'x y' }, { organizerId: 'org-2' }), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(V.update(mine.id, { status: 'published' }, { admin: true }), (e) => e.code === 'NOT_FOUND', 'admin edits are for Eventsli maps');
  await assert.rejects(V.update(mine.id, { venueKind: 'castle' }, { organizerId: 'org-1' }), (e) => e.code === 'VALIDATION_ERROR');
  await assert.rejects(V.remove(mine.id, { organizerId: 'org-2' }), (e) => e.code === 'NOT_FOUND');
});

test('copy, promote, replace and count a use', async () => {
  const mine = await V.saveFromEvent({ organizerId: 'org-1', eventId: 'ev-1', name: 'Gala' });
  const promoted = await V.promoteToPlatform(mine.id);
  assert.equal(promoted.scope, 'platform');
  assert.equal(promoted.status, 'draft');
  assert.equal(promoted.copiedFromId, mine.id);
  await V.update(promoted.id, { status: 'published', featured: true }, { admin: true });

  const copy = await V.copyToOrganizer('org-2', promoted.id);
  assert.equal(copy.scope, 'organizer');
  assert.equal(copy.organizerId, 'org-2');
  assert.equal(copy.name, 'Gala', 'an Eventsli map keeps its name');
  assert.equal(copy.source, 'template');
  const again = await V.copyToOrganizer('org-1', mine.id);
  assert.equal(again.name, 'Gala (copy)');

  const replaced = await V.replaceMap(promoted.id, { data: { tables: [{ label: 'R1', seatCount: 12, position: { x: 5, y: 5 } }] } });
  assert.equal(replaced.summary.seats, 12);
  assert.equal(replaced.source, 'image');
  await assert.rejects(V.replaceMap(mine.id, { eventId: 'ev-1' }), (e) => e.code === 'NOT_FOUND', 'only Eventsli maps are replaced here');

  await V.markUsed('org-2', promoted.id);
  assert.deepEqual(rpcCalls, [['bump_venue_map_template_use', { p_id: promoted.id }]]);
  await assert.rejects(V.markUsed('org-2', mine.id), (e) => e.code === 'NOT_FOUND', 'not another organizer’s map');
});

test('the admin search looks at the venue, the layout name and the city', async () => {
  await V.createPlatform({ data: { tables: [{ label: 'T1', seatCount: 4, position: { x: 1, y: 1 } }] }, venue: { name: 'Massey Hall', city: 'Toronto', kind: 'concert_hall' }, name: 'Seated concert' });
  await V.createPlatform({ data: { tables: [{ label: 'T1', seatCount: 4, position: { x: 1, y: 1 } }] }, venue: { name: 'Bell Centre', city: 'Montreal', kind: 'arena' }, name: 'Hockey bowl' });
  const by = async (q, extra = {}) => (await V.listForAdmin({ q, ...extra })).templates.map((t) => t.venue.name);
  assert.deepEqual(await by('massey'), ['Massey Hall']);
  assert.deepEqual(await by('montreal'), ['Bell Centre']);
  assert.deepEqual(await by('bowl'), ['Bell Centre']);
  assert.deepEqual(await by('', { kind: 'concert_hall' }), ['Massey Hall']);
  assert.deepEqual(await by('', { status: 'published' }), []);
});

test('without the migration the library reads as switched off, not as an error', async () => {
  supabase.from = () => {
    const b = { select: () => b, eq: () => b, order: () => b, then: (r) => r({ data: null, error: { message: 'relation "venue_map_templates" does not exist' } }) };
    return b;
  };
  const list = await V.listForOrganizer('org-1');
  assert.equal(list.enabled, false);
  const admin = await V.listForAdmin({});
  assert.equal(admin.enabled, false);
});
