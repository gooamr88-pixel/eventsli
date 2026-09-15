/**
 * How a door device's PIN resists guessing.
 *
 * The sign-in limiter is keyed on `ip|deviceId`, and per process without Redis,
 * so rotating addresses bought unlimited guesses once a device id was known —
 * and a four-digit PIN has ten thousand. The lockout is per DEVICE and lives in
 * the database, so it holds across addresses and across workers.
 *
 * A locked device is refused exactly like a wrong PIN (see scanService): the
 * person holding the tablet learns nothing about whether they were close.
 *
 * Pure, so it is testable without a database.
 */
const MAX_PIN_FAILURES = 10;
const PIN_LOCK_MINUTES = 15;

/** New PINs: six to twelve digits. Existing shorter PINs still sign in. */
const NEW_PIN_PATTERN = /^\d{6,12}$/;

function isPinLocked(device, now = new Date()) {
  if (!device?.pin_locked_until) return false;
  const until = new Date(device.pin_locked_until).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

module.exports = { MAX_PIN_FAILURES, PIN_LOCK_MINUTES, NEW_PIN_PATTERN, isPinLocked };
