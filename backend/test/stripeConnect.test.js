const { test } = require('node:test');
const assert = require('node:assert/strict');

const { translateConnectError } = require('../services/stripeErrors');

/**
 * Stripe's configuration refusals arrive as a paragraph of documentation links
 * inside a 400. Left raw they reach the organizer as "something went wrong" and
 * the logs as noise — while the actual fix is one switch in a Dashboard nobody
 * thought to open.
 *
 * These pin the translation, using the real message text Stripe returns.
 */

test('the Accounts v1 refusal becomes an instruction', () => {
  // Verbatim from Stripe, 2026-08.
  const raw = new Error(
    'Stripe no longer recommends Accounts v1 for new Connect integrations. '
    + 'Create connected accounts with POST /v2/core/accounts instead: '
    + 'https://docs.stripe.com/api/v2/core/accounts. Read more about Accounts v2: '
    + 'https://docs.stripe.com/connect/accounts-v2/account-creation. If your integration '
    + 'requires v1 account creation for a supported compatibility scenario, enable '
    + 'Accounts v1 support in the Dashboard.',
  );

  const err = translateConnectError(raw);

  assert.equal(err.code, 'STRIPE_NOT_CONFIGURED');
  assert.equal(err.operatorAction, true, 'must be marked as something a human must go and do');
  // The message has to carry the exact page to open. "Check your Stripe
  // settings" is not an instruction.
  assert.match(err.message, /feat_accounts_v1_support/);
  assert.match(err.message, /Enable "Accounts v1 support"/);
});

test('REGRESSION T-073: the losses-collector refusal points at the platform profile, not the v1 toggle', () => {
  // Verbatim from Stripe test mode, 2026-11-06. It contains "Accounts v1", so
  // it used to receive the v1-toggle instruction, which does not fix it.
  const raw = new Error(
    'You tried to create an Accounts v1 connected account using the legacy `type` field with '
    + 'your platform as the losses collector. Use Accounts v2, remove `type`, and set '
    + '`losses_collector` to `stripe`, then retry your request.',
  );
  const err = translateConnectError(raw);

  assert.equal(err.code, 'STRIPE_NOT_CONFIGURED');
  assert.equal(err.operatorAction, true);
  assert.match(err.message, /settings\/connect\/platform-profile/);
  assert.doesNotMatch(err.message, /Accounts v1 support/);
  assert.equal(err.cause, raw, 'the original stays attached for the logs');
});

test('a Connect-not-enabled refusal points at the Connect settings', () => {
  const raw = new Error('Connect is not enabled for this account.');
  const err = translateConnectError(raw);

  assert.equal(err.code, 'STRIPE_NOT_CONFIGURED');
  assert.match(err.message, /dashboard\.stripe\.com\/connect/);
});

test('an ordinary Stripe error passes through untouched', () => {
  // Translating everything would bury real failures — a declined card is not a
  // configuration problem and must not be reported as one.
  const raw = Object.assign(new Error('Your card was declined.'), { code: 'card_declined' });
  const err = translateConnectError(raw);

  assert.equal(err, raw, 'the original error object, not a copy');
  assert.equal(err.code, 'card_declined');
});

test('a missing or malformed error does not throw', () => {
  for (const input of [null, undefined, {}, new Error('')]) {
    const err = translateConnectError(input);
    assert.equal(err, input, 'nothing to translate, nothing changed');
  }
});

test('STRIPE_NOT_CONFIGURED is a 503, not a client error', () => {
  const { ERROR_STATUS } = require('../utils/responseEnvelope');
  // The organizer did nothing wrong and can do nothing about it. A 4xx would
  // put the blame — and the troubleshooting — on the wrong person.
  assert.equal(ERROR_STATUS.STRIPE_NOT_CONFIGURED, 503);
  assert.equal(ERROR_STATUS.STRIPE_NOT_CONNECTED, 403, 'this one IS the organizer\'s to fix');
});
