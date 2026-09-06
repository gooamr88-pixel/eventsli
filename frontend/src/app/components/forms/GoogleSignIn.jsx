'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { post } from '../../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Sign in with Google.
 *
 * Google Identity Services hands back an ID TOKEN in the browser, and that
 * token is the only thing that crosses to us. The API verifies its signature
 * against Google's keys and checks the audience — see `googleAuthService.js` —
 * so nothing here is trusted: this component's whole job is to obtain a token
 * and post it.
 *
 * It costs two CSP entries (`accounts.google.com` on script-src and frame-src)
 * and they are in next.config.mjs with a note. The backend's helmet config
 * already sets `crossOriginOpenerPolicy: same-origin-allow-popups`, without
 * which the sign-in popup cannot talk back to the page that opened it.
 *
 * Renders nothing at all when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is unset. A dead
 * Google button on a login form is worse than no button: it looks like the
 * fastest way in and does nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function GoogleSignIn({ onSuccess, onError, text = 'signin_with' }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const holder = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready || !clientId || !holder.current) return;
    const google = window.google?.accounts?.id;
    if (!google) return;

    google.initialize({
      client_id: clientId,
      callback: async (response) => {
        try {
          const user = await post('/auth/google', { idToken: response.credential }, {
            noRedirect: true,
          });
          onSuccess?.(user);
        } catch (err) {
          onError?.(err);
        }
      },
      // One Tap is deliberately off. It appears unprompted over the page and,
      // on a checkout, over the thing someone was in the middle of doing.
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    google.renderButton(holder.current, {
      theme: 'outline',
      size: 'large',
      width: 320,
      text,
    });
  }, [ready, clientId, text, onSuccess, onError]);

  if (!clientId) return null;

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
      {/* Google renders its own button in here and controls its markup, so it
          gets a plain box and no styling of ours to fight with. */}
      <div ref={holder} className="flex justify-center" />
    </>
  );
}
