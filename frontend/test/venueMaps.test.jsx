import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();
let user = { isSuperAdmin: true };
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => search }));
vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('../src/app/hooks/useAuth', () => ({ useAuth: () => ({ user }) }));
vi.mock('../src/app/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../src/app/components/ui/Confirm', () => ({ useConfirm: () => async () => true }));
vi.mock('../src/app/organizer/nav/OrganizerEvents', () => ({
  useOrganizerEvents: () => ({ events: [{ id: 'ev-1', title: 'Spring Gala', listingType: 'ticketed', status: 'draft' }] }),
}));

import { get, post, patch } from '../src/app/utils/apiClient';
import AdminVenueMaps from '../src/app/admin/venue-maps/AdminVenueMaps';
import Templates from '../src/app/organizer/templates/Templates';
import MapTemplateDialog from '../src/app/organizer/events/[id]/map/style/MapTemplateDialog';
import MapStarter from '../src/app/organizer/events/[id]/map/MapStarter';
import { fromImportedMap, mapFacts, placeLine, toEditorSpec, unmatchedGroups } from '../src/app/components/venueMaps/venueMapData';

/**
 * The venue map library (owner, 2026-11-24): map-only templates of real
 * venues — the console, the organizer's Templates tab, the Venue Builder's
 * picker and the empty map's suggestion.
 */
const sketch = { w: 1000, h: 700, t: [[100, 100, 0, 30, 0], [400, 500, 1, 200, 0]], z: [[500, 50, 400, 60, 0, 's']] };
const summary = { seats: 28, tables: 1, rows: 1, sections: 1, areas: 1, sketch };
const venue = { name: 'Grand Hall', city: 'Toronto', country: 'CA', placeId: 'place-grand', kind: 'ballroom' };
const libraryMap = { id: 'vm-lib', scope: 'platform', name: 'Gala rounds', venue, status: 'published', verified: true, featured: false, summary, useCount: 4, sourceNote: 'Based on the venue’s chart' };
const myMap = { id: 'vm-mine', scope: 'organizer', name: 'Our usual room', venue: { ...venue, placeId: null, name: 'Loft 5' }, status: 'published', summary, useCount: 0 };
const data = {
  layout: { zones: [{ id: 'z1', kind: 'stage', x: 50, y: 8, w: 300, h: 60 }], tableStyles: { t1: { fill: '#8c8c8c' } }, world: { width: 1000, height: 700 } },
  groups: [{ key: 'g1', name: 'VIP', color: '#d61f2c' }, { key: 'g2', name: 'Floor', color: '#111111' }],
  tables: [
    { label: 'T1', seatCount: 8, shape: 'round', position: { x: 10, y: 14, rotation: 0 }, groupKey: 'g1' },
    { label: 'A1', seatCount: 20, shape: 'row', position: { x: 40, y: 70, rotation: 0 }, section: 'Floor', row: 'A', groupKey: 'g2' },
  ],
};
const full = { ...libraryMap, data };

beforeEach(() => {
  vi.clearAllMocks();
  search = new URLSearchParams();
  user = { isSuperAdmin: true };
  get.mockImplementation(async (path) => {
    if (path.startsWith('/organizer/venue-maps?') || path === '/organizer/venue-maps') {
      return { enabled: true, mine: [myMap], library: [libraryMap], forVenue: path.includes('eventId') ? [libraryMap] : [], venue: path.includes('eventId') ? { name: 'Grand Hall', city: 'Toronto' } : null };
    }
    if (path.startsWith('/organizer/venue-maps/')) return full;
    if (path === '/organizer/templates') return { mine: [], eventsli: [], enabled: true };
    if (path.startsWith('/admin/venue-maps/venue-events')) return [{ id: 'ev-held', title: 'Winter Ball 2025', organizerName: 'Starlight', tables: 40, status: 'ended' }];
    if (path.startsWith('/admin/venue-maps?scope=organizer')) return { enabled: true, templates: [{ ...myMap, organizerName: 'Starlight' }] };
    if (path.startsWith('/admin/venue-maps?')) return { enabled: true, templates: [{ ...libraryMap, status: 'draft' }] };
    if (path.startsWith('/admin/venue-maps/')) return full;
    if (path.startsWith('/places')) throw Object.assign(new Error('off'), { code: 'PLACES_DISABLED' });
    return null;
  });
  post.mockResolvedValue({ ...libraryMap, id: 'vm-new' });
  patch.mockResolvedValue({});
});

describe('the map data', () => {
  test('a template lands in the editor as the room only, groups matched by name', () => {
    const spec = toEditorSpec(data, [{ id: 'cat-vip', name: ' vip' }]);
    expect(spec.tables[0]).toMatchObject({ label: 'T1', categoryId: 'cat-vip', tierId: null, priceCents: null, seatPriceCents: null, style: { fill: '#8c8c8c' } });
    expect(spec.tables[1].categoryId).toBeNull();
    expect(spec.zones).toHaveLength(1);
    expect(spec.world).toMatchObject({ width: 1000, height: 700 });
    expect(unmatchedGroups(data, [{ id: 'cat-vip', name: 'VIP' }])).toEqual(['Floor']);
  });

  test('a picture’s map becomes template data with every table named once', () => {
    const out = fromImportedMap({
      tables: [
        { label: 'T1', seatCount: 8, shape: 'round', position: { x: 10, y: 10, rotation: 0 }, style: { fill: '#222222' } },
        { label: 'T1', seatCount: 6, shape: 'round', position: { x: 20, y: 10 } },
        { label: '', seatCount: 4, shape: 'square', position: { x: 30, y: 10 } },
      ],
      zones: [{ id: 'z', kind: 'stage', x: 50, y: 10, w: 200, h: 50 }],
      world: { width: 1200, height: 800 },
      look: null,
    });
    expect(out.tables.map((t) => t.label)).toEqual(['T1', 'T1-2', 'T3']);
    expect(out.tables[1].position.rotation).toBe(0);
    expect(out.layout.world).toEqual({ width: 1200, height: 800 });
    expect(out.layout.zones).toHaveLength(1);
    expect(out.layout.tableStyles.t1).toBeTruthy();
    expect(JSON.stringify(out)).not.toMatch(/price|tier/i);
  });

  test('cards say where and how big', () => {
    expect(placeLine({ city: 'Toronto', country: 'CA' })).toBe('Toronto, Canada');
    expect(mapFacts({ seats: 1240, sections: 3, tables: 0, areas: 2 })).toEqual(['1,240 seats', '3 sections', '2 areas']);
  });
});

describe('the console', () => {
  test('lists Eventsli’s maps with their status, and publishes one', async () => {
    render(<AdminVenueMaps />);
    expect(await screen.findByText('Grand Hall')).toBeTruthy();
    expect(screen.getByText('Gala rounds')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(patch).toHaveBeenCalledWith('/admin/venue-maps/vm-lib', { status: 'published' }, { noRedirect: true });
  });

  test('adds a venue map: the venue, an event held there, the layout', async () => {
    render(<AdminVenueMaps />);
    await screen.findByText('Grand Hall');
    await userEvent.click(screen.getAllByRole('button', { name: /Add a venue map/ })[0]);
    const dialog = screen.getByRole('dialog');
    const next = within(dialog).getByRole('button', { name: 'Next' });
    expect(next.disabled).toBe(true);
    await userEvent.type(within(dialog).getByLabelText(/^Venue/), 'Massey Hall');
    await userEvent.type(within(dialog).getByLabelText('City'), 'Toronto');
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind of venue'), 'concert_hall');
    await userEvent.click(next);

    await userEvent.click(await within(dialog).findByRole('button', { name: /Winter Ball 2025/ }));
    expect(get).toHaveBeenCalledWith(expect.stringContaining('/admin/venue-maps/venue-events?name=Massey%20Hall&city=Toronto'), expect.anything());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));

    await userEvent.type(within(dialog).getByLabelText('Layout name'), 'Seated concert');
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(post).toHaveBeenCalledWith('/admin/venue-maps', expect.objectContaining({
      eventId: 'ev-held',
      name: 'Seated concert',
      verified: true,
      venue: expect.objectContaining({ name: 'Massey Hall', city: 'Toronto', kind: 'concert_hall' }),
    }), { noRedirect: true });
  });

  test('from an event’s admin page: its venue and its map, filled in', async () => {
    search = new URLSearchParams('from=ev-held');
    const base = get.getMockImplementation();
    get.mockImplementation(async (path, opts) => (path === '/admin/events/ev-held'
      ? { event: { id: 'ev-held', title: 'Winter Ball 2025', venue: { name: 'Roy Thomson Hall' }, city: 'Toronto', country: 'CA', venuePlaceId: 'place-rth' } }
      : base(path, opts)));
    render(<AdminVenueMaps />);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByDisplayValue('Roy Thomson Hall')).toBeTruthy();
    expect(within(dialog).getByText(/Linked to the venue on the map/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByRole('button', { name: /Winter Ball 2025/ }).getAttribute('aria-pressed')).toBe('true');
    expect(get).toHaveBeenCalledWith(expect.stringContaining('venue-events?placeId=place-rth'), expect.anything());
  });

  test('a plain admin can look but not change', async () => {
    user = { isSuperAdmin: false };
    render(<AdminVenueMaps />);
    await screen.findByText('Grand Hall');
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a venue map/ })).toBeNull();
  });

  test('an organizer’s map can be added to the library', async () => {
    render(<AdminVenueMaps />);
    await screen.findByText('Grand Hall');
    await userEvent.click(screen.getByRole('button', { name: /Organizers’ maps/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to library' }));
    expect(post).toHaveBeenCalledWith('/admin/venue-maps/vm-mine/promote', {}, { noRedirect: true });
  });
});

describe('the Venue Builder', () => {
  test('offers the maps of this event’s venue first, and puts one in the draft', async () => {
    const onApply = vi.fn();
    render(<MapTemplateDialog eventId="ev-1" categories={[{ id: 'cat-vip', name: 'VIP' }]} replacing onApply={onApply} onClose={() => {}} />);
    expect(await screen.findByText(/Ready for Grand Hall/)).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', { name: /Preview Grand Hall — Gala rounds/ })[0]);
    expect(await screen.findByText('Seat groups')).toBeTruthy();
    expect(screen.getByText(/This replaces the map you have now/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Use this map' }));
    const spec = onApply.mock.calls[0][0];
    expect(spec.tables[0]).toMatchObject({ label: 'T1', categoryId: 'cat-vip', priceCents: null, tierId: null });
    expect(post).toHaveBeenCalledWith('/organizer/venue-maps/vm-lib/used', {}, { noRedirect: true });
  });

  test('opens straight on one map when asked to', async () => {
    render(<MapTemplateDialog eventId="ev-1" initialId="vm-lib" onApply={() => {}} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Use this map' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Grand Hall — Gala rounds' })).toBeTruthy();
  });

  test('an empty map names the venue’s ready-made map', async () => {
    const onAdd = vi.fn();
    render(<MapStarter eventId="ev-1" onAdd={onAdd} />);
    await userEvent.click(await screen.findByRole('button', { name: /The map of Grand Hall/ }));
    expect(onAdd).toHaveBeenCalledWith({ family: 'template', templateId: 'vm-lib' });
  });

  test('a refused replacement says why and cannot be used', async () => {
    render(<MapTemplateDialog eventId="ev-1" initialId="vm-lib" blocked="12 seats are already sold." onApply={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('12 seats are already sold.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use this map' }).disabled).toBe(true);
  });
});

describe('Templates → Venue maps', () => {
  test('Use in an event opens that event’s map on this one', async () => {
    search = new URLSearchParams('tab=maps');
    render(<Templates />);
    expect(await screen.findByText('Grand Hall')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Use in an event' }));
    await userEvent.selectOptions(screen.getByLabelText('Event'), 'ev-1');
    await userEvent.click(screen.getByRole('button', { name: 'Open its Event map' }));
    expect(push).toHaveBeenCalledWith('/organizer/events/ev-1/map?venueMap=vm-lib');
  });

  test('their own maps can be renamed, and Eventsli’s copied', async () => {
    search = new URLSearchParams('tab=maps');
    render(<Templates />);
    await screen.findByText('Grand Hall');
    await userEvent.click(screen.getByRole('button', { name: 'Copy to mine' }));
    expect(post).toHaveBeenCalledWith('/organizer/venue-maps/vm-lib/copy', {}, { noRedirect: true });
    await userEvent.click(screen.getByRole('button', { name: /Your maps/ }));
    expect(await screen.findByText('Loft 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
  });
});
