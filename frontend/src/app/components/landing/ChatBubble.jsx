'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ON A PHONE: NO NOTE BY ITSELF, AND NO BUTTON OVER THE HERO.
 *
 * At 320–360px the note opened 1.5 seconds after load straight over "Start
 * selling" and "Browse events", and the round button sat on the hero search's
 * blue Search button — so the first screen had no action that could be used
 * without dismissing something first. Below 40rem the note never opens on its
 * own, and the button waits until the visitor has scrolled past the first
 * screen. Wider than that, both behave exactly as before.
 *
 * The scroll position is read with `useSyncExternalStore`, as the masthead
 * reads it, so there is no setState inside a scroll listener. The server
 * snapshot is `false`: the button starts hidden on a phone and appears once
 * the page moves, which is the direction a late appearance should go.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PHONE = '(max-width: 39.98rem)';
const PAST_HERO_PX = 480;

function subscribeScroll(onChange) {
  window.addEventListener('scroll', onChange, { passive: true });
  return () => window.removeEventListener('scroll', onChange);
}
const pastHero = () => window.scrollY > PAST_HERO_PX;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The round green button in the corner, and the "have a question?" note.
 *
 * IT OPENS THE CONTACT PAGE, NOT A CHAT. There is no live chat behind this
 * product, and a widget that looks like one and answers nobody is a broken
 * promise. The wording says "send us a message", which is what happens.
 *
 * The note appears after a short delay and, once closed, stays closed for the
 * rest of the visit. sessionStorage is a convenience here, so every access is
 * guarded — it throws in some private modes, and the fallback is simply that
 * the note comes back on the next page load.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const KEY = 'es-chat-note-closed';

export default function ChatBubble() {
  const [noteOpen, setNoteOpen] = useState(false);
  const scrolled = useSyncExternalStore(subscribeScroll, pastHero, () => false);

  useEffect(() => {
    let closed = false;
    try { closed = window.sessionStorage.getItem(KEY) === '1'; } catch { /* storage blocked */ }
    if (closed) return undefined;
    // Never by itself on a phone — see the note at the top of this file.
    try { if (window.matchMedia(PHONE).matches) return undefined; } catch { /* old engine: behave as before */ }
    const timer = setTimeout(() => setNoteOpen(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  function closeNote() {
    setNoteOpen(false);
    try { window.sessionStorage.setItem(KEY, '1'); } catch { /* storage blocked */ }
  }

  return (
    <div className="es-lp-chat fx-safe-bottom" data-scrolled={scrolled ? 'true' : 'false'}>
      {noteOpen && (
        <div className="es-lp-chat__note" role="status">
          <span aria-hidden className="es-lp-chat__avatar"><NavIcon name="chat" size={20} /></span>
          <Link href="/contact" className="es-lp-chat__text">
            Hi there! Have a question? <b>Send us a message.</b>
          </Link>
          <button type="button" onClick={closeNote} className="es-lp-chat__close">
            <span aria-hidden><NavIcon name="close" size={16} /></span>
            <span className="sr-only">Close</span>
          </button>
        </div>
      )}

      <Link href="/contact" className="es-lp-chat__button">
        <span aria-hidden><NavIcon name="chat" size={26} /></span>
        <span className="sr-only">Contact us</span>
      </Link>
    </div>
  );
}
