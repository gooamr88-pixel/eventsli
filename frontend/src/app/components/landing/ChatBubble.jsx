'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import NavIcon from '../shell/NavIcon';
import AssistantPanel from '../assistant/AssistantPanel';
import { get } from '../../utils/apiClient';

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
 * IT OPENS THE EVENTSLI ASSISTANT WHEN THERE IS ONE, AND THE CONTACT PAGE
 * WHEN THERE IS NOT. The assistant (components/assistant) answers from the
 * platform's own facts and live events, and keeps a person one tap away.
 * Without it — AI switched off on this deployment, or the API unreachable —
 * this is exactly what it was: a link that says "send us a message", because
 * a widget that looks like a chat and answers nobody is a broken promise.
 * `/public/assistant` decides; until it answers, the link is the default.
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
  const [ai, setAi] = useState(false);
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const scrolled = useSyncExternalStore(subscribeScroll, pastHero, () => false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const status = await get('/public/assistant', { noRedirect: true });
        if (live) setAi(Boolean(status?.ai));
      } catch { /* the contact link stays */ }
    })();
    return () => { live = false; };
  }, []);

  function openAssistant() {
    closeNote();
    setOpen(true);
  }

  function closeAssistant() {
    setOpen(false);
    // Back to the button that opened it, as a dialog's close should.
    requestAnimationFrame(() => button.current?.focus());
  }

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
    <div className="es-lp-chat fx-safe-bottom" data-scrolled={scrolled || open ? 'true' : 'false'} data-open={open ? 'true' : 'false'}>
      {open && <AssistantPanel onClose={closeAssistant} />}

      {noteOpen && !open && (
        <div className="es-lp-chat__note" role="status">
          <span aria-hidden className="es-lp-chat__avatar"><NavIcon name={ai ? 'sparkle' : 'chat'} size={20} /></span>
          {ai ? (
            <button type="button" className="es-lp-chat__text text-left" onClick={openAssistant}>
              Hi! Looking for an event or have a question? <b>Ask our AI assistant.</b>
            </button>
          ) : (
            <Link href="/contact" className="es-lp-chat__text">
              Hi there! Have a question? <b>Send us a message.</b>
            </Link>
          )}
          <button type="button" onClick={closeNote} className="es-lp-chat__close">
            <span aria-hidden><NavIcon name="close" size={16} /></span>
            <span className="sr-only">Close</span>
          </button>
        </div>
      )}

      {ai ? (
        <button
          ref={button} type="button" className="es-lp-chat__button" aria-expanded={open}
          onClick={() => (open ? closeAssistant() : openAssistant())}
        >
          <span aria-hidden><NavIcon name={open ? 'close' : 'chat'} size={26} /></span>
          {!open && <span aria-hidden className="es-lp-chat__badge"><NavIcon name="sparkle" size={12} /></span>}
          <span className="sr-only">{open ? 'Close the Eventsli assistant' : 'Ask the Eventsli assistant'}</span>
        </button>
      ) : (
        <Link href="/contact" className="es-lp-chat__button">
          <span aria-hidden><NavIcon name="chat" size={26} /></span>
          <span className="sr-only">Contact us</span>
        </Link>
      )}
    </div>
  );
}
