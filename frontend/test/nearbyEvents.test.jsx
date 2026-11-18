import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { startMode, roundCoords, distanceLabel, emptyMessage } from '../src/app/components/landing/nearbyModel';

/**
 * "Near you" by default — the decisions, then the component in each state the
 * brief names: allowed, not yet asked, refused, unavailable, failed, empty.
 */
describe('where "near you" starts', () => {
  test('location already allowed → find the visitor without asking', () => {
    expect(startMode({ supported: true, secure: true, permission: 'granted' })).toBe('locate');
  });
  test('not yet decided → offer a button; never open the browser prompt on load', () => {
    expect(startMode({ supported: true, secure: true, permission: 'prompt' })).toBe('offer');
    expect(startMode({ supported: true, secure: true, permission: 'unknown' })).toBe('offer');
  });
  test('refused, unsupported or insecure → the city list', () => {
    expect(startMode({ supported: true, secure: true, permission: 'denied' })).toBe('manual');
    expect(startMode({ supported: false, secure: true, permission: 'granted' })).toBe('manual');
    expect(startMode({ supported: true, secure: false, permission: 'granted' })).toBe('manual');
  });
  test('a city this browser chose before wins, with no location needed', () => {
    expect(startMode({ supported: true, secure: true, permission: 'granted', savedCity: { city: 'Toronto', country: 'CA' } })).toBe('city');
  });
  test('coordinates leave the browser at three decimals (~110 m)', () => {
    expect(roundCoords({ latitude: 43.6532249, longitude: -79.3831843 })).toEqual({ lat: '43.653', lng: '-79.383' });
  });
  test('distances say whether they are exact', () => {
    expect(distanceLabel({ distanceKm: 1.2, precise: true })).toBe('1.2 km away');
    expect(distanceLabel({ distanceKm: 12, precise: false })).toBe('about 12 km away');
    expect(distanceLabel({ distanceKm: 0.4, precise: true })).toBe('under 1 km away');
  });
  test('an empty answer points somewhere', () => {
    expect(emptyMessage({ nearest: { city: 'Toronto', distanceKm: 420 } }))
      .toBe('Nothing within 100 km yet. The closest is in Toronto, about 420 km away.');
  });
});

// ── The component ──────────────────────────────────────────────────────────
const get = vi.fn();
vi.mock('../src/app/utils/apiClient', () => ({ get: (...a) => get(...a) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }) => <a href={href} {...p}>{children}</a> }));
vi.mock('../src/app/components/EventCard', () => ({ default: ({ event }) => <article>{event.title}</article> }));
const { default: NearbyEvents } = await import('../src/app/components/landing/NearbyEvents');

const EVENT = { id: 'e1', slug: 'jazz', title: 'Jazz on the Water', distanceKm: 1.2, precise: true };
let permission; let position;

beforeEach(() => {
  get.mockReset();
  window.localStorage.clear();
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true, value: { query: vi.fn(async () => ({ state: permission })) },
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn((ok, fail) => (position instanceof Error ? fail(position) : ok(position))) },
  });
  get.mockImplementation(async (path) => {
    if (path.startsWith('/public/cities')) return { cities: [{ city: 'Toronto', country: 'CA', events: 3 }] };
    if (path.startsWith('/public/events/near')) return { events: [EVENT], nearest: null };
    if (path.startsWith('/public/events?city=')) return [{ ...EVENT, id: 'e2', title: 'Toronto Night' }];
    return null;
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('Near you on the homepage', () => {
  test('allowed: shows nearby events with their distance, without being asked', async () => {
    permission = 'granted';
    position = { coords: { latitude: 43.6426, longitude: -79.3871 } };
    render(<NearbyEvents />);
    await flush();
    expect(screen.getByText('Jazz on the Water')).toBeInTheDocument();
    expect(screen.getByText('1.2 km away')).toBeInTheDocument();
    const nearCall = get.mock.calls.find(([p]) => p.startsWith('/public/events/near'))[0];
    expect(nearCall).toContain('lat=43.643&lng=-79.387');   // rounded before it left
  });

  // Redesign 2026-11-18: "Near me" is a chip, and the cities are a row of chips.
  test('not yet asked: no prompt on load — a button and a city list instead', async () => {
    permission = 'prompt';
    render(<NearbyEvents />);
    await flush();
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Near me/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Toronto/ })).toHaveAttribute('aria-pressed', 'false');
  });

  test('refused: falls back to the city list, which works', async () => {
    permission = 'prompt';
    position = Object.assign(new Error('denied'), { code: 1 });
    render(<NearbyEvents />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /Near me/ }));
    await flush();
    expect(screen.getByText(/Location is turned off for this site/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Near me/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Toronto/ }));
    await flush();
    expect(screen.getByText('Toronto Night')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('eventsli.nearby.city'))).toEqual({ city: 'Toronto', country: 'CA' });
  });

  test('a failed load says so and offers a retry', async () => {
    permission = 'granted';
    position = { coords: { latitude: 43.6, longitude: -79.4 } };
    get.mockImplementation(async (path) => {
      if (path.startsWith('/public/cities')) return { cities: [] };
      throw new Error('network');
    });
    render(<NearbyEvents />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('could not load nearby events');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  test('nothing near: says how far the closest is, and goes there', async () => {
    permission = 'granted';
    position = { coords: { latitude: 49.28, longitude: -123.12 } };
    get.mockImplementation(async (path) => {
      if (path.startsWith('/public/cities')) return { cities: [] };
      if (path.startsWith('/public/events/near')) return { events: [], nearest: { city: 'Toronto', country: 'CA', distanceKm: 3360 } };
      return [{ ...EVENT, id: 'e3', title: 'Toronto Night' }];
    });
    render(<NearbyEvents />);
    await flush();
    expect(screen.getByText(/closest is in Toronto, about 3360 km away/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'See events in Toronto' }));
    await flush();
    expect(screen.getByText('Toronto Night')).toBeInTheDocument();
  });

  test('no geolocation at all: the city list is the way in', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    delete navigator.geolocation;
    permission = 'prompt';
    render(<NearbyEvents />);
    await flush();
    expect(screen.queryByRole('button', { name: /Near me/ })).toBeNull();
    expect(screen.getByRole('group', { name: /Where to look/ })).toBeInTheDocument();
    expect(screen.getByText(/Choose a city above/)).toBeInTheDocument();
  });
  test("the busiest eight cities are chips; the rest wait in More cities", async () => {
    permission = "prompt";
    const cities = Array.from({ length: 11 }, (_, i) => ({ city: `City ${String.fromCharCode(65 + i)}`, country: "CA", events: 20 - i }));
    render(<NearbyEvents initialCities={cities} />);
    await flush();
    const group = screen.getByRole("group", { name: /Where to look/ });
    expect(within(group).getAllByRole("button", { name: /^City / })).toHaveLength(8);
    const more = within(group).getByRole("combobox", { name: "More cities" });
    expect(within(more).getAllByRole("option").map((o) => o.textContent)).toEqual(["More cities", "City I (12)", "City J (11)", "City K (10)"]);
    fireEvent.change(more, { target: { value: "City K|CA" } });
    await flush();
    // The chosen city joins the chips, pressed.
    expect(within(group).getByRole("button", { name: /City K/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("a city with nothing on: the chosen chip comes first, and one tap goes somewhere busier", async () => {
    permission = "prompt";
    window.localStorage.setItem("eventsli.nearby.city", JSON.stringify({ city: "Quiet Town", country: "CA" }));
    const cities = [{ city: "Toronto", country: "CA", events: 12 }, { city: "Quiet Town", country: "CA", events: 1 }];
    get.mockImplementation(async (path) => (path.includes("city=Quiet") ? [] : [{ ...EVENT, id: "e3", title: "Toronto Night" }]));
    render(<NearbyEvents initialCities={cities} />);
    await flush();
    const chips = within(screen.getByRole("group", { name: /Where to look/ })).getAllByRole("button");
    expect(chips[1]).toHaveTextContent("Quiet Town");
    expect(chips[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Nothing is on in Quiet Town just yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse all events" })).toHaveAttribute("href", "/events");
    fireEvent.click(screen.getByRole("button", { name: /Try Toronto/ }));
    await flush();
    expect(screen.getByText("Toronto Night")).toBeInTheDocument();
  });
});
