/**
 * Something an organizer PAID FOR, kept in this browser so a reload does not
 * lose it: a launch kit, a seating plan not yet applied. Each one cost one of
 * the day's two AI drafts, and losing it to a refresh was the bug that
 * prompted this file.
 *
 * localStorage, not the server: the AI rules keep no AI output server-side
 * (D-020), and these are the organizer's own working copies, per event, on
 * their own device. Best effort — a private window or a full quota simply
 * means it is not kept — and stale after `maxAgeDays`.
 */
const PREFIX = 'eventsli.keep.';

export function keepKey(kind, eventId) {
  return `${PREFIX}${kind}.${eventId}`;
}

export function readKept(key, { maxAgeDays = 30 } = {}) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (!raw || typeof raw !== 'object' || !raw.at) return null;
    if (Date.now() - new Date(raw.at).getTime() > maxAgeDays * 864e5) {
      localStorage.removeItem(key);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/** Stores `value` with the time it was written; `null` forgets it. */
export function writeKept(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ ...value, at: new Date().toISOString() }));
  } catch { /* private mode or full: not kept, nothing else breaks */ }
}

/** "today at 4:12 PM", "Nov 2 at 9:05 AM" — when a kept thing was made. */
export function keptWhen(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? `today at ${time}` : `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d)} at ${time}`;
}
