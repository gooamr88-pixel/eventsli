/**
 * The launch frame (the mockup's first): it shows the brand and tagline, and
 * gets out of the way by itself after SPLASH_MS (2026-11-28).
 */
jest.mock('react-native-reanimated', () => require('./mocks/reanimated'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

import { act, render, screen } from '@testing-library/react-native';

import { LaunchSplash, SPLASH_MS } from '../src/ui/LaunchSplash';

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it('shows the tagline, as drawn', async () => {
  await render(<LaunchSplash onDone={() => undefined} />);
  expect(screen.getByText('Discover. Experience.')).toBeTruthy();
  expect(screen.getByText('Be There.')).toBeTruthy();
  expect(screen.getByLabelText('eventsli. Discover. Experience. Be There.')).toBeTruthy();
});

it('ends by itself after its time, and not before', async () => {
  const done = jest.fn();
  await render(<LaunchSplash onDone={done} />);
  await act(async () => { jest.advanceTimersByTime(SPLASH_MS - 50); });
  expect(done).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(done).toHaveBeenCalledTimes(1);
});

it('stays put while held for a development render', async () => {
  const done = jest.fn();
  await render(<LaunchSplash onDone={done} hold />);
  await act(async () => { jest.advanceTimersByTime(SPLASH_MS * 5); });
  expect(done).not.toHaveBeenCalled();
});
