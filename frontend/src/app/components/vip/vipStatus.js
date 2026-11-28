/**
 * VIP Services (2026-11-28): a request's status → its words and pill, the
 * order of the steps, and the phone number as people read it.
 */
export const STATUS = {
  new: { label: 'Received', pill: 'es-pill--accent' },
  in_review: { label: 'Reviewing', pill: 'es-pill--warning' },
  quoted: { label: 'Proposal sent', pill: 'es-pill--warning' },
  confirmed: { label: 'Confirmed', pill: 'es-pill--success' },
  in_progress: { label: 'In progress', pill: 'es-pill--success' },
  completed: { label: 'Completed', pill: '' },
  cancelled: { label: 'Cancelled', pill: 'es-pill--danger' },
};

export const STEPS = ['new', 'in_review', 'quoted', 'confirmed', 'in_progress', 'completed'];
export const OPEN = ['new', 'in_review', 'quoted', 'confirmed', 'in_progress'];

/** "+16196666620" → "+1 (619) 666-6620"; other countries spaced by the caller's input. */
export function displayPhone(e164) {
  const d = String(e164 || '').replace(/[^0-9]/g, '');
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return e164 ? `+${d}` : '';
}

export function waLink(e164, text) {
  const d = String(e164 || '').replace(/[^0-9]/g, '');
  if (!d) return null;
  return text ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : `https://wa.me/${d}`;
}

/**
 * "2 h ago", "Yesterday 2:05 PM", "Dec 12, 9:30 AM" — for the thread and
 * lists. `now` comes from useNowMinute (render stays pure); null → the date.
 */
export function when(isoString, now) {
  const t = Date.parse(isoString || '');
  if (!Number.isFinite(t)) return '';
  if (!now) return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const mins = Math.round((now - t) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 6 * 60) return `${Math.round(mins / 60)} h ago`;
  const d = new Date(t);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

/** How long until the 24-hour WhatsApp window closes, in words. */
export function windowLeft(untilIso, now) {
  if (!now) return null;
  const ms = Date.parse(untilIso || '') - now;
  if (!(ms > 0)) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
