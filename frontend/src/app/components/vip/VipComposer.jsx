'use client';

import { useEffect, useId, useState } from 'react';
import NavIcon from '../shell/NavIcon';

/**
 * Write a message (2026-11-28). Enter adds a line; Ctrl/⌘ + Enter sends, as
 * in WhatsApp Web. `hint` says where it will go ("Goes on WhatsApp…").
 * `onSend(text)` resolves true when sent; the box empties then.
 */
export default function VipComposer({ onSend, hint, placeholder = 'Write a message…', disabled = false, label = 'Message', sendLabel = 'Send' }) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const ok = await onSend(t);
    setBusy(false);
    if (ok) setText('');
  }

  return (
    <div className="es-vipcompose">
      <label htmlFor={id} className="sr-only">{label}</label>
      <textarea
        id={id}
        className="es-input es-vipcompose__box"
        rows={3}
        maxLength={4000}
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
        }}
      />
      <div className="es-vipcompose__bar">
        {hint ? <p className="es-vipcompose__hint">{hint}</p> : <span />}
        <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={send} disabled={disabled || busy || !text.trim()}>
          <NavIcon name="send" size={16} /> {busy ? 'Sending…' : sendLabel}
        </button>
      </div>
    </div>
  );
}

/** Ask again every `ms` and whenever the tab comes back into view. */
export function usePolling(reload, ms = 20_000) {
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, ms);
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [reload, ms]);
}
