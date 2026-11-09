/**
 * The phone's answer with no signal (src/gate/offlineDecision.ts), with real
 * QR v2 codes signed by the backend's own code. Each case is one line of the
 * order the server decides in.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { decideOffline, type ListContext, type ListTicket } from '../src/gate/offlineDecision';
import type { SigningKey } from '../src/gate/qrVerify';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const qrSigning = require(join(__dirname, '..', '..', 'backend', 'services', 'qrSigning.js'));

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const ENV = { QR_SIGNING_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, QR_SIGNING_KID: 'k1' };
const KEYS = qrSigning.jwks(ENV) as SigningKey[];

const EVENT = randomUUID();
const TID = randomUUID();
const v2 = (tid = TID, eid = EVENT, v = 0): string => qrSigning.sign({ typ: 'ticket', tid, eid, ...(v ? { v } : {}) }, ENV);
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const legacy = (tid = TID, eid = EVENT) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ typ: 'ticket', tid, eid })}.c2ln`;

const ctx = (over: Partial<ListContext> = {}): ListContext => ({
  eventId: EVENT, eventStatus: 'published', gateLocked: false, legacyQrOffline: 'allow', keys: KEYS, ...over,
});
const ticket = (over: Partial<ListTicket> = {}): ListTicket => ({
  ticketId: TID, v: 0, status: 'valid', scannedAt: null, tier: 'VIP', seat: 'Floor A1', table: null, holder: 'Sara Ahmed', ...over,
});

test('a valid ticket on the list, with its current code, is admitted', () => {
  expect(decideOffline(v2(), ctx(), ticket(), null)).toEqual({ kind: 'admit', ticket: ticket() });
});

test('a forged code is refused, even for a ticket on the list', () => {
  const [h, , s] = v2().split('.');
  const forged = `${h}.${b64({ typ: 'ticket', tid: TID, eid: EVENT, v: 5 })}.${s}`;
  expect(decideOffline(forged, ctx(), ticket(), null)).toMatchObject({ kind: 'refuse', result: 'invalid' });
  expect(decideOffline('garbage', ctx(), ticket(), null)).toMatchObject({ kind: 'refuse', result: 'invalid' });
});

test('a v2 code from a key the phone does not have is held, not refused', () => {
  const { privateKey: other } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const next = qrSigning.sign({ typ: 'ticket', tid: TID, eid: EVENT }, {
    QR_SIGNING_KEY: other.export({ type: 'pkcs8', format: 'pem' }), QR_SIGNING_KID: 'k2',
  });
  expect(decideOffline(next, ctx(), ticket(), null)).toEqual({ kind: 'hold', reason: 'unknown_key' });
});

test('an older (HS256) code: let in on a list match, or held, as the organizer chose', () => {
  expect(decideOffline(legacy(), ctx(), ticket(), null)).toMatchObject({ kind: 'admit' });
  expect(decideOffline(legacy(), ctx({ legacyQrOffline: 'hold' }), ticket(), null)).toEqual({ kind: 'hold', reason: 'older_code' });
  // Without the signature, the list is the only proof: not on it, not let in.
  expect(decideOffline(legacy(), ctx(), null, null)).toEqual({ kind: 'hold', reason: 'not_on_list' });
});

test('a real ticket for another event is the wrong event', () => {
  expect(decideOffline(v2(TID, randomUUID()), ctx(), null, null)).toMatchObject({ kind: 'refuse', result: 'wrong_event' });
});

test('a closed gate and a closed event refuse everyone, as the server would', () => {
  expect(decideOffline(v2(), ctx({ gateLocked: true }), ticket(), null)).toMatchObject({ result: 'scanner_locked' });
  expect(decideOffline(v2(), ctx({ eventStatus: 'cancelled' }), ticket(), null)).toMatchObject({ result: 'event_cancelled' });
  for (const status of ['draft', 'suspended', 'completed', 'pending_review']) {
    expect(decideOffline(v2(), ctx({ eventStatus: status }), ticket(), null)).toMatchObject({ result: 'event_not_open' });
  }
  expect(decideOffline(v2(), ctx({ eventStatus: 'archived' }), ticket(), null)).toMatchObject({ kind: 'admit' });
});

test('a ticket the list has never heard of is held: it may have been bought a minute ago', () => {
  expect(decideOffline(v2(), ctx(), null, null)).toEqual({ kind: 'hold', reason: 'not_on_list' });
});

test('refunded or cancelled is refused', () => {
  expect(decideOffline(v2(), ctx(), ticket({ status: 'void' }), null)).toMatchObject({ kind: 'refuse', result: 'void' });
});

test('a code from before a transfer is refused; the new holder\'s code is let in', () => {
  expect(decideOffline(v2(TID, EVENT, 0), ctx(), ticket({ v: 1 }), null)).toMatchObject({ kind: 'refuse', result: 'transferred' });
  expect(decideOffline(v2(TID, EVENT, 1), ctx(), ticket({ v: 1 }), null)).toMatchObject({ kind: 'admit' });
});

test('already used — at another door, or on this phone before it could upload — is a duplicate, with the time', () => {
  const there = ticket({ status: 'scanned', scannedAt: '2026-11-09T18:01:00.000Z' });
  expect(decideOffline(v2(), ctx(), there, null)).toEqual({ kind: 'duplicate', ticket: there, at: '2026-11-09T18:01:00.000Z' });
  expect(decideOffline(v2(), ctx(), ticket(), '2026-11-09T18:05:00.000Z'))
    .toEqual({ kind: 'duplicate', ticket: ticket(), at: '2026-11-09T18:05:00.000Z' });
});

test('the server\'s order: void before transferred before duplicate', () => {
  expect(decideOffline(v2(), ctx(), ticket({ status: 'void', v: 3 }), '2026-11-09T18:00:00Z')).toMatchObject({ result: 'void' });
  expect(decideOffline(v2(), ctx(), ticket({ status: 'scanned', v: 3 }), null)).toMatchObject({ result: 'transferred' });
});
