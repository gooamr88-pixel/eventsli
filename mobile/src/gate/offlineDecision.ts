import { peekTicket } from './qrToken';
import { checkSignature, type SigningKey } from './qrVerify';

/**
 * The phone's answer when the server cannot be reached, from the event's
 * ticket list (gate/offlineList.ts). Pure: everything it needs is passed in.
 *
 * The checks run in the server's order (check_in_ticket_v2), so a door with
 * no signal says what the server would have said, given the list it has:
 *
 *   1. the code is ours            signature (v2), or the organizer's rule
 *                                  for older codes, which cannot be checked
 *   2. for this event
 *   3. the gate is open, the event is open
 *   4. the ticket is on the list   if not, HOLD: it may have been bought a
 *                                  minute ago, after the list was fetched
 *   5. not refunded or cancelled
 *   6. this is the current code    not one from before a transfer
 *   7. not already used            here, or anywhere the list has heard of
 *   8. → admit
 *
 * Only an admission is uploaded later (it was a real decision: someone went
 * in). A refusal is not: the server must never let in, later, a person the
 * door turned away. A hold is uploaded, as before Phase 3.
 */

export type ListTicket = {
  ticketId: string;
  v: number;
  status: 'valid' | 'scanned' | 'void';
  scannedAt: string | null;
  tier: string | null;
  seat: string | null;
  table: string | null;
  holder: string | null;
};

export type ListContext = {
  eventId: string;
  eventStatus: string | null;
  gateLocked: boolean;
  /** Why the gate was shut at the last sync (scanner_is_locked's reason), if it was. */
  gateReason?: string | null;
  legacyQrOffline: 'allow' | 'hold';
  keys: SigningKey[];
};

export type OfflineRefusal =
  | 'invalid' | 'wrong_event' | 'void' | 'transferred' | 'event_cancelled' | 'event_not_open' | 'scanner_locked';

export type HoldReason = 'not_on_list' | 'older_code' | 'unknown_key';

export type OfflineDecision =
  | { kind: 'admit'; ticket: ListTicket }
  | { kind: 'refuse'; result: OfflineRefusal; ticket: ListTicket | null; reason?: string | null }
  | { kind: 'duplicate'; ticket: ListTicket; at: string | null }
  | { kind: 'hold'; reason: HoldReason };

/** Event statuses the server admits on (check_in_ticket_v2). */
const OPEN = new Set(['published', 'archived']);

/**
 * @param ticket       the list's row for the code's ticket, or null
 * @param admittedHere when this phone let the ticket in offline and has not
 *                     uploaded it yet (the list cannot know that), or null
 */
export function decideOffline(
  token: string,
  ctx: ListContext,
  ticket: ListTicket | null,
  admittedHere: string | null,
): OfflineDecision {
  const claims = peekTicket(token);
  if (!claims) return { kind: 'refuse', result: 'invalid', ticket: null };

  const signature = checkSignature(token, ctx.keys);
  if (signature === 'invalid') return { kind: 'refuse', result: 'invalid', ticket: null };
  if (signature === 'unknown_key') return { kind: 'hold', reason: 'unknown_key' };
  if (signature === 'legacy' && ctx.legacyQrOffline === 'hold') return { kind: 'hold', reason: 'older_code' };

  if (claims.eventId !== ctx.eventId) return { kind: 'refuse', result: 'wrong_event', ticket: null };
  if (ctx.gateLocked) return { kind: 'refuse', result: 'scanner_locked', ticket: null, reason: ctx.gateReason ?? null };
  if (ctx.eventStatus === 'cancelled') return { kind: 'refuse', result: 'event_cancelled', ticket: null };
  if (ctx.eventStatus && !OPEN.has(ctx.eventStatus)) return { kind: 'refuse', result: 'event_not_open', ticket: null };

  if (!ticket) return { kind: 'hold', reason: 'not_on_list' };
  if (ticket.status === 'void') return { kind: 'refuse', result: 'void', ticket };
  if (claims.version < ticket.v) return { kind: 'refuse', result: 'transferred', ticket };
  if (admittedHere) return { kind: 'duplicate', ticket, at: admittedHere };
  if (ticket.status === 'scanned') return { kind: 'duplicate', ticket, at: ticket.scannedAt };
  return { kind: 'admit', ticket };
}

export const HOLD_MESSAGES: Record<HoldReason, string> = {
  not_on_list: 'This ticket is not on this phone’s list yet. It may have been bought in the last few minutes.',
  older_code: 'An older ticket code. The organizer asked for these to wait for a connection.',
  unknown_key: 'A newer ticket code this phone cannot check yet. It is checked when the signal returns.',
};
