'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { post } from '../../utils/apiClient';
import { messageFor } from '../../utils/errors';
import { formatMoneyCompact } from '../../utils/money';
import NavIcon from '../shell/NavIcon';
import {
  MAX_INPUT, WELCOME, browserZone, cardWhen, loadConversation, requestFor, saveConversation,
} from './assistantModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Eventsli assistant's chat panel.
 *
 * What it shows is ours, not the model's: event cards are drawn from the API's
 * own event data (the model only chose which), the button under an answer is
 * one of our own pages, and the answer text is plain text — never HTML.
 *
 * A NON-MODAL PANEL, not a dialog that traps the page: a visitor can scroll
 * and read the homepage while it is open, as with any chat in a corner.
 * Escape closes it and focus goes back to the button that opened it. New
 * messages are announced (`role="log"`), and the typing indicator says so in
 * words to a screen reader.
 *
 * Honest about what it is: "AI" in the header, a line about mistakes and
 * personal details at the foot, and a person one tap away (/contact).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AssistantPanel({ onClose }) {
  const titleId = useId();
  const inputRef = useRef(null);
  const logRef = useRef(null);
  const [messages, setMessages] = useState(loadConversation);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { saveConversation(messages); }, [messages]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(text) {
    const value = String(text || '').trim().slice(0, MAX_INPUT);
    if (!value || busy) return;
    const next = [...messages.filter((m) => !m.error), { role: 'user', text: value }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    try {
      const data = await post('/public/assistant/messages', requestFor(next, browserZone()), { noRedirect: true });
      setMessages((m) => [...m, {
        role: 'assistant', text: data.reply, events: data.events || [], link: data.link || null,
        suggestions: data.suggestions || [], mode: data.mode,
      }]);
    } catch (err) {
      setMessages((m) => [...m, {
        role: 'assistant', error: true, retry: value,
        text: err?.code === 'RATE_LIMITED' ? messageFor(err) : 'Sorry — I couldn’t answer just now. Try again in a moment, or send the team a message.',
      }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function restart() {
    setMessages([WELCOME]);
    setDraft('');
    inputRef.current?.focus();
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  return (
    <section className="es-asst" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <header className="es-asst__head">
        <span className="es-asst__orb" aria-hidden="true"><NavIcon name="sparkle" size={20} /></span>
        <div className="fx-min0 flex-1">
          <h2 id={titleId} className="es-asst__title">Eventsli Assistant</h2>
          <p className="es-asst__status"><span className="es-asst__dot" aria-hidden="true" /> AI · answers in seconds</p>
        </div>
        <button type="button" className="es-asst__iconbtn" onClick={restart} title="New conversation">
          <NavIcon name="undo" size={18} /><span className="sr-only">Start a new conversation</span>
        </button>
        <button type="button" className="es-asst__iconbtn" onClick={onClose} title="Close">
          <NavIcon name="close" size={18} /><span className="sr-only">Close the assistant</span>
        </button>
      </header>

      <div ref={logRef} className="es-asst__log" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((m, i) => (
          <Message
            key={i} message={m} last={m === lastAssistant && !busy}
            onPick={send} onRetry={() => send(m.retry)}
          />
        ))}
        {busy && (
          <div className="es-asst__row">
            <span className="es-asst__avatar" aria-hidden="true"><NavIcon name="sparkle" size={14} /></span>
            <div className="es-asst__bubble es-asst__typing">
              <span /><span /><span /><span className="sr-only">The assistant is writing…</span>
            </div>
          </div>
        )}
      </div>

      <form className="es-asst__composer" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <label className="sr-only" htmlFor={`${titleId}-input`}>Ask the Eventsli assistant</label>
        <textarea
          ref={inputRef} id={`${titleId}-input`} rows={1} maxLength={MAX_INPUT} value={draft}
          placeholder="Ask about events, tickets or selling…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
          className="es-asst__input"
        />
        <button type="submit" className="es-asst__send" disabled={busy || !draft.trim()}>
          <NavIcon name="arrow" size={18} /><span className="sr-only">Send</span>
        </button>
      </form>
      <p className="es-asst__fine">
        AI answers can be wrong — check the event page. Don&rsquo;t share personal or payment details.{' '}
        <Link href="/privacy">Privacy</Link> · <Link href="/contact">Talk to a person</Link>
      </p>
    </section>
  );
}

function Message({ message: m, last, onPick, onRetry }) {
  if (m.role === 'user') {
    return <div className="es-asst__row es-asst__row--me"><div className="es-asst__bubble es-asst__bubble--me fx-break">{m.text}</div></div>;
  }
  return (
    <div className="es-asst__row">
      <span className="es-asst__avatar" aria-hidden="true"><NavIcon name="sparkle" size={14} /></span>
      <div className="fx-min0 flex-1 fx-stack fx-stack--sm gap-2">
        <div className={`es-asst__bubble fx-break${m.error ? ' es-asst__bubble--error' : ''}`}>{m.text}</div>

        {m.events?.length > 0 && (
          <ul className="es-asst__events">
            {m.events.map((e) => <EventChip key={e.slug} event={e} />)}
          </ul>
        )}
        {m.link && (
          <Link href={m.link.href} className="es-asst__link">{m.link.label} <NavIcon name="arrow" size={14} /></Link>
        )}
        {m.error && m.retry && (
          <button type="button" className="es-asst__link" onClick={onRetry}><NavIcon name="undo" size={14} /> Try again</button>
        )}
        {last && m.suggestions?.length > 0 && (
          <div className="es-asst__chips">
            {m.suggestions.map((s) => <button key={s} type="button" className="es-asst__chip" onClick={() => onPick(s)}>{s}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}

function EventChip({ event: e }) {
  const price = e.displayOnly ? 'Details'
    : e.fromPriceCents === 0 ? 'Free'
      : Number.isFinite(e.fromPriceCents) ? `From ${formatMoneyCompact(e.fromPriceCents, e.currency)}` : 'Tickets';
  return (
    <li>
      <Link href={`/e/${e.slug}`} className="es-asst__event">
        <span className="es-asst__thumb" aria-hidden="true">
          {e.coverUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={e.coverUrl} alt="" loading="lazy" />
            : <NavIcon name="ticket" size={18} />}
        </span>
        <span className="fx-min0 flex-1">
          <span className="es-asst__event-title fx-truncate">{e.title}</span>
          <span className="es-asst__event-meta fx-truncate">{cardWhen(e)}{e.city ? ` · ${e.city}` : ''}</span>
        </span>
        <span className="es-asst__event-price">{price}</span>
      </Link>
    </li>
  );
}
