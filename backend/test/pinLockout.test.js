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
