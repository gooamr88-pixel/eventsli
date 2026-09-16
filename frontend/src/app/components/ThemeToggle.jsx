'use client';

import { useSyncExternalStore } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The theme control.
 *
 * globals.css has always described THREE states — an explicit `data-theme` on
 * <html>, or nothing at all, which leaves `prefers-color-scheme` to decide — and
 * the dark block is guarded with `:not([data-theme="light"])` specifically "so
 * the toggle wins in the other direction too". The toggle it was guarded for did
 * not exist, so half of that CSS had never run: a visitor on a dark laptop could
 * not choose the light theme, and one on a light laptop could not see the dark
 * one at all.
 *
 * So it cycles through three, not two. A two-state switch cannot express
 * "follow the system", and once someone has touched it they can never get back
 * to it — their phone turns dark at sunset and this site is the one that does
 * not follow.
 *
 * WHAT IS STORED is the CHOICE, not the resolved theme. Storing "dark" because
 * the OS was dark on Tuesday means Wednesday's light OS is overridden by a
 * preference the person never expressed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const THEME_KEY = 'es-theme';

const ORDER = ['system', 'light', 'dark'];
const LABEL = { system: 'Theme: match system', light: 'Theme: light', dark: 'Theme: dark' };

/** Exported so the pre-paint script and this component cannot drift apart. */
export function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;
  else delete root.dataset.theme;
}

/**
 * localStorage, as an external store.
 *
 * `useSyncExternalStore` rather than `useState` + an effect that reads storage,
 * and the reason is a rule this codebase enforces: `react-hooks/set-state-in-
 * effect` fails the build on the effect version, because setting state in an
 * effect body is a second render every visitor pays for on every page. This
 * hook is the API React provides for exactly this shape — a value that lives
 * outside React, is not available while rendering on the server, and can change
 * from elsewhere.
 *
 * `getServerSnapshot` is what keeps hydration quiet: the server and the first
 * client render both say "system", and React swaps in the real stored value
 * immediately after hydrating, without ever reporting a mismatch.
 *
 * The `storage` event is in the subscription because the choice is per origin,
 * not per tab. Someone with the dashboard open in two tabs changes the theme in
 * one and the other follows instead of disagreeing until it is reloaded.
 */
const listeners = new Set();

function subscribe(onChange) {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function getSnapshot() {
  // A string is a primitive, so returning a fresh one with the same characters
  // is still `===` — no render loop, which is the trap in this hook.
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return ORDER.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

const getServerSnapshot = () => 'system';

/**
 * The state, so the two renderings of this control cannot drift.
 *
 * There are two, because the sidebar has its own row vocabulary: an icon
 * button in the app bar, and an `.es-nav__item` in the console's sidebar foot.
 * Dropping the icon button into the sidebar would have been one component and
 * one control that visibly did not belong to the list it sat in.
 */
export function useTheme() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function advance() {
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
    // `storage` does not fire in the tab that wrote the value, so this tab is
    // told by hand. Without it the icon keeps the old state until a reload.
    listeners.forEach((l) => l());
  }

  return { current, advance, label: LABEL[current] };
}

export default function ThemeToggle({ className = '' }) {
  const { current, advance } = useTheme();

  return (
    <button
      type="button"
      onClick={advance}
      className={`es-btn es-btn--ghost fx-touch--icon ${className}`}
      // The NAME says the state, because the icon alone cannot: a sun could
      // equally mean "it is light" or "make it light". Live so that a screen
      // reader hears the new state when the button is pressed rather than
      // silence.
      aria-label={LABEL[current]}
      title={LABEL[current]}
    >
      <span aria-live="polite" className="sr-only">{LABEL[current]}</span>
      <ThemeIcon mode={current} />
    </button>
  );
}

/** Decorative — the button carries the name. */
export function ThemeIcon({ mode }) {
  const common = {
    width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true, focusable: 'false',
  };
  if (mode === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </svg>
    );
  }
  if (mode === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    );
  }
  // system — a screen, because the choice is "whatever this device says".
  return (
    <svg {...common}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
