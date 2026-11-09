/**
 * Moving between the app's three states (signed out, choosing an event,
 * working a door) with the real root layout, the real door layout, the real
 * `index` / `pair` / `auth/callback` redirects and the real Settings screen.
 *
 * Regression, seen on an Android phone: opening a door navigated twice. The
 * guard's own redirect ran, and then the screen called router.replace('/dashboard')
 * as well, so the door's navigator was built twice. The first copy's
 * ROUTE_NAMES_CHANGED then had no navigator to land on, and Expo Router said
 * so. Under act() React flushes both in one batch and the race never shows,
 * so these run on real timers, outside act, the way a phone schedules them.
 *
 * Every test fails on any console error or warning, including that one.
 */
import { router } from 'expo-router';
import { fireEvent, renderRouter, screen, type RenderRouterResult } from 'expo-router/testing-library';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { Alert, Text } from 'react-native';

jest.mock('expo-font', () => ({ useFonts: () => [true, null], isLoaded: () => true, loadAsync: jest.fn() }));
// The Keychain: present, empty, and every write succeeds.
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
// No network in these tests: the version check never answers (which must not
// block the app), and signing out on the server is fire-and-forget.
jest.mock('@/api/endpoints', () => ({
  appConfig: jest.fn(() => new Promise(() => undefined)),
  logout: jest.fn(async () => undefined),
}));
// The door layout's side effects (sound, the scan log database, the 10-second
// polls) are not what these tests are about.
jest.mock('@/gate/feedback', () => ({ primeFeedback: jest.fn() }));
jest.mock('@/gate/offlineList', () => {
  const state = { complete: false, off: false, load: jest.fn(async () => undefined), pull: jest.fn(async () => false), wipeAll: jest.fn(async () => undefined) };
  return { useOfflineList: Object.assign((pick: (s: typeof state) => unknown) => pick(state), { getState: () => state }) };
});
jest.mock('@/gate/scanLog', () => {
  const state = { records: [], load: jest.fn(async () => undefined), sync: jest.fn(async () => null) };
  return {
    useScanLog: Object.assign((pick: (s: typeof state) => unknown) => pick(state), { getState: () => state }),
    pendingCount: (records: unknown[]) => records.length,
    DoorAuthError: class DoorAuthError extends Error {},
  };
});
jest.mock('@/gate/useDoor', () => ({
  useMe: () => ({ error: null }),
  useGateStatus: () => ({ error: null }),
  useDoorExit: () => jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { useSession } = require('@/auth/session') as typeof import('@/auth/session');
const { queryClient } = require('@/lib/queryClient') as typeof import('@/lib/queryClient');
/* eslint-enable @typescript-eslint/no-require-imports */

// The version check never answers here, and a cancelled fetch schedules the
// cache's five-minute collection, which would keep Jest running. Nothing in
// these tests is about collection.
queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity } });

const APP = join(__dirname, '..', 'src', 'app');
const SETTLE_MS = 300;
const MAX_SETTLE_MS = 5_000;
jest.setTimeout(60_000);

const ACCOUNT = {
  token: 'account-token',
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: 'u1', email: 'organizer@example.test', fullName: 'Org', role: 'user', accountTypes: [] },
};
const DOOR_LOGIN = { token: 'door-token', device: { id: 'd1', label: 'Phone', eventId: 'e1' }, event: { id: 'e1', title: 'Gala' } };
const SAVED_DOOR = { token: 'door-token', eventId: 'e1', deviceId: 'd1', label: 'Phone', kind: 'staff' as const, eventTitle: 'Gala' };

/** Leaf screens are labels: what is under test is who moves the phone. */
const leaf = (name: string) => function Leaf() { return <Text>{`screen:${name}`}</Text>; };

let problems: string[] = [];
let view: RenderRouterResult | null = null;

beforeEach(() => {
  problems = [];
  const note = (kind: string) => (...args: unknown[]) => { problems.push(`${kind}: ${args.map(String).join(' ').slice(0, 300)}`); };
  jest.spyOn(console, 'error').mockImplementation(note('error'));
  jest.spyOn(console, 'warn').mockImplementation(note('warn'));
});

afterEach(() => {
  // On the real timers the test ran on, so the door's upload interval is
  // cleared; then the cache, so no collection timer outlives the test.
  view?.unmount();
  view = null;
  queryClient.clear();
  jest.restoreAllMocks();
});

async function boot(state: { hydrated?: boolean; account?: typeof ACCOUNT | null; door?: typeof SAVED_DOOR | null }, initialUrl = '/') {
  useSession.setState({ hydrated: true, account: null, door: null, ...state, hydrate: async () => undefined });
  /* eslint-disable @typescript-eslint/no-require-imports */
  view = await renderRouter({
    _layout: require('../src/app/_layout'),
    index: require('../src/app/index'),
    pair: require('../src/app/pair'),
    'auth/callback': require('../src/app/auth/callback'),
    'sign-in': leaf('sign-in'),
    'device-pin': leaf('device-pin'),
    '(account)/_layout': require('../src/app/(account)/_layout'),
    '(account)/events': leaf('events'),
    '(account)/account': require('../src/app/(account)/account'),
    '(door)/settings': require('../src/app/(door)/settings'),
    '(door)/_layout': require('../src/app/(door)/_layout'),
    '(door)/dashboard': leaf('dashboard'),
    '(door)/scan': leaf('scan'),
    '(door)/result': leaf('result'),
    '(door)/attendees': leaf('attendees'),
    '(door)/ticket/[ticketId]': leaf('ticket'),
    '(door)/analytics': leaf('analytics'),
    '(door)/recent': leaf('recent'),
    '(door)/offline': leaf('offline'),
  }, { initialUrl });
  /* eslint-enable @typescript-eslint/no-require-imports */

  // A phone's scheduling, not act()'s single batch.
  jest.useRealTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  await settle();
  return view;
}

/**
 * Do something, then wait until the phone has stopped moving: the route has
 * not changed for SETTLE_MS (so anything still queued, warnings included, has
 * had its turn), or MAX_SETTLE_MS has passed.
 */
async function settle(fn?: () => unknown) {
  await fn?.();
  const started = Date.now();
  let last = view?.getPathname();
  let stableSince = Date.now();
  while (Date.now() - stableSince < SETTLE_MS && Date.now() - started < MAX_SETTLE_MS) {
    await new Promise((done) => setTimeout(done, 25));
    const now = view?.getPathname();
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    }
  }
}

/** Press a control by its text or accessibility label, as a finger would. */
function press(label: string): Promise<void> {
  return fireEvent.press(screen.queryByText(label) ?? screen.getByLabelText(label));
}

/** Accept the confirmation's destructive choice, as the person would. */
function confirmDestructive() {
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });
}

const where = () => view!.getPathname();

describe('the session decides where the phone is', () => {
  test('a phone with nothing saved opens on sign-in', async () => {
    await boot({});
    expect(where()).toBe('/sign-in');
    expect(problems).toEqual([]);
  });

  test('a phone with a saved door opens on its dashboard, once the Keychain has been read', async () => {
    await boot({ hydrated: false });
    await settle(() => useSession.setState({ hydrated: true, account: ACCOUNT, door: SAVED_DOOR }));
    expect(where()).toBe('/dashboard');
    expect(problems).toEqual([]);
  });

  test('a phone with a saved account opens on its events', async () => {
    await boot({ hydrated: false });
    await settle(() => useSession.setState({ hydrated: true, account: ACCOUNT }));
    expect(where()).toBe('/events');
    expect(problems).toEqual([]);
  });

  test('signing in leads to the events', async () => {
    await boot({});
    await settle(() => useSession.getState().setAccount(ACCOUNT));
    expect(where()).toBe('/events');
    expect(problems).toEqual([]);
  });

  test('opening a door builds the door once: no ROUTE_NAMES_CHANGED left unhandled', async () => {
    await boot({ account: ACCOUNT });
    expect(where()).toBe('/events');
    await settle(() => useSession.getState().setDoor(DOOR_LOGIN, 'staff'));
    expect(where()).toBe('/dashboard');
    expect(problems).toEqual([]);

    // And the door works as a stack afterwards.
    await settle(() => router.push('/attendees'));
    expect(where()).toBe('/attendees');
    await settle(() => router.back());
    expect(where()).toBe('/dashboard');
    expect(problems).toEqual([]);
  });

  test('a shared tablet signing in with its PIN lands on the dashboard, with no warning', async () => {
    await boot({});
    await settle(() => router.push('/device-pin'));
    expect(where()).toBe('/device-pin');
    await settle(() => useSession.getState().setDoor(DOOR_LOGIN, 'pin'));
    expect(where()).toBe('/dashboard');
    expect(problems).toEqual([]);
  });

  test('leaving the door from the dashboard goes back to the events', async () => {
    await boot({ account: ACCOUNT, door: SAVED_DOOR });
    await settle(() => useSession.getState().leaveDoor());
    expect(where()).toBe('/events');
    expect(problems).toEqual([]);
  });

  test('a door the server closed, while a scan answer is on screen, goes back to the events', async () => {
    await boot({ account: ACCOUNT, door: SAVED_DOOR });
    await settle(() => router.push('/scan'));
    await settle(() => router.push({ pathname: '/result', params: { id: 'scan-1' } }));
    expect(where()).toBe('/result');
    await settle(() => useSession.getState().leaveDoor());
    expect(where()).toBe('/events');
    expect(problems).toEqual([]);
  });

  test('Settings → Switch event goes to the events, and Settings closes', async () => {
    await boot({ account: ACCOUNT, door: SAVED_DOOR });
    await settle(() => router.push('/settings'));
    expect(where()).toBe('/settings');
    await settle(() => press('Switch event'));
    expect(useSession.getState().door).toBeNull();
    expect(where()).toBe('/events');
    expect(problems).toEqual([]);
  });

  test('Settings → Sign out goes to sign-in, from a door', async () => {
    await boot({ account: ACCOUNT, door: SAVED_DOOR });
    await settle(() => router.push('/settings'));
    confirmDestructive();
    await settle(() => press('Sign out'));
    expect(useSession.getState().account).toBeNull();
    expect(where()).toBe('/sign-in');
    expect(problems).toEqual([]);
  });

  test('Settings from the events → Sign out goes to sign-in', async () => {
    await boot({ account: ACCOUNT });
    await settle(() => router.push('/account'));
    expect(where()).toBe('/account');
    confirmDestructive();
    await settle(() => press('Sign out'));
    expect(where()).toBe('/sign-in');
    expect(problems).toEqual([]);
  });

  test('Settings from the events → Back returns to the events', async () => {
    await boot({ account: ACCOUNT });
    await settle(() => router.push('/account'));
    await settle(() => press('Back'));
    expect(where()).toBe('/events');
    expect(problems).toEqual([]);
  });

  test('the server closing the door while Settings is open takes Settings with it', async () => {
    await boot({ account: ACCOUNT, door: SAVED_DOOR });
    await settle(() => router.push('/settings'));
    await settle(() => useSession.getState().leaveDoor());
    expect(where()).toBe('/events');
    expect(problems).toEqual([]);
  });

  test('the sign-in link coming back while the code is being exchanged', async () => {
    await boot({});
    await settle(async () => {
      router.navigate('/auth/callback?code=c&state=s');
      await useSession.getState().setAccount(ACCOUNT);
    });
    expect(where()).toBe('/events');
    expect(problems).toEqual([]);
  });

  test('a pairing link on a phone that is already working a door stays at the door', async () => {
    await boot({ account: ACCOUNT, door: SAVED_DOOR });
    await settle(() => router.navigate('/pair?device=d2'));
    expect(where()).toBe('/dashboard');
    expect(problems).toEqual([]);
  });
});

/**
 * The rule the tests above depend on, checked in the source: a screen never
 * navigates into another group. Moving between groups is the session's job
 * (the guards in src/app/_layout.tsx, then `index`). `<Redirect>` lives only in
 * the routes whose whole purpose is placement. Screens shared by several
 * groups (src/screens) navigate into none.
 */
describe('screens do not navigate across groups', () => {
  const SRC = join(__dirname, '..', 'src');
  const groupOfRoute = (path: string): string => {
    const name = path.replace(/^\//, '').split(/[?#]/)[0];
    if (name === '' || name === 'pair') return 'open';
    if (name === 'sign-in' || name === 'device-pin') return 'signed-out';
    if (name === 'events' || name === 'account') return 'account';
    return 'door';
  };
  const groupOfFile = (rel: string): string => {
    if (rel.startsWith('screens/')) return 'shared';
    if (rel.startsWith('app/(door)/')) return 'door';
    if (rel === 'app/sign-in.tsx' || rel === 'app/device-pin.tsx') return 'signed-out';
    if (rel.startsWith('app/(account)/')) return 'account';
    return 'open';
  };
  const PLACEMENT = new Set(['app/index.tsx', 'app/pair.tsx', 'app/auth/callback.tsx']);
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
  const screens = [...files(APP), ...files(join(SRC, 'screens'))].map((f) => [relative(SRC, f).split(sep).join('/'), f]);

  test('every route file is classified', () => {
    expect(screens.length).toBeGreaterThan(15);
  });

  test.each(screens)('%s', (rel, file) => {
    const src = readFileSync(file, 'utf8');
    const from = groupOfFile(rel);
    const calls = [...src.matchAll(/router\.(?:replace|push|navigate)\(\s*(?:'([^']*)'|\{\s*pathname:\s*'([^']*)')/g)];
    for (const [call, plain, pathname] of calls) {
      const to = groupOfRoute(plain ?? pathname);
      if (to !== 'open' && to !== from) throw new Error(`${rel}: ${call}… moves the phone from "${from}" into "${to}". Change the session instead.`);
    }
    if (/<Redirect\b/.test(src) && !PLACEMENT.has(rel)) {
      throw new Error(`${rel}: <Redirect> outside the placement routes (${[...PLACEMENT].join(', ')})`);
    }
  });
});
