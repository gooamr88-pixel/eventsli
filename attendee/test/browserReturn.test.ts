import type { AppStateStatus } from 'react-native';

import { watchForReturn } from '../src/lib/browserReturn';

/**
 * Android's Custom Tab: openBrowserAsync resolves when the tab OPENS, so
 * checkout waits for the app to leave the foreground and come back before
 * asking how the payment ended (2026-11-27).
 */
function fakeAppState() {
  const listeners = new Set<(s: AppStateStatus) => void>();
  return {

    addEventListener: (_: 'change', fn: (s: AppStateStatus) => void) => {
      listeners.add(fn);
      return { remove: () => { listeners.delete(fn); } };
    },
    emit: (s: AppStateStatus) => { for (const fn of [...listeners]) fn(s); },
    count: () => listeners.size,
  };
}

const settled = async (p: Promise<void>) => {
  let done = false;
  void p.then(() => { done = true; });
  await Promise.resolve();
  await Promise.resolve();
  return done;
};

it('does not resolve while the app is still in the foreground', async () => {
  const app = fakeAppState();
  const w = watchForReturn(app);
  app.emit('active'); // the tab has not taken over yet
  expect(await settled(w.back)).toBe(false);
  w.cancel();
});

it('resolves once the app has gone to the background and come back', async () => {
  const app = fakeAppState();
  const w = watchForReturn(app);
  app.emit('background'); // the Custom Tab is on top
  expect(await settled(w.back)).toBe(false);
  app.emit('active'); // the person closed it
  expect(await settled(w.back)).toBe(true);
  expect(app.count()).toBe(0);
});

it('cancel stops listening and releases anyone waiting', async () => {
  const app = fakeAppState();
  const w = watchForReturn(app);
  w.cancel();
  expect(await settled(w.back)).toBe(true);
  expect(app.count()).toBe(0);
});
