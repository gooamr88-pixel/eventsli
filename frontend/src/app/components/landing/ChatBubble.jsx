'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NavIcon from '../shell/NavIcon';

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

  useEffect(() => {
    let closed = false;
    try { closed = window.sessionStorage.getItem(KEY) === '1'; } catch { /* storage blocked */ }
    if (closed) return undefined;
    const timer = setTimeout(() => setNoteOpen(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  function closeNote() {
    setNoteOpen(false);
    try { window.sessionStorage.setItem(KEY, '1'); } catch { /* storage blocked */ }
  }

  return (
    <div className="es-lp-chat fx-safe-bottom">
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
