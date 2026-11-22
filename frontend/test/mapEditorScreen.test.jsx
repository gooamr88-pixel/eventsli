import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * THE WHOLE SEATING MAP SCREEN, RENDERED (2026-11-23). The owner opened the
 * seating map on the live site after a deploy and got "Something broke": the
 * editor crashed while drawing. Its pieces were all tested; the screen that
 * wires them — and since 2026-11-22 also reads the vendor floor plan — never
 * was. This renders `MapEditor` itself against the answers the API gives,
 * including an older server and a failed vendor read.
 */
const responses = new Map();
const get = vi.fn(async (path) => {
  for (const [key, value] of responses) {
    if (path === key || path.startsWith(`${key}?`)) {
      if (value instanceof Error) throw value;
      return value;
    }
  }
  throw Object.assign(new Error(`unmocked ${path}`), { status: 404 });
});
vi.mock('../src/app/utils/apiClient', () => ({ get: (...a) => get(...a), put: vi.fn(), post: vi.fn(), del: vi.fn(), patch: vi.fn() }));
vi.mock('../src/app/hooks/useAiQuota', () => ({ useAiQuota: () => ({ quota: { enabled: false } }) }));
vi.mock('../src/app/organizer/events/[id]/EventContext', () => ({ useEventContext: () => ({ event: { status: 'draft' } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/organizer/events/e1/map' }));

const { default: MapEditor } = await import('../src/app/organizer/events/[id]/map/MapEditor');

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function rect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() { return this; } };
  };
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

const MAP = {
  version: 3,
  layout: { world: { width: 1000, height: 700 }, zones: [{ id: 'z_stage', kind: 'stage', x: 50, y: 10, w: 144, h: 60, rotation: 0 }] },
  tables: [{ id: 't1', label: 'T1', seatCount: 8, shape: 'round', position: { x: 30, y: 50, rotation: 0 }, status: 'available' }],
};

function answer({ map = MAP, floorPlan = null } = {}) {
  responses.clear();
  responses.set('/events/e1/venue-map', map);
  responses.set('/events/e1/tiers', []);
  responses.set('/events/e1/table-categories', []);
  responses.set('/events/e1', { title: 'Gala', currency: 'CAD', purchaseMode: 'seat_only' });
  if (floorPlan) responses.set('/events/e1/vendors/floor-plan', floorPlan);
}

beforeEach(() => { get.mockClear(); window.localStorage.clear(); });

describe('the seating map screen', () => {
  test('opens with no vendor floor plan (the read fails)', async () => {
    answer();
    render(<MapEditor eventId="e1" />);
    expect(await screen.findByRole('application', { name: 'Seating map editor' })).toBeInTheDocument();
  });

  test('opens with booths already on the map', async () => {
    answer({
      floorPlan: {
        version: 2, seatMap: true,
        plan: { width: 1000, height: 700, onSeatMap: true, elements: [{ id: 'b1', kind: 'booth', x: 100, y: 500, w: 60, h: 60, r: 0, code: 'A1', boothTypeId: null, blocked: false }] },
        booths: { b1: { status: 'available' } }, boothTypes: [],
      },
    });
    render(<MapEditor eventId="e1" />);
    expect(await screen.findByRole('application', { name: 'Seating map editor' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Booth A1, available/ })).toBeInTheDocument();
  });

  test('opens with a separate floor plan to bring over', async () => {
    answer({
      floorPlan: {
        version: 1, seatMap: true,
        plan: { width: 1200, height: 800, elements: [{ id: 'b1', kind: 'booth', x: 100, y: 100, w: 60, h: 60, r: 0, code: 'A1' }, { id: 'w', kind: 'wall', points: [[0, 0], [10, 0]] }] },
        booths: {}, boothTypes: [],
      },
    });
    render(<MapEditor eventId="e1" />);
    expect(await screen.findByRole('button', { name: 'Bring them onto this map' })).toBeInTheDocument();
  });

  test('opens on an empty event (no map yet)', async () => {
    answer({ map: null });
    render(<MapEditor eventId="e1" />);
    expect(await screen.findByRole('application', { name: 'Seating map editor' })).toBeInTheDocument();
  });
});
