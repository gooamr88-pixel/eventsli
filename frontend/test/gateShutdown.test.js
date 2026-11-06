import { test, expect } from 'vitest';
import { shutdown } from '../src/app/gate/useScanner';

/**
 * REGRESSION (TECH-AUDIT-LOG T-033): html5-qrcode 2.3.8's `stop()` throws
 * SYNCHRONOUSLY when the engine is not running. The cleanup used
 * `instance.stop().then(…).catch(…)`, so the throw escaped and the gate fell
 * through to its error page when "Stop the camera" was pressed after the camera
 * had failed to start.
 */
function engine({ running }) {
  const calls = [];
  return {
    calls,
    stop() {
      calls.push('stop');
      // Exactly what the library does: a thrown string, not a rejection.
      if (!running) throw 'Cannot stop, scanner is not running or paused.';
      running = false;
      return Promise.resolve();
    },
    clear() { calls.push('clear'); },
  };
}

test('a scanner that never started is shut down without throwing', async () => {
  const e = engine({ running: false });
  await expect(shutdown(e)).resolves.toBeUndefined();
  expect(e.calls).toEqual(['stop', 'clear']);
});

test('a running scanner is stopped, then cleared', async () => {
  const e = engine({ running: true });
  await shutdown(e);
  expect(e.calls).toEqual(['stop', 'clear']);
});

test('a stop that rejects, or a clear that throws, is swallowed too', async () => {
  const e = {
    stop: () => Promise.reject(new Error('stream gone')),
    clear: () => { throw new Error('already cleared'); },
  };
  await expect(shutdown(e)).resolves.toBeUndefined();
});

test('no engine is a no-op', async () => {
  await expect(shutdown(null)).resolves.toBeUndefined();
});

test('the premise: the library really does throw synchronously', async () => {
  const { Html5Qrcode } = await import('html5-qrcode');
  const src = Html5Qrcode.prototype.stop.toString();
  expect(src).toMatch(/throw\s+["']Cannot stop/);
});
