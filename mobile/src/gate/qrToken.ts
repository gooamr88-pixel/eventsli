import { decodeBase64Url } from '../lib/base64';

/**
 * Reading a scanned code before the network sees it — the same rules as the
 * web gate (frontend/src/app/gate/qrToken.js).
 *
 *   extractToken() — what came off the camera may not be exactly the token.
 *   peekTicket()   — what the token SAYS, which is not what it PROVES.
 *
 * `peekTicket` does not verify the signature. It is used to refuse, without a
 * round trip, a code the server would certainly refuse — not a ticket at all,
 * or a ticket for another event. It never admits anyone.
 */

/** The bare token, or one pulled out of an Eventsli ticket link. */
export function extractToken(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  const inUrl = text.match(/\/t\/([A-Za-z0-9._-]+)/);
  if (inUrl) return inUrl[1];
  return text;
}

export type PeekedTicket = { ticketId: string; eventId: string; version: number };

/** The claims a ticket token carries, UNVERIFIED. Null if it is not shaped like one of ours. */
export function peekTicket(token: string): PeekedTicket | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const json = decodeBase64Url(parts[1]);
  if (!json) return null;

  let claims: any;
  try {
    claims = JSON.parse(json);
  } catch {
    return null;
  }
  if (claims?.typ !== 'ticket' || !claims.tid || !claims.eid) return null;
  const version = claims.v === undefined ? 0 : claims.v;
  if (!Number.isInteger(version) || version < 0) return null;
  return { ticketId: String(claims.tid), eventId: String(claims.eid), version };
}

/** 'invalid' | 'wrong_event' when the answer is certain without the server; null otherwise. */
export function offlineVerdict(token: string, eventId: string | null): 'invalid' | 'wrong_event' | null {
  const claims = peekTicket(token);
  if (!claims) return 'invalid';
  if (eventId && claims.eventId !== eventId) return 'wrong_event';
  return null;
}

/** A device-pairing code from the organizer's Devices page: eventsli-checkin://pair?device=<uuid>. */
export function pairingDeviceId(raw: string): string | null {
  const m = String(raw || '').trim().match(/^eventsli-checkin:\/\/pair\?(?:.*&)?device=([0-9a-fA-F-]{36})(?:&|$)/);
  return m ? m[1].toLowerCase() : null;
}
