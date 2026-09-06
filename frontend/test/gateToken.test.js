import { describe, test, expect } from 'vitest';
import { extractToken, peekTicket, offlineVerdict } from '../src/app/gate/qrToken';

/** A ticket token, unsigned — which is exactly what the gate can inspect. */
function token(claims, signature = 'not-a-real-signature') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.${signature}`;
}

const TICKET = token({ typ: 'ticket', tid: 'ticket-1', eid: 'event-1' });

describe('reading a scanned code', () => {
  test('a bare token comes through unchanged — that is what the QR encodes', () => {
    expect(extractToken(TICKET)).toBe(TICKET);
    expect(extractToken(`  ${TICKET}\n`)).toBe(TICKET);
  });

  test('a pasted ticket link is unwrapped', () => {
    // Somebody at the door types in what the buyer has on screen, which is a
    // link, not a token.
    expect(extractToken(`https://eventsli.com/t/${TICKET}`)).toBe(TICKET);
    expect(extractToken(`https://eventsli.com/t/${TICKET}?from=email`)).toBe(TICKET);
  });

  test('nothing in, nothing out', () => {
    expect(extractToken('')).toBe('');
    expect(extractToken(null)).toBe('');
  });
});

describe('the offline shape check', () => {
  test('reads the claims without pretending to verify them', () => {
    expect(peekTicket(TICKET)).toEqual({ ticketId: 'ticket-1', eventId: 'event-1' });
    // The signature is never consulted, and that is stated rather than hidden:
    // a forged payload reads back perfectly here and is refused by the server.
    expect(peekTicket(token({ typ: 'ticket', tid: 't', eid: 'e' }, 'garbage'))).toBeTruthy();
  });

  test('refuses anything that is not shaped like one of ours', () => {
    expect(peekTicket('hello')).toBeNull();
    expect(peekTicket('a.b.c')).toBeNull();
    expect(peekTicket(token({ typ: 'scan_device', did: 'd', eid: 'e' }))).toBeNull();
    expect(peekTicket(token({ typ: 'ticket', eid: 'event-1' }))).toBeNull();
    expect(peekTicket(null)).toBeNull();
  });

  test('a ticket for another event is refused at the door, with no network', () => {
    expect(offlineVerdict(TICKET, 'event-2')).toBe('wrong_event');
    expect(offlineVerdict('a shop receipt', 'event-1')).toBe('invalid');
  });

  test('a well-formed ticket for THIS event gets no verdict at all', () => {
    // The important negative. Offline, "looks right" is not "may come in" — it
    // may already be used, voided, or belong to a cancelled event, and none of
    // that is knowable here. `null` means only the server can answer.
    expect(offlineVerdict(TICKET, 'event-1')).toBeNull();
  });

  test('with no event known, only the shape is judged', () => {
    expect(offlineVerdict(TICKET, null)).toBeNull();
    expect(offlineVerdict('nonsense', null)).toBe('invalid');
  });
});
