/**
 * The sign-in SCREEN against a mocked API: a session lands in the store (the
 * guard then closes the modal — no navigation from here), an unconfirmed
 * account goes to the code screen with the password kept in memory only, and
 * a wrong password is an error on the screen, not a sign-out (onAuthLost).
 */
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => true },
}));
jest.mock('@/api/endpoints');
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));
jest.mock('expo-device', () => ({ deviceName: 'Test Phone', DeviceType: { PHONE: 1, TABLET: 2, DESKTOP: 3, TV: 4 } }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => undefined), impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: {}, NotificationFeedbackType: {},
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/', readAsStringAsync: jest.fn(), writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));
jest.mock('react-native-reanimated', () => require('./mocks/reanimated'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError } from '../src/api/client';
import * as endpoints from '../src/api/endpoints';
import SignIn from '../src/app/sign-in';
import { usePendingSignUp } from '../src/auth/pending';
import { useSession } from '../src/auth/session';

const api = endpoints as jest.Mocked<typeof endpoints>;

const SESSION = {
  token: 'SESSION', expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: 'u1', email: 'sara@example.com', fullName: 'Sara Ali', role: 'attendee', accountTypes: ['attendee'] },
};

async function typeAndSubmit(email: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign In' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  useSession.setState({ account: null, pushToken: null });
  usePendingSignUp.getState().clear();
});

it('asks for both fields before calling the server', async () => {
  await render(<SignIn />);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign In' }));
  expect(screen.getByText('Enter your email and password.')).toBeTruthy();
  expect(api.login).not.toHaveBeenCalled();
});

it('signs in: the session goes into the store, and this screen navigates nowhere', async () => {
  api.login.mockResolvedValue(SESSION);
  await render(<SignIn />);
  await typeAndSubmit('  sara@example.com ', 'secret-pass');

  await waitFor(() => expect(useSession.getState().account?.token).toBe('SESSION'));
  expect(api.login).toHaveBeenCalledWith('sara@example.com', 'secret-pass', 'Test Phone');
  // The Stack.Protected guard closes the modal; a second navigation here
  // built the next screen twice on Android (root _layout.tsx).
  expect(router.replace).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

it('sends an unconfirmed account to the code screen, password in memory only', async () => {
  api.login.mockRejectedValue(new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Confirm your email first.'));
  api.resendVerification.mockResolvedValue(undefined);
  await render(<SignIn />);
  await typeAndSubmit('sara@example.com', 'secret-pass');

  await waitFor(() => expect(router.push).toHaveBeenCalledWith('/verify'));
  expect(usePendingSignUp.getState()).toMatchObject({ email: 'sara@example.com', password: 'secret-pass' });
  expect(api.resendVerification).toHaveBeenCalledWith('sara@example.com');
  expect(useSession.getState().account).toBeNull();
});

it('shows a wrong password on the screen and stays signed out', async () => {
  api.login.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'That email and password do not match.'));
  await render(<SignIn />);
  await typeAndSubmit('sara@example.com', 'wrong');

  expect(await screen.findByText('That email and password do not match.')).toBeTruthy();
  expect(useSession.getState().account).toBeNull();
  expect(router.push).not.toHaveBeenCalled();
});
