jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(async () => undefined),
}));

import type { Order } from '../src/api/types';
import { pack, unpack } from '../src/lib/ticketCache';

/** My Tickets on the phone: only ever handed back to the account that saved it. */
const orders = [{ orderId: 'o1', tickets: [] }] as unknown as Order[];

it('gives the saved list back to the same account', () => {
  const raw = pack('user-a', orders, 1000);
  expect(unpack(raw, 'user-a')).toEqual({ orders, savedAt: 1000 });
});

it('never hands one account\'s tickets to another', () => {
  expect(unpack(pack('user-a', orders), 'user-b')).toBeNull();
});

it('treats a missing, broken or older file as nothing saved', () => {
  expect(unpack(null, 'user-a')).toBeNull();
  expect(unpack('{not json', 'user-a')).toBeNull();
  expect(unpack(JSON.stringify({ v: 0, userId: 'user-a', savedAt: 1, orders }), 'user-a')).toBeNull();
  expect(unpack(JSON.stringify({ v: 1, userId: 'user-a', savedAt: 1, orders: 'x' }), 'user-a')).toBeNull();
});
