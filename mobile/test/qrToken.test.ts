import { extractToken, offlineVerdict, pairingDeviceId, peekTicket } from '../src/gate/qrToken';
import { bytesToBase64Url } from '../src/lib/base64';

const EVENT = '11111111-1111-4111-8111-111111111111';
const TICKET = '22222222-2222-4222-8222-222222222222';

/** A token shaped like the server's, with a junk signature: peek never verifies. */
function token(claims: object): string {
  const enc = (o: object) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(claims)}.c2lnbmF0dXJl`;
}

describe('reading a scanned code', () => {
  test('a bare token passes through, and a ticket link gives up its token', () => {
    expect(extractToken('  abc.def.ghi  ')).toBe('abc.def.ghi');
    expect(extractToken('https://eventsli.com/t/abc.def-_ghi?x=1')).toBe('abc.def-_ghi');
    expect(extractToken('')).toBe('');
  });

  test('peek reads the claims, including the transfer version', () => {
    expect(peekTicket(token({ typ: 'ticket', tid: TICKET, eid: EVENT }))).toEqual({
      ticketId: TICKET, eventId: EVENT, version: 0,
    });
    expect(peekTicket(token({ typ: 'ticket', tid: TICKET, eid: EVENT, v: 1 }))?.version).toBe(1);
  });

  test('anything not shaped like one of our tickets is refused', () => {
    expect(peekTicket('not-a-token')).toBeNull();
    expect(peekTicket(token({ typ: 'order_access', oid: 'x' }))).toBeNull();
    expect(peekTicket(token({ typ: 'ticket', tid: TICKET }))).toBeNull();
    expect(peekTicket(token({ typ: 'ticket', tid: TICKET, eid: EVENT, v: -1 }))).toBeNull();
    expect(peekTicket('a.!!!.c')).toBeNull();
  });

  test('the only offline verdicts are the certain refusals — never an admission', () => {
    expect(offlineVerdict('junk', EVENT)).toBe('invalid');
    expect(offlineVerdict(token({ typ: 'ticket', tid: TICKET, eid: 'other' }), EVENT)).toBe('wrong_event');
    expect(offlineVerdict(token({ typ: 'ticket', tid: TICKET, eid: EVENT }), EVENT)).toBeNull();
  });

  test('a pairing code yields the device id and nothing else', () => {
    expect(pairingDeviceId(`eventsli-checkin://pair?device=${TICKET}`)).toBe(TICKET);
    expect(pairingDeviceId(`eventsli-checkin://pair?x=1&device=${TICKET.toUpperCase()}`)).toBe(TICKET);
    expect(pairingDeviceId(`https://evil.example/pair?device=${TICKET}`)).toBeNull();
    expect(pairingDeviceId('eventsli-checkin://pair?device=short')).toBeNull();
  });
});
