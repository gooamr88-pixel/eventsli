'use client';

import { useEffect } from 'react';
import { rememberGuestOf } from '../../lib/guestOf';

/**
 * A host's own link — `/e/<slug>?guestof=the-groom` — remembered for this
 * event, so the checkout picks that host for the buyer (2026-11-23,
 * lib/guestOf.js). Renders nothing.
 */
export default function GuestOfCapture({ slug }) {
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get('guestof');
      if (code) rememberGuestOf(slug, code.toLowerCase());
    } catch {
      // No URL API or no storage: the checkout asks with nothing picked.
    }
  }, [slug]);
  return null;
}
