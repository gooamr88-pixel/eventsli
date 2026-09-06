import { describe, test, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ERRORS, describeError, isSelectionLost, isOrganizerPayoutProblem } from '../src/app/utils/errors';

/**
 * The backend's table is the source of truth. Reading it here rather than
 * copying the list is the whole point: a code added to the API and not to the
 * UI renders as a generic "something went wrong" on a checkout page, and
 * nothing fails until a buyer hits it.
 */
const BACKEND_ENVELOPE = path.join(
  process.cwd(), '..', 'backend', 'utils', 'responseEnvelope.js',
);

function backendCodes() {
  const src = fs.readFileSync(BACKEND_ENVELOPE, 'utf8');
  const block = src.match(/const ERROR_STATUS = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('ERROR_STATUS not found in the backend envelope');
  return [...block[1].matchAll(/^\s{2}([A-Z_]+):\s*\d+/gm)].map((m) => m[1]);
}

describe('error codes', () => {
  test('every code the API can return has a mapping here', () => {
    const missing = backendCodes().filter((code) => !ERRORS[code]);
    expect(
      missing,
      `These codes exist in backend/utils/responseEnvelope.js but not in utils/errors.js.\n`
      + `A buyer hitting one gets "something went wrong" with no way forward:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  test('this file invents no codes the API cannot send', () => {
    // NETWORK is ours: a fetch that never resolved has no API code, and it
    // still needs a title and a recovery.
    const known = new Set([...backendCodes(), 'NETWORK']);
    const invented = Object.keys(ERRORS).filter((c) => !known.has(c));
    expect(invented, `Not reachable from the API: ${invented.join(', ')}`).toEqual([]);
  });

  test('every entry says what to do, not only what happened', () => {
    for (const [code, e] of Object.entries(ERRORS)) {
      expect(e.title, `${code} has no title`).toBeTruthy();
      expect(e.recovery, `${code} has no recovery`).toBeTruthy();
      expect(['fatal', 'retry', 'fix', 'waiting']).toContain(e.tone);
      // An error that ends in a full stop and no instruction leaves the viewer
      // to guess, and on a checkout page they guess "leave".
      expect(e.recovery.length, `${code}'s recovery is too terse to act on`).toBeGreaterThan(15);
    }
  });

  test('an unmapped code falls back loudly, not silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const described = describeError({ code: 'SOMETHING_NEW', message: 'From the server.' });

    expect(described.title).toBe('Something went wrong');
    expect(described.recovery).toBe('From the server.');
    // Silence here is how a code stays unmapped for months.
    expect(warn).toHaveBeenCalledOnce();
  });

  test('a thrown value with no code still renders', () => {
    expect(describeError(new Error('boom')).recovery).toBe('boom');
    expect(describeError(undefined).title).toBe('Something went wrong');
  });

  test('the seat-map codes are the ones that reset a selection', () => {
    expect(isSelectionLost('SEAT_UNAVAILABLE')).toBe(true);
    expect(isSelectionLost('RESERVATION_EXPIRED')).toBe(true);
    // A wrong table password does NOT throw the selection away — the buyer
    // types it again.
    expect(isSelectionLost('TABLE_PASSWORD_INVALID')).toBe(false);
  });

  test('the Stripe codes are flagged as the organizer\'s problem', () => {
    // A buyer told "payment failed" tries another card. These three mean the
    // organizer has not finished connecting a payout account, and no card the
    // buyer owns will change that.
    expect(isOrganizerPayoutProblem('STRIPE_NOT_CONNECTED')).toBe(true);
    expect(isOrganizerPayoutProblem('STRIPE_NOT_ACTIVE')).toBe(true);
    expect(isOrganizerPayoutProblem('STRIPE_NOT_CONFIGURED')).toBe(true);
    expect(isOrganizerPayoutProblem('PAYMENT_REQUIRED')).toBe(false);

    for (const code of ['STRIPE_NOT_CONNECTED', 'STRIPE_NOT_ACTIVE', 'STRIPE_NOT_CONFIGURED']) {
      expect(ERRORS[code].tone, `${code} should read as waiting, not as the buyer's fault`)
        .toBe('waiting');
    }
  });
});
