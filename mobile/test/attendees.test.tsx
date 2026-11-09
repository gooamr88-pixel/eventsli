/**
 * The real guest-list screen, and what it asks the server for as a person
 * types. The regression: it searched inside the "Not yet" filter, so guests
 * already inside could not be found by name.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-screen-capture', () => ({ usePreventScreenCapture: jest.fn() }));
// The server's answer is not what is under test, only the question: every call
// answers with an empty page.
jest.mock('@/api/endpoints', () => ({
  attendees: jest.fn(async () => ({ rows: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } })),
}));
jest.mock('@/gate/useDoor', () => ({ useDoorExit: () => jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports */
const { attendees } = require('@/api/endpoints') as { attendees: jest.Mock };
const { useSession } = require('@/auth/session') as typeof import('@/auth/session');
const Attendees = require('../src/app/(door)/attendees').default as () => React.JSX.Element;
/* eslint-enable @typescript-eslint/no-require-imports */

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

async function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <Attendees />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  return client;
}

/** The last thing the screen asked for. */
const lastAsk = () => attendees.mock.calls.at(-1)?.[1] as { q: string; status: string; offset: number };

beforeEach(() => {
  jest.useFakeTimers();
  attendees.mockClear();
  useSession.setState({
    hydrated: true,
    account: null,
    door: { token: 'door-token', eventId: 'e1', deviceId: 'd1', label: 'Phone', kind: 'staff', eventTitle: 'Gala' },
  });
});

afterEach(() => jest.useRealTimers());

async function type(text: string) {
  await fireEvent.changeText(screen.getByLabelText('Search guests'), text);
  await act(async () => { jest.advanceTimersByTime(300); });
}

test('browsing opens on "Not yet"', async () => {
  const client = await renderList();
  await act(async () => undefined);
  expect(lastAsk()).toEqual({ q: '', status: 'out', offset: 0 });
  expect(screen.getByText('Not yet')).toBeTruthy();
  client.clear();
});

test('typing a name searches every guest, not just those still to come', async () => {
  const client = await renderList();
  await act(async () => undefined);
  await type('John');
  expect(lastAsk()).toEqual({ q: 'John', status: 'all', offset: 0 });
  // The filter does not apply to a search, so it is not shown.
  expect(screen.queryByText('Not yet')).toBeNull();
  expect(await screen.findByText('Nobody on the guest list matches “John”')).toBeTruthy();
  client.clear();
});

test('a search covers everyone even after "Checked in" was chosen', async () => {
  const client = await renderList();
  await act(async () => undefined);
  await fireEvent.press(screen.getByText('Checked in'));
  await act(async () => undefined);
  expect(lastAsk().status).toBe('in');
  await type('Sara Ahmed');
  expect(lastAsk()).toEqual({ q: 'Sara Ahmed', status: 'all', offset: 0 });
  client.clear();
});

test('clearing the search goes back to the chosen filter', async () => {
  const client = await renderList();
  await act(async () => undefined);
  await type('John');
  await type('');
  expect(lastAsk()).toEqual({ q: '', status: 'out', offset: 0 });
  expect(screen.getByText('Not yet')).toBeTruthy();
  client.clear();
});
