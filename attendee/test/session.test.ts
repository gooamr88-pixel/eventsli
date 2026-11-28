/**
 * The session store: a 401 on the CURRENT session signs the phone out and
 * deletes the offline tickets; an older token's 401 changes nothing; launch
 * seeds My Tickets from the copy on the phone (2026-11-27).
 */
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/', readAsStringAsync: jest.fn(), writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';

import { request } from '../src/api/client';
import { useSession } from '../src/auth/session';
import { queryClient } from '../src/lib/queryClient';
import { pack } from '../src/lib/ticketCache';

const fs = FileSystem as jest.Mocked<typeof FileSystem>;
const store = SecureStore as jest.Mocked<typeof SecureStore>;

const USER = { id: 'u1', email: 'sara@example.com', fullName: 'Sara Ali', role: 'attendee', accountTypes: ['attendee'] };
const account = (token: string) => ({ token, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: USER });

const realFetch = global.fetch;
function answer(status: number, body: unknown) {
  global.fetch = jest.fn(async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  useSession.setState({ account: null, pushToken: null, hydrated: false });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => { global.fetch = realFetch; queryClient.clear(); });

it('signs the phone out when the server refuses the current session', async () => {
  useSession.setState({ account: account('NOW') });
  queryClient.setQueryData(['tickets'], [{ orderId: 'o1' }]);
  answer(401, { success: false, error: 'SESSION_REVOKED', message: 'Signed out elsewhere.' });

  await expect(request('/tickets', { token: 'NOW' })).rejects.toMatchObject({ status: 401 });
  await new Promise((r) => setTimeout(r, 0));

  expect(useSession.getState().account).toBeNull();
  expect(queryClient.getQueryData(['tickets'])).toBeUndefined();
  expect(fs.deleteAsync).toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('You were signed out', expect.any(String));
});

it('ignores a 401 for a token that is no longer the current one', async () => {
  useSession.setState({ account: account('NEW') });
  answer(401, { success: false, error: 'SESSION_REVOKED', message: 'Old session.' });

  await expect(request('/tickets', { token: 'OLD' })).rejects.toMatchObject({ status: 401 });
  await new Promise((r) => setTimeout(r, 0));

  expect(useSession.getState().account?.token).toBe('NEW');
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('seeds My Tickets at launch from the copy saved for this account', async () => {
  store.getItemAsync.mockImplementation(async (key: string) => (key === 'eventsli.app.account' ? JSON.stringify(account('NOW')) : null));
  fs.readAsStringAsync.mockResolvedValue(pack('u1', [{ orderId: 'o1' }] as never, 1234));

  await useSession.getState().hydrate();

  expect(useSession.getState().account?.token).toBe('NOW');
  expect(queryClient.getQueryData(['tickets'])).toEqual([{ orderId: 'o1' }]);
  expect(queryClient.getQueryState(['tickets'])?.dataUpdatedAt).toBe(1234);
});
