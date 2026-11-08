/**
 * Times, as the door reads them.
 *
 * An EVENT's date is shown in the event's own time zone — a Toronto show is at
 * 7 PM in Toronto whoever holds the phone. A SCAN time ("checked in at 6:14
 * PM") is shown on the phone's clock: the reader is standing in the venue, and
 * the useful sentence is measured by the same clock as the wall behind them.
 */

function safe(fn: () => string, fallback = ''): string {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function eventDate(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '';
  return safe(() => new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', ...(timeZone ? { timeZone } : {}),
  }));
}

export function eventTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '';
  return safe(() => new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}),
  }));
}

/** "Nov 15, 2026 • 6:00 PM", in the event's zone. */
export function eventWhen(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '';
  return `${eventDate(iso, timeZone)} • ${eventTime(iso, timeZone)}`;
}

/** A scan's time on this phone's clock: "6:14 PM". */
export function doorTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return safe(() => at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
}

/** "just now", "4 min ago", "2 h ago" — for "last updated". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

export function count(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('en-US');
}

/** Hours until a time, rounded down; negative when it has passed. */
export function hoursUntil(iso: string, now = Date.now()): number {
  return Math.floor((Date.parse(iso) - now) / 3600e3);
}
