const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPinLocked, NEW_PIN_PATTERN, MAX_PIN_FAILURES, PIN_LOCK_MINUTES } = require('../utils/pinLockout');

const now = new Date('2026-09-15T20:00:00Z');

test('a device is locked only while its lock is in the future', () => {
  assert.equal(isPinLocked({ pin_locked_until: '2026-09-15T20:10:00Z' }, now), true);
  assert.equal(isPinLocked({ pin_locked_until: '2026-09-15T19:59:59Z' }, now), false);
  assert.equal(isPinLocked({ pin_locked_until: null }, now), false);
  assert.equal(isPinLocked(null, now), false);
  assert.equal(isPinLocked({ pin_locked_until: 'not a date' }, now), false);
});

test('new PINs are six to twelve digits', () => {
  for (const ok of ['482193', '000000', '123456789012']) assert.match(ok, NEW_PIN_PATTERN);
  for (const bad of ['4821', '12345', 'abcdef', '1234567890123', '12 3456']) {
    assert.doesNotMatch(bad, NEW_PIN_PATTERN, bad);
  }
});

test('the lockout is strict enough to matter and short enough for a door', () => {
  // Ten guesses per fifteen minutes is under a thousand a day against a
  // million six-digit PINs.
  assert.ok(MAX_PIN_FAILURES <= 10);
  assert.ok(PIN_LOCK_MINUTES >= 10 && PIN_LOCK_MINUTES <= 30);
});

// Short PINs are retired (owner, 2026-11-20): flagged always, refused from SHORT_PIN_CUTOFF.
const { isShortPin, shortPinCutoff, shortPinRefused } = require('../utils/pinLockout');

test('a PIN under six digits is short', () => {
  for (const pin of ['1234', '12345']) assert.equal(isShortPin(pin), true, pin);
  for (const pin of ['123456', '123456789012']) assert.equal(isShortPin(pin), false, pin);
});

test('short PINs are refused only from the cutoff, and never without one', () => {
  const at = Date.parse('2026-12-01T00:00:00Z');
  assert.equal(shortPinCutoff({}), null);
  assert.equal(shortPinCutoff({ SHORT_PIN_CUTOFF: 'soon' }), null, 'an unreadable date refuses nobody');
  assert.equal(shortPinRefused('1234', at, {}), false, 'no cutoff: flagged, still signs in');
  assert.equal(shortPinRefused('1234', at - 1, { SHORT_PIN_CUTOFF: '2026-12-01T00:00:00Z' }), false);
  assert.equal(shortPinRefused('1234', at, { SHORT_PIN_CUTOFF: '2026-12-01T00:00:00Z' }), true);
  assert.equal(shortPinRefused('123456', at, { SHORT_PIN_CUTOFF: '2026-12-01T00:00:00Z' }), false);
});
