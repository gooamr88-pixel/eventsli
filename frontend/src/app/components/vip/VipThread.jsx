'use client';

import { useEffect, useRef, useState } from 'react';
import { get } from '../../utils/apiClient';
import { useNowMinute } from '../../hooks/useNowMinute';
import NavIcon from '../shell/NavIcon';
import SocialIcon from '../vendors/booking/SocialIcon';
import { when } from './vipStatus';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One VIP request's conversation (2026-11-28), whichever channel each message
 * went by: WhatsApp (both ways, with Meta's ticks), the dashboard, email, and
 * the request's own events ("Status: Confirmed").
 *
 * `viewer` is whose screen this is: their own messages sit on the right.
 * `mediaBase` is where a WhatsApp photo or file is fetched from — the API
 * proxies it (Meta's links need our token), loaded only when asked for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CHANNEL = {
  whatsapp: { label: 'WhatsApp', icon: null },
  dashboard: { label: 'Dashboard', icon: 'monitor' },
  email: { label: 'Email', icon: 'mail' },
};

function Ticks({ status }) {
  if (!status) return null;
  if (status === 'failed') return <span className="es-vipmsg__tick is-failed" title="Not delivered on WhatsApp"><NavIcon name="alert" size={14} /></span>;
  const label = { queued: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read' }[status];
  return (
    <span className={`es-vipmsg__tick is-${status}`} title={label} aria-label={label}>
      {status === 'queued' ? <NavIcon name="clock" size={13} /> : (
        <svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true">
          <path d="M1 6.5l3.2 3.2L11 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          {status !== 'sent' && <path d="M7.5 9.2l.5.5L15 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
      )}
    </span>
  );
}

function Media({ message, mediaBase, mediaQuery = '' }) {
  const [state, setState] = useState({ url: null, loading: false, error: null });
  const m = message.media;
  useEffect(() => () => { if (state.url) URL.revokeObjectURL(state.url); }, [state.url]);
  if (!m) return null;
  const label = { image: 'Photo', video: 'Video', audio: m.mimeType?.includes('ogg') ? 'Voice note' : 'Audio', document: m.filename || 'Document', sticker: 'Sticker' }[m.type] || 'File';
  if (!m.available || !mediaBase) {
    return <span className="es-vipmsg__file"><NavIcon name="fileText" size={16} />{label} — open it in WhatsApp</span>;
  }
  async function load() {
    setState({ url: null, loading: true, error: null });
    try {
      const blob = await get(`${mediaBase}/${message.id}${mediaQuery}`, { noRedirect: true });
      const url = URL.createObjectURL(blob);
      if (m.type === 'document') {
        const a = document.createElement('a');
        a.href = url; a.download = m.filename || 'whatsapp-file'; a.click();
        setState({ url, loading: false, error: null });
        return;
      }
      setState({ url, loading: false, error: null });
    } catch {
      setState({ url: null, loading: false, error: 'It could not be loaded. Open it in WhatsApp.' });
    }
  }
  if (state.url && (m.type === 'image' || m.type === 'sticker')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={state.url} alt={message.body || label} className="es-vipmsg__img" />;
  }
  if (state.url && m.type === 'video') return <video src={state.url} controls className="es-vipmsg__img" />;
  if (state.url && m.type === 'audio') return <audio src={state.url} controls className="es-vipmsg__audio" />;
  return (
    <span className="fx-stack fx-stack--sm">
      <button type="button" className="es-vipmsg__file is-button" onClick={load} disabled={state.loading}>
        <NavIcon name={m.type === 'image' ? 'image' : m.type === 'document' ? 'download' : 'play'} size={16} />
        {state.loading ? 'Loading…' : m.type === 'document' ? `Download ${label}` : `Show ${label.toLowerCase()}`}
      </button>
      {state.error && <small className="text-danger">{state.error}</small>}
    </span>
  );
}

/**
 * The name over a bubble. The team sees who on the team wrote (or "WhatsApp
 * app" for the business phone); an organizer sees a first name and Eventsli.
 */
export function whoWrote(m, viewer) {
  if (m.author === 'organizer') return viewer === 'organizer' ? 'You' : (m.authorName || 'Organizer');
  if (m.author === 'system') return 'Eventsli';
  if (viewer === 'team') return m.authorName || 'Eventsli team';
  const named = m.authorName && !m.authorName.startsWith('Eventsli team');
  return named ? `${m.authorName} · Eventsli` : 'Eventsli team';
}

export default function VipThread({ messages, viewer = 'organizer', mediaBase = null, mediaQuery = '', emptyText = 'No messages yet.' }) {
  const now = useNowMinute();
  const box = useRef(null);
  const count = messages.length;
  // Newest at the bottom, in view — on open and when one arrives. The list
  // scrolls inside itself; the page never jumps.
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [count]);

  if (!count) return <p className="es-vipthread__empty">{emptyText}</p>;
  const mine = (m) => (viewer === 'organizer' ? m.author === 'organizer' : m.author === 'team');

  return (
    <ol ref={box} className="es-vipthread" aria-label="Conversation">
      {messages.map((m) => {
        if (m.author === 'system' && m.channel === 'system') {
          return (
            <li key={m.id} className="es-vipthread__event">
              <span>{m.body}</span>
              <time dateTime={m.createdAt}>{when(m.createdAt, now)}</time>
            </li>
          );
        }
        const ch = CHANNEL[m.channel] || CHANNEL.dashboard;
        const side = mine(m) ? 'is-mine' : 'is-theirs';
        const who = whoWrote(m, viewer);
        return (
          <li key={m.id} className={`es-vipmsg ${side}${m.status === 'failed' ? ' is-failed' : ''}`}>
            <div className="es-vipmsg__bubble">
              <p className="es-vipmsg__who">{who}</p>
              {m.media && <Media message={m} mediaBase={mediaBase} mediaQuery={mediaQuery} />}
              {m.body && <p className="es-vipmsg__text">{m.body}</p>}
              <p className="es-vipmsg__meta">
                <span className={`es-vipmsg__ch is-${m.channel}`}>
                  {m.channel === 'whatsapp' ? <SocialIcon name="whatsapp" size={13} /> : <NavIcon name={ch.icon} size={13} />}
                  {ch.label}{m.template ? ' · update template' : ''}
                </span>
                <time dateTime={m.createdAt}>{when(m.createdAt, now)}</time>
                {m.direction === 'out' && m.channel === 'whatsapp' && <Ticks status={m.status} />}
              </p>
              {m.error && <p className="es-vipmsg__error">{m.error}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
