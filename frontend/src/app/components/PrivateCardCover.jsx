'use client';

import { useState } from 'react';
import { PUBLIC_API_URL } from '../utils/apiClient';
import NavIcon from './shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A PRIVATE EVENT'S ARTWORK ON A LISTING CARD (owner, 2026-11-23): listed on
 * the homepage and /events, but blurred — "nobody can see the details, only
 * the organizer name, the date and the event name".
 *
 * The API never sends a hidden cover's URL to a listing. The picture is the
 * same 24-pixel copy the locked event page uses (`/locked-cover`), stretched
 * and blurred here, so "open image in new tab" shows a smudge of colour and
 * nothing else. With no cover, or if that copy fails, a coral wash with the
 * lock stands in. A cover the organizer chose to show (`coverUrl`) is drawn
 * blurred too, so every private card reads the same at a glance.
 *
 * Fills its card's media box (both cards' boxes are positioned).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PrivateCardCover({ event }) {
  const [failed, setFailed] = useState(false);
  /**
   * "PASSWORD BOX ONLY" IS NOT BLURRED (owner, 2026-11-24: "I chose password,
   * why is it blurred?"). The blur belongs to the blurred preview. A
   * password-box event shows the cover it chose to show, sharp, or a plain
   * card with the lock — never the blurred stand-in.
   */
  const plain = event.lockedPreview === 'card';
  const src = event.coverUrl
    || (!plain && event.blurredCover ? `${PUBLIC_API_URL}/public/events/${encodeURIComponent(event.slug)}/locked-cover` : null);

  return (
    <span className={`es-privcover${plain ? ' es-privcover--card' : ''}`} aria-hidden="true">
      {src && !failed ? (
        // A tiny, blurred copy — Next's optimiser would only enlarge it.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="es-privcover__img" src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className="es-privcover__wash" />
      )}
      <span className="es-privcover__lock"><NavIcon name="lock" size={28} /></span>
    </span>
  );
}
