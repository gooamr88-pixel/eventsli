const { test } = require('node:test');
const assert = require('node:assert/strict');

// Imported from eventRules, NOT eventService: the rules must be exercisable
// with no database and no environment. eventService pulls in the Supabase
// client, which throws at module load without credentials.
const {
  partitionPatch, canTransition, transitionActor,
  ORGANIZER_EDITABLE, ADMIN_EDITABLE, TRANSITIONS,
} = require('../services/eventRules');
const { slugify, uniqueSlug } = require('../utils/slug');

// ── Field authorisation ─────────────────────────────────────────────────────

test('the allowlist translates camelCase input to column names', () => {
  // The bug this guards: a list of COLUMN names rejects every field the API
  // actually receives, because `feeBearer` is not `fee_bearer`. Every entry is
  // spelled once, in both dialects.
  const { allowed, denied } = partitionPatch(
    { title: 'X', feeBearer: 'organizer', maxTicketsPerOrder: 4, venueAddress: '1 St' },
    { isAdmin: false },
  );
  assert.deepEqual(allowed, {
    title: 'X',
    fee_bearer: 'organizer',
    max_tickets_per_order: 4,
    venue_address: '1 St',
  });
  assert.deepEqual(denied, []);
});

test('every organizer-editable key maps to a real column name', () => {
  for (const [apiName, column] of Object.entries(ORGANIZER_EDITABLE)) {
    assert.match(column, /^[a-z][a-z0-9_]*$/, `${apiName} maps to "${column}", which is not snake_case`);
  }
});

test('an organizer cannot touch any money rate', () => {
  const { allowed, denied } = partitionPatch({
    commissionPct: 0, commission_pct: 0,
    eventTaxPct: 0, paymentFeePct: 0, paymentFeeMode: 'manual',
  }, { isAdmin: false });

  assert.deepEqual(allowed, {}, 'not one of these may reach the database');
  assert.equal(denied.length, 5);
});

test('an admin can, and gets the same column names', () => {
  const { allowed, denied } = partitionPatch(
    { commissionPct: 2.5, eventTaxPct: 13 }, { isAdmin: true },
  );
  assert.deepEqual(allowed, { commission_pct: 2.5, event_tax_pct: 13 });
  assert.deepEqual(denied, []);
});

test('the fee bearer is the one financial field an organizer owns', () => {
  const { allowed } = partitionPatch({ feeBearer: 'organizer' }, { isAdmin: false });
  assert.deepEqual(allowed, { fee_bearer: 'organizer' });
});

test('unknown and dangerous fields are denied by name', () => {
  const { allowed, denied } = partitionPatch({
    status: 'published', organizer_id: 'someone-else', slug: 'stolen', currency: 'USD',
  }, { isAdmin: true });

  assert.deepEqual(allowed, {}, 'not even an admin edits these through this endpoint');
  // Named back, so the API can say WHICH field was refused rather than a vague 403.
  assert.deepEqual(denied.sort(), ['currency', 'organizer_id', 'slug', 'status']);
});

test('a new column is not editable until someone adds it deliberately', () => {
  const { denied } = partitionPatch({ someFutureColumn: 1 }, { isAdmin: true });
  assert.deepEqual(denied, ['someFutureColumn']);
});

// ── Status machine ──────────────────────────────────────────────────────────

test('an organizer submits; only an admin publishes', () => {
  assert.equal(canTransition('draft', 'pending_review'), true);
  assert.equal(canTransition('draft', 'published'), false, 'self-publishing must be impossible');
  assert.equal(transitionActor('draft', 'pending_review'), 'organizer');
  assert.equal(transitionActor('pending_review', 'published'), 'admin');
});

test('a rejected event can go round again', () => {
  assert.equal(canTransition('rejected', 'pending_review'), true);
  assert.equal(canTransition('rejected', 'draft'), true);
});

test('cancelled and completed are terminal', () => {
  assert.deepEqual(TRANSITIONS.cancelled, []);
  assert.deepEqual(TRANSITIONS.completed, []);
  for (const to of ['draft', 'published', 'pending_review', 'suspended']) {
    assert.equal(canTransition('cancelled', to), false, `cancelled must not become ${to}`);
  }
});

test('suspension is the admin\'s act, cancellation the organizer\'s', () => {
  assert.equal(transitionActor('published', 'suspended'), 'admin');
  assert.equal(transitionActor('published', 'cancelled'), 'organizer');
  assert.equal(canTransition('suspended', 'published'), true, 'suspension must be reversible');
});

test('a published event cannot slip back into review', () => {
  assert.equal(canTransition('published', 'pending_review'), false);
  assert.equal(canTransition('published', 'draft'), false);
});

// ── Slugs ───────────────────────────────────────────────────────────────────

test('slugify produces something safe to put in a URL', () => {
  assert.equal(slugify('Summer Gala 2026!'), 'summer-gala-2026');
  assert.equal(slugify('  Café  Night  '), 'cafe-night');
  assert.equal(slugify('---'), 'event', 'never empty');
  assert.equal(slugify(''), 'event');
  assert.equal(slugify('A'.repeat(200)).length <= 60, true);
  assert.match(slugify('Ünïcödé Tëst'), /^[a-z0-9-]+$/);
});

test('a slug never ends in a dash after truncation', () => {
  const s = slugify('word '.repeat(40));
  assert.equal(s.endsWith('-'), false);
});

test('collisions get an unguessable suffix, not a counter', async () => {
  const taken = new Set(['summer-gala']);
  const s = await uniqueSlug('Summer Gala', async (c) => taken.has(c));

  assert.notEqual(s, 'summer-gala');
  assert.match(s, /^summer-gala-[0-9a-f]{6}$/);
  // "-2" would tell anyone how many events share a title, and make the
  // neighbouring slug trivially guessable.
  assert.notEqual(s, 'summer-gala-2');
});

test('a free slug is used as-is', async () => {
  const s = await uniqueSlug('Totally Unique Title', async () => false);
  assert.equal(s, 'totally-unique-title');
});
