import { LogBox, Platform } from 'react-native';

import type { AppSession } from '../api/types';

/**
 * RENDERING THE APP OFF-SCREEN TO COMPARE IT WITH THE MOCKUP (2026-11-28).
 *
 * The owner's board is matched frame by frame by rendering the WEB build at
 * phone size against a local fixture API. The signed-in frames (My Tickets,
 * Saved, Profile, Checkout) need an account and a hold, which a browser has
 * no Keychain to keep, so a URL with `?demo=signedin` seeds them.
 *
 * Development web builds only: `__DEV__` is false in every store build, and
 * the check is also limited to the web, so a phone never reads it.
 *
 *   ?demo=signedin   a signed-in account, city Cairo, a hold for checkout
 *   ?demo=fresh      first launch: no account, welcome not yet seen
 *   ?demo=splash     the launch frame held on screen (ui/LaunchSplash.tsx)
 *   ?demo=browse     signed out, welcome seen, no city chosen (a new user's Home)
 */
export function renderDemoMode(): 'signedin' | 'fresh' | 'splash' | 'browse' | null {
  if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const mode = new URLSearchParams(window.location.search).get('demo');
  return mode === 'signedin' || mode === 'fresh' || mode === 'splash' || mode === 'browse' ? mode : null;
}

type DemoSession = { account: AppSession | null; onboarded: boolean; city: { city: string; country: string } | null };

/** What session.hydrate uses instead of the (absent) Keychain, in a render. */
export function renderDemoSession(): DemoSession | null {
  const mode = renderDemoMode();
  if (!mode) return null;
  // The development error toasts would cover the tab bar in every frame.
  LogBox.ignoreAllLogs(true);
  if (mode === 'browse') return { account: null, onboarded: true, city: null };
  if (mode === 'fresh' || mode === 'splash') return { account: null, onboarded: false, city: { city: 'Cairo', country: 'EG' } };
  return {
    account: {
      token: 'render-demo',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: 'u1', email: 'yousef@email.com', fullName: 'Yousef Amr', role: 'attendee', accountTypes: ['attendee'] },
    },
    onboarded: true,
    city: { city: 'Cairo', country: 'EG' },
  };
}

/** The hold the Checkout frame shows. */
export function renderDemoHold() {
  if (renderDemoMode() !== 'signedin') return null;
  return {
    reservationId: 'res-demo', reservationToken: 'demo', expiresAt: new Date(Date.now() + 540_000).toISOString(),
    seatCount: 2, subtotalCents: 320000, currency: 'EGP', tableLabel: null, slug: 'music-festival-2026', eventTitle: 'Music Festival 2026',
  };
}
