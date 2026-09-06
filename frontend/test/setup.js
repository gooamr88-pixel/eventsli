import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * jsdom ships no matchMedia, and useMediaQuery reads it on every render.
 *
 * The stub returns `matches: false` for everything, which is exactly the
 * server snapshot the hooks are written against — so a component under test
 * takes the same branch the server does, and a test that passes here is
 * testing the markup a crawler actually receives.
 *
 * A test that needs the other branch overrides window.matchMedia itself.
 */
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
