const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-placeholder';

const { supabase } = require('../config/supabase');
const venue = require('../services/venueService');
const addons = require('../services/addonService');
const T = require('../services/eventTemplateService');

/**
 * Event templates (owner, 2026-11-19). A small in-memory stand-in for the
 * PostgREST builder: enough of select / eq / order / insert / update / delete
 * to run the service against rows, with no database.
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
        id: uuid(), use_count: 0, featured: false, sort_order: 0, created_at: 'now', updated_at: 'now', ...r,
      }));
      rows.push(...list);
      return list;
    }
    const hit = rows.filter(matches);
    if (op === 'update') hit.forEach((r) => Object.assign(r, payload));
    if (op === 'delete') db[table] = rows.filter((r) => !matches(r));
    return hit;
  };
  const b = {
    select(_cols, opts) { if (opts?.head) head = true; return b; },
    insert(p) { op = 'insert'; payload = p; return b; },
    update(p) { op = 'update'; payload = p; return b; },
    delete() { op = 'delete'; return b; },
    eq(k, v) { filters.push((r) => r[k] === v); return b; },
    ilike(k, v) { const re = new RegExp(`^${String(v).replace(/%/g, '.*')}$`, 'i'); filters.push((r) => re.test(r[k])); return b; },
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

const real = { from: supabase.from, rpc: supabase.rpc, getMap: venue.getMapForOrganizer, saveMap: venue.saveMap, list: addons.listForOrganizer, create: addons.create };
let saved;

beforeEach(() => {
  db = {
    events: [
      {
        id: 'ev-1', organizer_id: 'org-1', title: 'Spring Gala', description: 'Dinner', category: 'party', listing_type: 'ticketed',
        admission_type: 'reserved', purchase_mode: 'seat_only', max_tickets_per_order: 8, allow_ticket_transfer: true, fee_bearer: 'buyer',
        venue_name: 'Grand Hall', venue_address: '1 Main', city: 'Toronto', country: 'CA', timezone: 'America/Toronto',
        starts_at: '2026-05-01T23:30:00Z', ends_at: '2026-05-02T03:30:00Z', currency: 'CAD', cover_url: 'https://cdn/x.jpg', status: 'published',
      },
      { id: 'ev-new', organizer_id: 'org-1', status: 'draft', listing_type: 'ticketed', admission_type: 'reserved', currency: 'CAD' },
      { id: 'ev-other', organizer_id: 'org-2', status: 'draft', listing_type: 'ticketed', admission_type: 'reserved', currency: 'CAD' },
    ],
    ticket_tiers: [
      { id: 'tier-vip', event_id: 'ev-1', name: 'VIP', price_cents: 12000, quantity: null, sort_order: 0, kind: 'standard', max_per_order: null, is_hidden: false, details: null },
      { id: 'tier-std', event_id: 'ev-1', name: 'Standard', price_cents: 6000, quantity: null, sort_order: 1, kind: 'standard', max_per_order: 4, is_hidden: false, details: null },
    ],
    table_categories: [{ id: 'cat-1', event_id: 'ev-1', name: 'Family', color: '#d61f2c', sort_order: 0 }],
    event_templates: [],
  };
  saved = null;
  supabase.from = from;
  supabase.rpc = async (name, args) => {
    const t = db.event_templates.find((r) => r.id === args.p_id);
    if (t) t.use_count += 1;
    return { error: null };
  };
  venue.getMapForOrganizer = async (eventId) => (eventId !== 'ev-1' ? null : {
    layout: { zones: [{ id: 'z', kind: 'stage' }], views: [{ id: 'v', path: 'events/ev-1/panorama-1.jpg' }], look: { floor: '#fffcf2' } },
    tables: [
      { id: 'tb-1', label: 'T1', seatCount: 8, priceCents: null, isPrivate: true, position: { x: 10, y: 10, rotation: 0 }, shape: 'round', categoryId: 'cat-1', tierId: 'tier-vip', seatPriceCents: null, seats: [{ id: 's' }] },
      { id: 'tb-2', label: 'T2', seatCount: 10, priceCents: 50000, isPrivate: false, position: { x: 30, y: 10, rotation: 90 }, shape: 'd_shape', categoryId: null, tierId: 'tier-std', seatPriceCents: null, seats: [] },
    ],
  });
  venue.saveMap = async (eventId, payload) => { saved = { eventId, payload }; return {}; };
  addons.listForOrganizer = async () => [{ id: 'ad-1', name: 'Photo', description: null, priceCents: 1500, quantity: 20, sortOrder: 0, isActive: true, imageUrl: 'https://x' }];
  addons.create = async (eventId, body) => { (db.event_addons ||= []).push({ event_id: eventId, ...body }); return body; };
});

afterEach(() => {
  supabase.from = real.from;
  supabase.rpc = real.rpc;
  venue.getMapForOrganizer = real.getMap;
  venue.saveMap = real.saveMap;
  addons.listForOrganizer = real.list;
  addons.create = real.create;
});

test('a snapshot keeps the setup and drops ids, sales, passwords and photos', async () => {
  const { data, summary } = await T.snapshotEvent('ev-1', { organizerId: 'org-1' });
  assert.equal(data.event.title, 'Spring Gala');
  assert.equal(data.event.startTime, '19:30', 'local start time in the event zone');
  assert.equal(data.event.durationMinutes, 240);
  assert.deepEqual(data.tiers.map((t) => [t.key, t.name]), [['t1', 'VIP'], ['t2', 'Standard']]);
  assert.equal(data.map.tables[0].tierKey, 't1');
  assert.equal(data.map.tables[0].categoryKey, 'c1');
  assert.equal('id' in data.map.tables[0], false);
  assert.equal('seats' in data.map.tables[0], false);
  assert.equal('isPrivate' in data.map.tables[0], false);
  assert.equal('views' in data.map.layout, false, '360° photos belong to the source event');
  assert.equal(JSON.stringify(data).includes('tier-vip'), false, 'no source ids anywhere');
  assert.deepEqual({ tiers: summary.tiers, tables: summary.tables, seats: summary.seats, addons: summary.addons }, { tiers: 2, tables: 2, seats: 18, addons: 1 });
});

test('an organizer saves only their own events, up to the cap', async () => {
  await assert.rejects(T.createFromEvent({ scope: 'organizer', organizerId: 'org-2', eventId: 'ev-1' }), (e) => e.code === 'NOT_FOUND');
  const t = await T.createFromEvent({ scope: 'organizer', organizerId: 'org-1', eventId: 'ev-1', name: 'Gala setup' });
  assert.equal(t.name, 'Gala setup');
  assert.equal(t.status, 'published');
  for (let i = 0; i < T.MAX_PER_ORGANIZER - 1; i += 1) db.event_templates.push({ id: `x${i}`, scope: 'organizer', organizer_id: 'org-1' });
  await assert.rejects(T.createFromEvent({ scope: 'organizer', organizerId: 'org-1', eventId: 'ev-1' }), (e) => e.code === 'VALIDATION_ERROR');
});

test('Eventsli templates start as drafts, and organizers see only published ones', async () => {
  const t = await T.createFromEvent({ scope: 'platform', eventId: 'ev-1' });
  assert.equal(t.status, 'draft');
  assert.equal((await T.listForOrganizer('org-2')).eventsli.length, 0);
  await assert.rejects(T.getForOrganizer('org-2', t.id), (e) => e.code === 'NOT_FOUND');
  await T.update(t.id, { status: 'published', featured: true }, { admin: true });
  assert.equal((await T.listForOrganizer('org-2')).eventsli.length, 1);
  assert.equal((await T.getForOrganizer('org-2', t.id)).featured, true);
});

test('an organizer cannot see, rename or delete another organizer’s template', async () => {
  const t = await T.createFromEvent({ scope: 'organizer', organizerId: 'org-1', eventId: 'ev-1' });
  await assert.rejects(T.getForOrganizer('org-2', t.id), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(T.update(t.id, { name: 'Mine now' }, { organizerId: 'org-2' }), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(T.remove(t.id, { organizerId: 'org-2' }), (e) => e.code === 'NOT_FOUND');
  // And an organizer's update cannot publish or feature anything.
  const renamed = await T.update(t.id, { name: 'Renamed', status: 'hidden', featured: true }, { organizerId: 'org-1' });
  assert.equal(renamed.name, 'Renamed');
  assert.equal(renamed.status, 'published');
  assert.equal(renamed.featured, false);
});

test('copying an Eventsli template puts it in the organizer’s library', async () => {
  const p = await T.createFromEvent({ scope: 'platform', eventId: 'ev-1', name: 'Wedding' });
  await T.update(p.id, { status: 'published' }, { admin: true });
  const copy = await T.copyToOrganizer('org-2', p.id);
  assert.equal(copy.scope, 'organizer');
  assert.equal(copy.organizerId, 'org-2');
  assert.equal(copy.copiedFromId, p.id);
  assert.equal(copy.name, 'Wedding');
});

test('applying copies ticket types, categories, add-ons and the map, with new ids', async () => {
  const t = await T.createFromEvent({ scope: 'organizer', organizerId: 'org-1', eventId: 'ev-1' });
  const result = await T.applyToEvent({ organizerId: 'org-1', eventId: 'ev-new', templateId: t.id });
  assert.deepEqual({ tiers: result.tiers, categories: result.categories, addons: result.addons, tables: result.tables }, { tiers: 2, categories: 1, addons: 1, tables: 2 });

  const newTiers = db.ticket_tiers.filter((r) => r.event_id === 'ev-new');
  const vip = newTiers.find((r) => r.name === 'VIP');
  assert.equal(saved.eventId, 'ev-new');
  assert.equal(saved.payload.tables[0].tierId, vip.id, 'the map points at the NEW ticket type');
  assert.notEqual(saved.payload.tables[0].tierId, 'tier-vip');
  assert.equal(saved.payload.tables[0].isPrivate, false, 'no table arrives private without a password');
  assert.equal(saved.payload.tables[0].categoryId, db.table_categories.find((c) => c.event_id === 'ev-new').id);
  assert.equal(db.event_templates.find((r) => r.id === t.id).use_count, 1);
});

test('applying is refused on another organizer’s event, a live event, or one already set up', async () => {
  const t = await T.createFromEvent({ scope: 'organizer', organizerId: 'org-1', eventId: 'ev-1' });
  await assert.rejects(T.applyToEvent({ organizerId: 'org-1', eventId: 'ev-other', templateId: t.id }), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(T.applyToEvent({ organizerId: 'org-1', eventId: 'ev-1', templateId: t.id }), (e) => e.code === 'CONFLICT');
  db.ticket_tiers.push({ id: 'tier-x', event_id: 'ev-new', name: 'GA' });
  await assert.rejects(T.applyToEvent({ organizerId: 'org-1', eventId: 'ev-new', templateId: t.id }), (e) => e.code === 'CONFLICT');
});

test('a different currency is applied but flagged', async () => {
  db.events.find((e) => e.id === 'ev-new').currency = 'USD';
  const t = await T.createFromEvent({ scope: 'organizer', organizerId: 'org-1', eventId: 'ev-1' });
  const result = await T.applyToEvent({ organizerId: 'org-1', eventId: 'ev-new', templateId: t.id });
  assert.match(result.warnings.join(' '), /CAD.*USD/);
});

test('admin routes: reads for any admin, every write for a super admin', () => {
  const router = require('../routes/admin/templateRoutes');
  const guard = router.stack.find((l) => !l.route && l.regexp.test('/templates'));
  assert.ok(guard, 'a router-level guard on /templates');
  let passed = false;
  guard.handle({ method: 'GET' }, {}, () => { passed = true; });
  assert.equal(passed, true, 'GET goes straight through');
  let status = null;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  guard.handle({ method: 'POST', user: { role: 'admin', access: { role: 'admin' } } }, res, () => { status = 'next'; });
  assert.notEqual(status, 'next', 'a plain admin cannot write');
});
