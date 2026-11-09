import fs from 'node:fs';
import path from 'node:path';

import { admits, describeScan, OUTCOME_KEYS, screenResult } from '../src/gate/outcomes';

/**
 * THE CONTRACT. A scan result is not an HTTP error — it arrives inside a 200,
 * in a field called `result` — so nothing else in the app would notice a new
 * one. If the door renders an unmapped value as "unrecognised", the operator
 * does not know whether to let the person in.
 *
 * So the values are read out of the backend that emits them: every migration
 * defining a check-in function, and the scan service. The same arrangement as
 * the web gate's frontend/test/gateOutcomes.test.js.
 */
const ROOT = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const SERVICES = ['scanService.js', 'doorService.js'].map((f) => path.join(ROOT, 'backend', 'services', f));

function backendResults(): string[] {
  const sql = fs.readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    .filter((s) => /FUNCTION\s+(check_in_ticket|undo_check_in)/.test(s))
    .join('\n');
  const js = SERVICES.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const found = new Set<string>();
  for (const m of sql.matchAll(/'result',\s*'([a-z_]+)'/g)) found.add(m[1]);
  for (const m of sql.matchAll(/v_refusal\s*:=\s*'([a-z_]+)'/g)) found.add(m[1]);
  for (const m of js.matchAll(/result:\s*'([a-z_]+)'/g)) found.add(m[1]);
  return [...found].sort();
}

describe('scan outcomes', () => {
  test('the extraction finds the backend’s results at all', () => {
    const results = backendResults();
    expect(results.length).toBeGreaterThan(8);
    for (const known of ['admitted', 'duplicate', 'transferred', 'event_not_open', 'scanner_locked']) {
      expect(results).toContain(known);
    }
  });

  test('every result the API can return has a screen in the app', () => {
    const missing = backendResults().filter((r) => !OUTCOME_KEYS.includes(r));
    expect(missing).toEqual([]);
  });

  test('only an admission opens the door — the server\'s, or the phone\'s own offline — and only it looks like it does', () => {
    const opening = ['admitted', 'offline_admitted'];
    for (const key of OUTCOME_KEYS) {
      expect(admits(key)).toBe(opening.includes(key));
      expect(describeScan(key).tone === 'admit').toBe(opening.includes(key));
    }
  });

  test('a held scan is not dressed up as a decision, and neither is a ticket the phone could not confirm', () => {
    expect(describeScan('queued').tone).toBe('hold');
    expect(admits('queued')).toBe(false);
    expect(describeScan('offline_unconfirmed').tone).toBe('warn');
    expect(admits('offline_unconfirmed')).toBe(false);
  });

  test('a record shows what it is: settled, admitted offline, unconfirmed, or held', () => {
    expect(screenResult({ state: 'done', result: 'void' })).toBe('void');
    expect(screenResult({ state: 'queued', result: 'admitted', offlineVerdict: 'admitted' })).toBe('offline_admitted');
    expect(screenResult({ state: 'queued', result: null, offlineVerdict: 'unconfirmed' })).toBe('offline_unconfirmed');
    expect(screenResult({ state: 'queued', result: null, offlineVerdict: 'held' })).toBe('queued');
    expect(screenResult({ state: 'queued', result: null, offlineVerdict: null })).toBe('queued');
    expect(screenResult(undefined)).toBe('sending');
  });

  test('an unknown result is refused loudly, never admitted', () => {
    const o = describeScan('some_future_result');
    expect(o.known).toBe(false);
    expect(o.tone).not.toBe('admit');
    expect(admits('some_future_result')).toBe(false);
  });
});
