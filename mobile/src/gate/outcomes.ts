import type { Tone } from '../ui/theme';

/**
 * Every answer a scan can produce, as something a person on a door can read at
 * arm's length — the app's copy of frontend/src/app/gate/scanOutcome.js.
 *
 * THE RULE: a refusal is a 200. The screen never comes from an HTTP status; it
 * comes from `result`, and every value the server can send has an entry here.
 * test/outcomes.contract.test.ts reads the backend's SQL and services and fails
 * if one appears that this file does not cover.
 *
 * Four tones, because the door has four physical responses:
 *   admit  — green. Let them in.
 *   refuse — red. Do not let them in.
 *   warn   — amber. Something happened; a person has to look.
 *   hold   — grey. No answer yet. NOT a decision.
 */

type Outcome = { tone: Tone; title: string; note: string };

const OUTCOMES: Record<string, Outcome> = {
  // ── From check_in_ticket_v2 ────────────────────────────────────────────────
  admitted: { tone: 'admit', title: 'Check-in Successful', note: 'Admitted. This ticket is now used.' },
  duplicate: {
    tone: 'warn',
    title: 'Already Checked In',
    note: 'This ticket has already been checked in.',
  },
  transferred: {
    tone: 'refuse',
    title: 'Ticket Transferred',
    note: 'This code is from before the ticket was transferred. The person it was given to has the code that works.',
  },
  void: { tone: 'refuse', title: 'Cancelled Ticket', note: 'This ticket was refunded or cancelled. It does not admit anyone.' },
  event_cancelled: { tone: 'refuse', title: 'Event Cancelled', note: 'Nobody is admitted on tickets for this event.' },
  event_not_open: {
    tone: 'refuse',
    title: 'Event Not Open',
    note: 'This event is not open for entry right now. Ask the organizer before letting anyone in.',
  },
  not_found: { tone: 'refuse', title: 'Ticket Not Found', note: 'No such ticket exists for this event.' },
  scanner_locked: {
    tone: 'refuse',
    title: 'Scanning Switched Off',
    note: 'Nobody can be admitted on this event right now. Call the organizer.',
  },

  // ── From the API, before the database ─────────────────────────────────────
  invalid: {
    tone: 'refuse',
    title: 'Invalid Ticket',
    note: 'This QR code is not valid for this event.',
  },
  wrong_event: {
    tone: 'refuse',
    title: 'Wrong Event',
    note: 'This ticket is for a different event. Send them to the right door.',
  },
  error: { tone: 'warn', title: 'Could Not Check', note: 'The server could not answer. Scan again; a real admission is never lost.' },

  // ── From undo ─────────────────────────────────────────────────────────────
  undone: { tone: 'warn', title: 'Check-in Reversed', note: 'The ticket is valid again and can be scanned.' },
  not_scanned: { tone: 'warn', title: 'Nothing to Undo', note: 'That ticket had not been admitted.' },

  // ── The device's own states. Not server answers. ───────────────────────────
  queued: {
    tone: 'hold',
    title: 'Saved to Sync',
    note: 'No signal. Saved on this phone and checked the moment a connection returns.',
  },
  sending: { tone: 'hold', title: 'Checking…', note: '' },
  // ── The phone's own decisions with no signal (offline admission) ──────────
  offline_admitted: {
    tone: 'admit',
    title: 'Check-in Successful',
    note: 'Checked on this phone with no signal. It uploads the moment a connection returns.',
  },
  offline_unconfirmed: {
    tone: 'warn',
    title: 'Can’t Confirm Offline',
    note: 'This ticket is not on this phone’s list yet. It may have been bought in the last few minutes. Held: it is checked when the signal returns.',
  },
};

/** Device-only keys: never a server `result`, so the contract test leaves them out. */
export const DEVICE_OUTCOMES = ['queued', 'sending', 'offline_admitted', 'offline_unconfirmed'];

/**
 * Which answer a record shows. Settled: its result. Waiting to upload: what
 * the phone decided (an offline admission, a ticket it could not confirm), or
 * simply held.
 */
export function screenResult(rec: { state: string; result: string | null; offlineVerdict?: string | null } | undefined): string {
  if (!rec) return 'sending';
  if (rec.state === 'done') return rec.result ?? 'error';
  if (rec.offlineVerdict === 'admitted') return 'offline_admitted';
  if (rec.offlineVerdict === 'unconfirmed') return 'offline_unconfirmed';
  return rec.state;
}

export const OUTCOME_KEYS = Object.keys(OUTCOMES);

const UNKNOWN: Outcome = {
  tone: 'warn',
  title: 'Unrecognised answer',
  note: 'The server returned something this app does not know. Ask a supervisor before letting them in.',
};

export function describeScan(result: string, reason?: string | null) {
  const hit = OUTCOMES[result];
  if (!hit) return { ...UNKNOWN, known: false };
  // A locked gate says why when the server said: the call the door staff make
  // next is different for an unpaid invoice, an Eventsli stop and a cancellation.
  if (result === 'scanner_locked' && reason && LOCKED_NOTES[reason]) {
    return { ...hit, note: LOCKED_NOTES[reason], known: true };
  }
  return { ...hit, known: true };
}

/** Why scanning is off, for the dashboard and the result screen. Null when unknown. */
export function lockedNote(reason?: string | null): string | null {
  return (reason && LOCKED_NOTES[reason]) || null;
}

const LOCKED_NOTES: Record<string, string> = {
  commission_overdue: 'The organizer has an overdue commission invoice. Scanning comes back on once it is settled — call the organizer.',
  admin_closed: 'Eventsli has switched scanning off for this event. Call the organizer.',
  event_cancelled: 'This event was cancelled. Nobody is admitted on its tickets.',
};

/**
 * Only an admission opens the door: the server's, or the phone's own with no
 * signal. Anything this app does not understand must not.
 */
export function admits(result: string | null | undefined): boolean {
  return result === 'admitted' || result === 'offline_admitted';
}
