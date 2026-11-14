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

/** "45 min", "3 h", "2 h 30 min", "4 days" — a length of time, rounded for reading. */
export function duration(ms: number): string {
  const m = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rest = m - h * 60;
    return rest >= 5 && h < 4 ? `${h} h ${rest} min` : `${h} h`;
  }
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

export type EventPhase = 'live' | 'soon' | 'upcoming' | 'ended';

/**
 * Where an event stands right now, for its status chip:
 *   live      between its start and its end          "Live now"
 *   soon      starts within 6 hours (doors open)     "Starts in 2 h"
 *   upcoming  later than that                        "In 3 days"
 *   ended     its end has passed                     "Finished"
 */
export function eventPhase(startsAt: string, endsAt: string | null | undefined, now = Date.now()): { phase: EventPhase; label: string } {
  const start = Date.parse(startsAt);
  const end = endsAt ? Date.parse(endsAt) : start + 4 * 3600e3;
  if (Number.isNaN(start)) return { phase: 'upcoming', label: '' };
  if (now >= end) return { phase: 'ended', label: 'Finished' };
  if (now >= start) return { phase: 'live', label: 'Live now' };
  const left = start - now;
  if (left <= 6 * 3600e3) return { phase: 'soon', label: `Starts in ${duration(left)}` };
  return { phase: 'upcoming', label: `In ${duration(left)}` };
}

/** "Sara Ahmed" → "SA"; a missing name → "". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!words.length) return '';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** A share as a whole percent: 0 when there is nothing to share. */
export function percent(value: number, total: number): number {
  return total > 0 ? Math.round((Math.min(value, total) / total) * 100) : 0;
}

/**
 * A short code a person can read out at the door: "TKT-3F2A1C". The first six
 * characters of the ticket's id, which is also how the guest list and the logs
 * can be searched.
 */
export function ticketCode(ticketId: string | null | undefined): string {
  if (!ticketId) return '';
  return `TKT-${ticketId.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}
