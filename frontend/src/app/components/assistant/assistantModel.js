/**
 * The homepage assistant's conversation, as data — what is kept, what is sent.
 *
 * KEPT IN THIS TAB ONLY (sessionStorage): a visitor who follows an event card
 * and comes back finds the conversation where they left it, and closing the
 * tab ends it. Nothing of it is stored on the server (services/ai/assistant.js).
 *
 * SENT SHORT: the last 8 turns, each cut to what the API accepts, so a long
 * chat never grows the request — or the cost — without bound.
 */
export const STORAGE_KEY = 'eventsli.assistant.v1';
export const MAX_INPUT = 500;
export const MAX_TURNS_SENT = 8;

export const WELCOME = Object.freeze({
  role: 'assistant',
  text: 'Hi! I’m the Eventsli assistant. I can help you find an event, get your tickets, or start selling your own. What are you looking for?',
  suggestions: ['What’s on this weekend?', 'I can’t find my tickets', 'Can I get a refund?', 'How do I sell tickets?'],
  welcome: true,
});

export function loadConversation() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    return Array.isArray(saved) && saved.length ? saved : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

export function saveConversation(messages) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30))); } catch { /* private mode */ }
}

/** The request body: real turns only (not the canned welcome), newest last, bounded. */
export function requestFor(messages, timezone) {
  const turns = messages
    .filter((m) => !m.welcome && !m.error && (m.role === 'user' || m.role === 'assistant') && m.text)
    .slice(-MAX_TURNS_SENT)
    .map((m) => ({ role: m.role, text: String(m.text).slice(0, m.role === 'user' ? MAX_INPUT : 700) }));
  return { messages: turns, ...(timezone ? { timezone } : {}) };
}

/** The reader's time zone, for "this weekend". Never read during render. */
export function browserZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

/** "Sat, Nov 14 · 9:00 PM" in the event's own zone. */
export function cardWhen(event) {
  try {
    const d = new Date(event.startsAt);
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: event.timezone }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: event.timezone }).format(d);
    return `${day} · ${time}`;
  } catch {
    return '';
  }
}
