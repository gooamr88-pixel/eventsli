const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-placeholder';

const { supabase } = require('../config/supabase');
const discovery = require('../controllers/discoveryController');

/**
 * Event card states (owner, 2026-11-18): "Past event", "Sold out" and
 * "Selling fast" on listing cards. The listing now carries the same
 * availability the event page does, batched, and every event says whether
 * it is over.
 */

const realFrom = supabase.from.bind(supabase);
afterEach(() => { supabase.from = realFrom; });

/** Stubs the one ticket_tiers query listingAvailability makes for general-admission events. */
function stubTiers(rows) {
  const calls = [];
  supabase.from = (table) => {
    calls.push(table);
    assert.equal(table, 'ticket_tiers', 'only tiers are read for general admission');
    return { select: () => ({ in: async () => ({ data: rows, error: null }) }) };
  };
  return calls;
}

const future = new Date(Date.now() + 7 * 864e5).toISOString();
const ga = (id, extra = {}) => ({ id, listing_type: 'ticketed', admission_type: 'general', coming_soon: false, starts_at: future, ends_at: future, ...extra });

test('isPast: over once its end passes — or its start, with no end', () => {
  const past = new Date(Date.now() - 864e5).toISOString();
  assert.equal(discovery.shape({ starts_at: past, ends_at: past }).isPast, true);
  assert.equal(discovery.shape({ starts_at: past, ends_at: null }).isPast, true);
  assert.equal(discovery.shape({ starts_at: past, ends_at: future }).isPast, false, 'still running');
  assert.equal(discovery.shape({ starts_at: future, ends_at: future }).isPast, false);
});

test('selling fast at four in five gone; sold out at all of them; neither when uncapped', async () => {
  stubTiers([
    { event_id: 'fast', quantity: 100, sold_count: 80 },
    { event_id: 'calm', quantity: 100, sold_count: 79 },
    { event_id: 'gone', quantity: 50, sold_count: 50 },
    { event_id: 'open', quantity: null, sold_count: 900 },
  ]);
  const out = await discovery.listingAvailability([ga('fast'), ga('calm'), ga('gone'), ga('open')]);
  assert.deepEqual(out.get('fast'), { seatsTotal: 100, seatsAvailable: 20, soldOut: false, sellingFast: true });
  assert.equal(out.get('calm').sellingFast, false);
  assert.equal(out.get('gone').soldOut, true);
  assert.equal(out.get('gone').sellingFast, false, 'sold out is not "selling fast"');
  assert.equal(out.get('open').sellingFast, undefined, 'uncapped: no scarcity to claim');
  assert.equal(out.get('open').soldOut, false);
});

test('listings, teasers and past events are not asked about at all', async () => {
  const calls = stubTiers([]);
  const past = new Date(Date.now() - 864e5).toISOString();
  const out = await discovery.listingAvailability([
    ga('info', { listing_type: 'display_only' }),
    ga('soon', { coming_soon: true }),
    ga('over', { starts_at: past, ends_at: past }),
  ]);
  assert.equal(out.size, 0);
  assert.equal(calls.length, 0, 'no query when nothing can be sold');
});

test('a failed availability read costs the tags, never the listing', async () => {
  supabase.from = () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'boom' } }) }) });
  const out = await discovery.listingAvailability([ga('a')]);
  assert.equal(out.size, 0);
});
