/**
 * The checkout SCREEN, end to end against a mocked API: what the person sees
 * and which calls go out. These are the paths that broke or could break
 * money: the free claim, Android's payment return (2026-11-27), a payment
 * whose order is slow to appear, and seats given back on leaving.
 */
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ reservationId: 'res-1' }),
}));
jest.mock('@/api/endpoints');
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));
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

import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import * as endpoints from '../src/api/endpoints';
import type { Quote } from '../src/api/types';
import Checkout from '../src/app/checkout/[reservationId]';
import { queryClient } from '../src/lib/queryClient';
import { resultPolling, useReservation } from '../src/lib/reservation';

const api = endpoints as jest.Mocked<typeof endpoints>;

function quoteOf(totalCents: number): Quote {
  return {
    currency: 'CAD', admits: 1, totalCents,
    lines: [{ label: 'Tickets', amountCents: totalCents }],
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), heldForMs: 600_000,
    event: { slug: 'gala', title: 'Spring Gala', venue: null, startsAt: '2026-12-20T19:00:00Z', timezone: 'America/Toronto', coverUrl: null, city: null, organizerName: null },
    tickets: [{ key: 't', name: 'General', unitPriceCents: totalCents, quantity: 1 }],
    holders: { mode: 'off', slots: [] }, guestOf: null, addonsOffered: [], policies: [],
  };
}

function holdInMemory() {
  useReservation.getState().start({
    reservationId: 'res-1', reservationToken: 'HOLD', expiresAt: new Date(Date.now() + 600_000).toISOString(),
    seatCount: 1, subtotalCents: 0, currency: 'CAD', tableLabel: null, slug: 'gala', eventTitle: 'Spring Gala',
  });
}

const renderCheckout = () => render(<QueryClientProvider client={queryClient}><Checkout /></QueryClientProvider>);

async function fillAndAgree(name = 'Sara Ali', email = 'sara@example.com') {
  await fireEvent.changeText(await screen.findByLabelText(/Full name|First name/), name);
  const emailField = screen.queryByLabelText(/Email/);
  if (emailField) await fireEvent.changeText(emailField, email);
  await fireEvent.press(screen.getByRole('checkbox'));
}

beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  useReservation.setState({ current: null, sessionId: null });
  api.release.mockResolvedValue({ released: true });
});

// Ten checks a millisecond apart instead of two seconds: the loop, not the wait, is under test.
const polling = { ...resultPolling };
beforeAll(() => { resultPolling.gapMs = 1; });
afterAll(() => { Object.assign(resultPolling, polling); });
afterEach(() => { queryClient.clear(); });

it('says the hold has ended when there is none in memory', async () => {
  api.quote.mockResolvedValue(quoteOf(0));
  await renderCheckout();
  expect(screen.getByText('This hold has ended')).toBeTruthy();
});

it('claims a free order directly and opens Booking Confirmed', async () => {
  holdInMemory();
  api.quote.mockResolvedValue(quoteOf(0));
  api.claimFree.mockResolvedValue({ orderId: 'ord-1', ticketCount: 1, free: true });
  await renderCheckout();
  await fillAndAgree('Sara');
  await fireEvent.press(screen.getByRole('button', { name: 'Get My Tickets' }));

  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  expect(api.claimFree).toHaveBeenCalledWith('res-1', 'HOLD', expect.objectContaining({ name: 'Sara', acceptTerms: true }), null);
  expect(router.replace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/checkout/confirmed', params: expect.objectContaining({ orderId: 'ord-1' }) }));
  expect(api.startCheckout).not.toHaveBeenCalled();
});

it('refuses to pay without a name and without the terms', async () => {
  holdInMemory();
  api.quote.mockResolvedValue(quoteOf(5000));
  await renderCheckout();
  await screen.findByText('Order Summary');
  await fireEvent.press(screen.getByRole('button', { name: 'Pay Now' }));
  expect(screen.getByText('Enter your full name.')).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText('Full name'), 'Sara Ali');
  await fireEvent.changeText(screen.getByLabelText('Email for your tickets'), 'sara@example.com');
  await fireEvent.press(screen.getByRole('button', { name: 'Pay Now' }));
  expect(screen.getByText('Accept the terms to continue.')).toBeTruthy();
  expect(api.startCheckout).not.toHaveBeenCalled();
});

it('on Android, waits for the person to come back from the payment page before checking', async () => {
  const listeners = new Set<(s: AppStateStatus) => void>();
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    listeners.add(fn as (s: AppStateStatus) => void);
    return { remove: () => { listeners.delete(fn as (s: AppStateStatus) => void); } } as ReturnType<typeof AppState.addEventListener>;
  });
  const emit = (s: AppStateStatus) => { for (const fn of [...listeners]) fn(s); };
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    holdInMemory();
    api.quote.mockResolvedValue(quoteOf(5000));
    api.startCheckout.mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123', sessionId: 'cs_test_1234567890' });
    api.checkoutResult.mockResolvedValue({ status: 'paid', sessionStatus: 'complete', order: { id: 'ord-9' } });

    await renderCheckout();
    await fillAndAgree();
    await fireEvent.press(screen.getByRole('button', { name: 'Pay Now' }));
    await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalled());

    // The Custom Tab is open: Android has already resolved openBrowserAsync.
    await act(async () => { emit('background'); });
    expect(api.checkoutResult).not.toHaveBeenCalled();

    // The person paid and closed the tab.
    await act(async () => { emit('active'); });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/checkout/confirmed' })));
    expect(api.checkoutResult).toHaveBeenCalledWith('cs_test_1234567890');
  } finally {
    spy.mockRestore();
    os.restore();
  }
});

it('says "payment received" and does not offer Pay Now again when the order is slow to appear', async () => {
  holdInMemory();
  api.quote.mockResolvedValue(quoteOf(5000));
  api.startCheckout.mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123', sessionId: 'cs_test_1234567890' });
  // Stripe finished; the webhook has not written the order yet.
  api.checkoutResult.mockResolvedValue({ status: 'unpaid', sessionStatus: 'complete', order: null });

  await renderCheckout();
  await fillAndAgree();
  await fireEvent.press(screen.getByRole('button', { name: 'Pay Now' }));

  expect(await screen.findByText('Payment received')).toBeTruthy();
  expect(api.checkoutResult).toHaveBeenCalledTimes(resultPolling.tries);
  expect(screen.queryByRole('button', { name: 'Pay Now' })).toBeNull();
  expect(router.replace).not.toHaveBeenCalled();
});

it('gives the seats back when the person leaves checkout', async () => {
  holdInMemory();
  api.quote.mockResolvedValue(quoteOf(5000));
  const view = await renderCheckout();
  await screen.findByText('Order Summary');
  await view.unmount();
  expect(api.release).toHaveBeenCalledWith('res-1', 'HOLD');
  expect(useReservation.getState().current).toBeNull();
});

it('keeps the seats once a payment page was opened for them', async () => {
  holdInMemory();
  useReservation.getState().setSession('cs_test_1234567890');
  api.quote.mockResolvedValue(quoteOf(5000));
  const view = await renderCheckout();
  await screen.findByText('Order Summary');
  await view.unmount();
  expect(api.release).not.toHaveBeenCalled();
});
