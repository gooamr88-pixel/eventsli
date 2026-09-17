const { test } = require('node:test');
const assert = require('node:assert/strict');

// Imported from eventRules, NOT eventService: the rules must be exercisable
// with no database and no environment. eventService pulls in the Supabase
// client, which throws at module load without credentials.
const {
  partitionPatch, canTransition, transitionActor, editConsequence, apiFieldName,
  ORGANIZER_EDITABLE, ADMIN_EDITABLE, TRANSITIONS,
  restoreTarget, paymentChoices, paymentFlags, paymentReadiness,
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

test('cancelled is terminal, and a finished event can only be filed away', () => {
  assert.deepEqual(TRANSITIONS.cancelled, []);
  assert.deepEqual(TRANSITIONS.completed, ['archived']);
  for (const to of ['draft', 'published', 'pending_review', 'suspended', 'archived']) {
    assert.equal(canTransition('cancelled', to), false, `cancelled must not become ${to}`);
  }
});

test('suspension and cancellation are both the admin\'s act (BRD §17)', () => {
  assert.equal(transitionActor('published', 'suspended'), 'admin');
  assert.equal(canTransition('suspended', 'published'), true, 'suspension must be reversible');

  // Every edge into `cancelled`, not a sample: the organizer shipped with this
  // power once, and a single edge left behind would bring it back.
  const cancelEdges = Object.keys(TRANSITIONS).filter((from) => canTransition(from, 'cancelled'));
  assert.ok(cancelEdges.length > 0);
  for (const from of cancelEdges) {
    assert.equal(transitionActor(from, 'cancelled'), 'admin', `${from}→cancelled must be the admin's`);
  }
});

test('a published event cannot slip back into review', () => {
  assert.equal(canTransition('published', 'pending_review'), false);
  assert.equal(canTransition('published', 'draft'), false);
});

// ── Edits and review (BRD §16) ──────────────────────────────────────────────

test('an edit during review withdraws the event to draft', () => {
  const r = editConsequence({
    status: 'pending_review', columns: ['title', 'updated_at'], isAdmin: false, hasPaidOrders: false,
  });
  assert.deepEqual(r.refused, []);
  assert.equal(r.returnsToDraft, true, 'the reviewer must not approve content they never saw');
  assert.equal(canTransition('pending_review', 'draft'), true);
  assert.equal(transitionActor('pending_review', 'draft'), 'organizer');
});

test('a draft or rejected event is edited freely', () => {
  for (const status of ['draft', 'rejected']) {
    const r = editConsequence({ status, columns: ['title', 'starts_at', 'venue_name'], isAdmin: false });
    assert.deepEqual(r.refused, [], status);
    assert.equal(r.returnsToDraft, false, status);
  }
});

test('a live event takes operational changes without another review', () => {
  const r = editConsequence({
    status: 'published',
    columns: ['description', 'max_tickets_per_order', 'allow_ticket_transfer', 'updated_at'],
    isAdmin: false,
    hasPaidOrders: true,
  });
  assert.deepEqual(r.refused, []);
  assert.equal(r.returnsToDraft, false, 'and it stays on sale');
});

test('a live event refuses what the reviewer approved, by the name the client sent', () => {
  for (const status of ['published', 'suspended']) {
    const r = editConsequence({
      status, columns: ['description', 'starts_at', 'venue_name'], isAdmin: false, hasPaidOrders: false,
    });
    assert.deepEqual(r.refused, ['starts_at', 'venue_name'], status);
    assert.equal(r.reason, 'EVENT_ON_SALE');
  }
  assert.equal(apiFieldName('starts_at'), 'startsAt');
  assert.equal(apiFieldName('venue_name'), 'venueName');
});

test('after a sale, how tickets sell and who pays the fee are fixed', () => {
  const r = editConsequence({
    status: 'suspended', columns: ['purchase_mode', 'fee_bearer'], isAdmin: false, hasPaidOrders: true,
  });
  assert.deepEqual(r.refused, ['purchase_mode', 'fee_bearer']);
  assert.equal(r.reason, 'LOCKED_AFTER_SALE');

  const before = editConsequence({
    status: 'draft', columns: ['purchase_mode', 'fee_bearer'], isAdmin: false, hasPaidOrders: false,
  });
  assert.deepEqual(before.refused, [], 'before a sale they are ordinary settings');
});

test('an admin is held to neither rule', () => {
  const r = editConsequence({
    status: 'published', columns: ['starts_at', 'purchase_mode'], isAdmin: true, hasPaidOrders: true,
  });
  assert.deepEqual(r.refused, []);
  assert.equal(r.returnsToDraft, false);
});

test('a country change that moves the currency is judged by the country, not the currency', () => {
  const r = editConsequence({ status: 'draft', columns: ['country', 'currency'], isAdmin: false });
  assert.deepEqual(r.refused, []);
});

// ── Archiving ───────────────────────────────────────────────────────────────

test('archiving is for the organizer, and a suspension cannot be archived away', () => {
  for (const from of ['draft', 'pending_review', 'rejected', 'published', 'completed']) {
    assert.equal(canTransition(from, 'archived'), true, `${from} can be archived`);
    assert.equal(transitionActor(from, 'archived'), 'organizer');
  }
  assert.equal(canTransition('suspended', 'archived'), false);
  assert.equal(canTransition('cancelled', 'archived'), false);
  // An archived event can still be cancelled — by an admin.
  assert.equal(transitionActor('archived', 'cancelled'), 'admin');
});

test('a restore goes back where the event came from, never past review', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  assert.equal(restoreTarget({ archivedFrom: 'pending_review' }, now), 'draft');
  assert.equal(restoreTarget({ archivedFrom: 'draft' }, now), 'draft');
  assert.equal(restoreTarget({ archivedFrom: 'rejected' }, now), 'rejected');
  assert.equal(restoreTarget({ archivedFrom: 'published', endsAt: '2026-10-01T00:00:00Z' }, now), 'published');
  assert.equal(restoreTarget({ archivedFrom: 'published', endsAt: '2026-09-01T00:00:00Z' }, now), 'completed');
  assert.equal(restoreTarget({ archivedFrom: 'completed' }, now), 'completed');
  // Unknown history is treated as the safest place: a draft.
  assert.equal(restoreTarget({ archivedFrom: null }, now), 'draft');
  for (const target of ['draft', 'rejected', 'published', 'completed']) {
    assert.equal(transitionActor('archived', target), 'organizer');
  }
});

// ── Payment methods ─────────────────────────────────────────────────────────

test('the payment choices follow what the organizer has set up', () => {
  assert.deepEqual(paymentChoices({ stripeReady: true, manualReady: true }), ['both', 'stripe', 'manual']);
  assert.deepEqual(paymentChoices({ stripeReady: true, manualReady: false }), ['stripe']);
  assert.deepEqual(paymentChoices({ stripeReady: false, manualReady: true }), ['manual']);
  assert.deepEqual(paymentChoices({ stripeReady: false, manualReady: false }), []);
});

test('a choice maps onto the two columns, and nonsense maps to neither', () => {
  assert.deepEqual(paymentFlags('both'), { accepts_stripe: true, accepts_manual: true });
  assert.deepEqual(paymentFlags('stripe'), { accepts_stripe: true, accepts_manual: false });
  assert.deepEqual(paymentFlags('manual'), { accepts_stripe: false, accepts_manual: true });
  assert.deepEqual(paymentFlags('cash'), { accepts_stripe: false, accepts_manual: false });
});

test('a ticketed event needs a way to pay that is switched on AND set up', () => {
  const base = { listingType: 'ticketed' };
  assert.equal(paymentReadiness({ ...base, acceptsStripe: false, acceptsManual: false, stripeReady: true, manualReady: true }).reason, 'NO_CHANNEL');
  assert.equal(paymentReadiness({ ...base, acceptsStripe: true, acceptsManual: false, stripeReady: false, manualReady: true }).reason, 'CHANNEL_NOT_READY');
  assert.equal(paymentReadiness({ ...base, acceptsStripe: true, acceptsManual: true, stripeReady: false, manualReady: true }).ok, true);
  assert.equal(paymentReadiness({ ...base, acceptsStripe: true, acceptsManual: false, stripeReady: true, manualReady: false }).ok, true);
});

test('a listing needs no payment method at all', () => {
  assert.equal(paymentReadiness({
    listingType: 'display_only', acceptsStripe: false, acceptsManual: false, stripeReady: false, manualReady: false,
  }).ok, true);
});

test('payment channels can change on a live event without another review', () => {
  const r = editConsequence({ status: 'published', columns: ['accepts_manual'], isAdmin: false });
  assert.deepEqual(r.refused, []);
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
