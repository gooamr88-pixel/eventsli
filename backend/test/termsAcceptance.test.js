const { test } = require('node:test');
const assert = require('node:assert/strict');

// From eventRules, not eventService — no database, no environment.
const { termsAcceptedFor, TERMS_ACCEPTABLE_FROM, canTransition } = require('../services/eventRules');

/**
 * REGRESSION — "I accepted the terms and nothing happened".
 *
 * The dashboard decides whether to show the terms step or the Submit button
 * from `review.termsAccepted`, which is `termsAcceptedFor(event, current)`.
 * It used to be `!!terms_accepted_id`, a column only `submit` wrote, so an
 * accepted draft still read as not accepted and Submit stayed locked forever.
 * The integration half of this (accept → GET shows it) is in
 * integration/eventLifecycle.test.js.
 */

const CURRENT = '11111111-1111-4111-8111-111111111111';
const OLDER = '22222222-2222-4222-8222-222222222222';

test('a draft stamped with the current terms version reads as accepted', () => {
  assert.equal(termsAcceptedFor({ status: 'draft', terms_accepted_id: CURRENT }, CURRENT), true);
  assert.equal(termsAcceptedFor({ status: 'rejected', terms_accepted_id: CURRENT }, CURRENT), true);
});

test('a draft with no stamp reads as not accepted', () => {
  assert.equal(termsAcceptedFor({ status: 'draft', terms_accepted_id: null }, CURRENT), false);
  assert.equal(termsAcceptedFor({ status: 'draft' }, CURRENT), false);
  assert.equal(termsAcceptedFor(null, CURRENT), false);
});

test('before submission an OLDER version does not count — submit would refuse it', () => {
  // Showing Submit here would be the same dead end in a new place: the button
  // is enabled, and the API answers TERMS_NOT_ACCEPTED.
  assert.equal(termsAcceptedFor({ status: 'draft', terms_accepted_id: OLDER }, CURRENT), false);
  assert.equal(termsAcceptedFor({ status: 'rejected', terms_accepted_id: OLDER }, CURRENT), false);
});

test('after submission the version accepted at the time stands', () => {
  for (const status of ['pending_review', 'published', 'suspended', 'cancelled', 'completed']) {
    assert.equal(termsAcceptedFor({ status, terms_accepted_id: OLDER }, CURRENT), true, status);
  }
});

test('with the current version unknown, any stamp counts and submit stays the authority', () => {
  assert.equal(termsAcceptedFor({ status: 'draft', terms_accepted_id: OLDER }, null), true);
});

test('terms can be accepted exactly where an event can be submitted from', () => {
  // If these drift, the page offers an Accept button on an event that cannot
  // be submitted, or no Accept button on one that can.
  for (const status of ['draft', 'pending_review', 'rejected', 'published', 'suspended', 'cancelled', 'completed']) {
    assert.equal(
      TERMS_ACCEPTABLE_FROM.includes(status),
      canTransition(status, 'pending_review'),
      status,
    );
  }
});
