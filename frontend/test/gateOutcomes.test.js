import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OUTCOME_KEYS, describeScan, admits, doorTime } from '../src/app/gate/scanOutcome';

/**
 * The same arrangement as errorCodes.test.js, for the same reason.
 *
 * A scan result is not an HTTP error — it comes back inside a 200, in a field
 * called `result` — so it misses the error table entirely. If the door renders
 * an unmapped one as "something went wrong", the operator has no idea whether
 * to let the person in, and the only signal that the value existed at all is
 * somebody standing at a gate.
 *
 * So the values are read out of the SQL and the service that emit them.
 */
const ROOT = path.join(process.cwd(), '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const SCAN_SERVICE = path.join(ROOT, 'backend', 'services', 'scanService.js');

/**
 * Every migration that defines a check-in function — not one named file. v1
 * lived in 20260830000000_checkin.sql; v2 (transfers, closed events) arrived in
 * a later one, and a test pinned to the first file would never see it.
 */
function checkinSql() {
  return fs.readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    .filter((sql) => /FUNCTION\s+(check_in_ticket|undo_check_in)/.test(sql))
    .join('\n');
}

/**
 * `'result', 'admitted'` in the SQL, `result: 'invalid'` in the service, and
 * `v_refusal := 'transferred'` — v2 picks a refusal first and returns it once.
 */
function backendResults() {
  const sql = checkinSql();
  const js = fs.readFileSync(SCAN_SERVICE, 'utf8');

  const found = new Set();
  for (const m of sql.matchAll(/'result',\s*'([a-z_]+)'/g)) found.add(m[1]);
  for (const m of sql.matchAll(/v_refusal\s*:=\s*'([a-z_]+)'/g)) found.add(m[1]);
  for (const m of js.matchAll(/result:\s*'([a-z_]+)'/g)) found.add(m[1]);
  return [...found].sort();
}

describe('scan outcomes', () => {
  test('the backend really does emit a set of results', () => {
    // A guard on the guard. If the extraction above ever stops matching — a
    // reformat, a rename — the drift test below would pass on an empty list and
    // prove nothing.
    const results = backendResults();
    expect(results.length).toBeGreaterThan(6);
    expect(results).toContain('admitted');
    expect(results).toContain('duplicate');
    expect(results).toContain('scanner_locked');
    // And v2's refusals, which only the `v_refusal` pattern finds.
    expect(results).toContain('transferred');
    expect(results).toContain('event_not_open');
  });

  test('every result the API can return has a screen for it', () => {
    const missing = backendResults().filter((r) => !OUTCOME_KEYS.includes(r));
    expect(
      missing,
      'These `result` values are emitted by the backend but have no entry in '
      + `gate/scanOutcome.js:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  test('only `admitted` opens the door', () => {
    for (const key of OUTCOME_KEYS) {
      expect(admits(key), `${key} must not admit`).toBe(key === 'admitted');
      expect(describeScan(key).tone === 'admit', `${key} must not look like an admission`)
        .toBe(key === 'admitted');
    }
  });

  test('a queued scan is not dressed up as a decision', () => {
    // The one that matters offline: nothing was decided, and the screen must
    // not imply otherwise by being green.
    expect(describeScan('queued').tone).toBe('hold');
    expect(admits('queued')).toBe(false);
  });

  test('an unknown result is refused, loudly, rather than admitted', () => {
    const unknown = describeScan('some_future_result');
    expect(unknown.known).toBe(false);
    expect(unknown.tone).not.toBe('admit');
    expect(admits('some_future_result')).toBe(false);
  });

  test('every outcome says what to do, not only what happened', () => {
    for (const key of OUTCOME_KEYS) {
      const o = describeScan(key);
      expect(o.title, `${key} has no title`).toBeTruthy();
      expect(['admit', 'refuse', 'warn', 'hold']).toContain(o.tone);
    }
  });

  test('a time renders as hours and minutes, and a missing one renders as nothing', () => {
    expect(doorTime('2026-09-05T19:04:00.000Z')).toMatch(/\d{1,2}[:.]\d{2}/);
    expect(doorTime(null)).toBe('');
    // `new Date('not-a-date')` is NaN here, but V8 accepts a lot of near-misses
    // — the guard is on the parsed value, not on the shape of the string.
    expect(doorTime('not a date at all')).toBe('');
  });
});
