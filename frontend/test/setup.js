import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * jsdom ships no matchMedia, and some libraries probe it on import.
 *
 * The stub returns `matches: false` for everything — what a server render
 * would see — so a component under test takes the same branch the server does.
 * No app code reads it today; responsive layout is CSS.
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
