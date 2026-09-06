/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Every answer a scan can produce, as something a person on a door can read at
 * arm's length in the dark.
 *
 * THE RULE THIS FILE EXISTS FOR: a refusal is a 200. `check_in_ticket` returns
 * `duplicate` with the time of the first scan and the API sends it as a
 * success, because it IS one — the system decided, correctly, and the operator
 * needs the decision, not a network error inviting a retry. Only a locked gate
 * is a 403, because that is the one state door staff cannot resolve.
 *
 * So the outcome shown on screen never comes from an HTTP status. It comes from
 * `result`, and every value the server can put there has an entry here. A test
 * reads the backend's SQL and service and fails if one appears that this file
 * does not cover — the same arrangement as the error-code table, for the same
 * reason: an unmapped value degrades to "something went wrong" at the exact
 * moment somebody is standing at a door waiting to be let in.
 *
 * Four tones, because the door only has four physical responses:
 *
 *   admit  — green. Let them in.
 *   refuse — red. Do not let them in.
 *   warn   — amber. Something happened; a person has to look.
 *   hold   — grey. No answer yet. NOT a decision.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const OUTCOMES = {
  // ── From check_in_ticket ──────────────────────────────────────────────────
  admitted: {
    tone: 'admit',
    title: 'Welcome in',
    note: 'Admitted. This ticket is now used.',
  },
  duplicate: {
    tone: 'warn',
    // The time is appended by the caller from `scannedAt`. "Already used" starts
    // an argument at the door; "already used at 19:04" ends one.
    title: 'Already used',
    note: 'This ticket was scanned before. Check the time and the name.',
  },
  not_found: {
    tone: 'refuse',
    title: 'Not a ticket we issued',
    note: 'The code is well formed but no such ticket exists.',
  },
  void: {
    tone: 'refuse',
    title: 'Cancelled ticket',
    note: 'This ticket was refunded or voided. It does not admit anyone.',
  },
  event_cancelled: {
    tone: 'refuse',
    title: 'Event cancelled',
    note: 'This event was cancelled. Nobody is admitted on these tickets.',
  },
  scanner_locked: {
    tone: 'refuse',
    title: 'Scanning is switched off',
    note: 'The organizer has to settle their commission invoice before the gate reopens.',
  },

  // ── From scanService, before the database is touched ───────────────────────
  invalid: {
    tone: 'refuse',
    title: 'Not one of ours',
    note: 'The signature does not check out. A screenshot of a real ticket still works — this is not one.',
  },
  wrong_event: {
    tone: 'refuse',
    title: 'Wrong event',
    note: 'A real ticket, for a different event. Not a forgery — send them to the right door.',
  },
  error: {
    tone: 'warn',
    title: 'Could not be checked',
    note: 'The server could not answer. Scan again; a genuine admission is never lost.',
  },

  // ── From undo_check_in ────────────────────────────────────────────────────
  undone: {
    tone: 'warn',
    title: 'Admission reversed',
    note: 'The ticket is valid again and can be scanned.',
  },
  not_scanned: {
    tone: 'warn',
    title: 'Nothing to undo',
    note: 'That ticket had not been admitted.',
  },

  // ── The device's own states. Not server answers, and never dressed up as
  //    one: `queued` in particular is the absence of a decision. ─────────────
  queued: {
    tone: 'hold',
    title: 'Held for upload',
    note: 'No signal. Recorded with this device’s time and checked the moment a connection returns.',
  },
  sending: {
    tone: 'hold',
    title: 'Checking…',
    note: '',
  },
};

/** Every key, for the drift test and for anything that wants to enumerate. */
export const OUTCOME_KEYS = Object.keys(OUTCOMES);

const UNKNOWN = {
  tone: 'warn',
  title: 'Unrecognised answer',
  note: 'The server returned something this app does not know. Let a supervisor scan it.',
};

/**
 * @param {string} result  the `result` field, from the server or from the queue
 * @returns {{ tone: string, title: string, note: string, known: boolean }}
 */
export function describeScan(result) {
  const hit = OUTCOMES[result];
  return hit ? { ...hit, known: true } : { ...UNKNOWN, known: false };
}

/** True when the person may walk in. Deliberately a whitelist of one: anything
 *  this app does not understand must not open a door. */
export function admits(result) {
  return result === 'admitted';
}

/**
 * A timestamp as the door reads it: hours and minutes, in the TABLET's own
 * zone.
 *
 * Not the event's timezone, and that is the deliberate choice. Everywhere else
 * in this app a time is rendered in the event's zone, because the reader may be
 * anywhere. Here the reader is standing in the venue holding the device, and
 * the useful sentence is "you scanned that eleven minutes ago" — measured by
 * the same clock as the wall behind them.
 */
export function doorTime(iso) {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
