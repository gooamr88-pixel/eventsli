import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../src/app/utils/apiClient', () => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/e/expo/vendors/booths/type-std', useSearchParams: () => new URLSearchParams() }));

import FloorPlanViewer from '../src/app/components/vendors/floorPlan/FloorPlanViewer';
import BoothDetail from '../src/app/e/[slug]/vendors/booths/[boothId]/BoothDetail';

/**
 * A vendor choosing a booth on the floor plan (2026-11-23).
 *
 * The booth page passed `canPick`/`onPick` that expected a booth ID while the
 * viewer hands over the BOOTH — so nothing was ever pickable ("This booth
 * cannot be chosen"). And the public floor plan showed a tapped booth's
 * details with no way to book it.
 */
beforeAll(() => {
  if (!globalThis.ResizeObserver) globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

const floorPlan = {
  plan: {
    width: 1200, height: 800,
    elements: [
      { id: 'b-a1', kind: 'booth', x: 100, y: 100, w: 60, h: 60, r: 0, code: 'A1', boothTypeId: 'type-std', blocked: false },
      { id: 'b-a2', kind: 'booth', x: 200, y: 100, w: 60, h: 60, r: 0, code: 'A2', boothTypeId: 'type-std', blocked: false },
      { id: 'b-flower', kind: 'booth', x: 300, y: 100, w: 60, h: 60, r: 0, code: 'FLOWER', boothTypeId: null, blocked: false },
    ],
  },
  booths: { 'b-a2': { status: 'sold', vendor: { name: 'Taco Co' } } },
  boothTypes: [{ id: 'type-std', name: 'Standard', priceCents: 25000 }],
};

const tapBooth = (code) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${code},`) }));

describe('the public vendor floor plan', () => {
  const book = { href: '/e/expo/vendors/booths', label: 'Reserve this booth', types: ['type-std'] };

  it('offers to book a free booth of an open type, with the spot in the link', () => {
    render(<FloorPlanViewer floorPlan={floorPlan} currency="CAD" book={book} />);
    tapBooth('A1');
    expect(screen.getByRole('link', { name: 'Reserve this booth' }))
      .toHaveAttribute('href', '/e/expo/vendors/booths/type-std?spot=b-a1');
  });

  it('offers nothing on a sold booth', () => {
    render(<FloorPlanViewer floorPlan={floorPlan} currency="CAD" book={book} />);
    tapBooth('A2');
    expect(screen.queryByRole('link', { name: 'Reserve this booth' })).toBeNull();
    expect(screen.getByText('Taco Co')).toBeInTheDocument();
  });

  it('says a booth with no type is not open for booking yet', () => {
    render(<FloorPlanViewer floorPlan={floorPlan} currency="CAD" book={book} />);
    tapBooth('FLOWER');
    expect(screen.getByText(/Not open for booking yet/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reserve this booth' })).toBeNull();
  });

  it('shows no booking button where the page did not ask for one', () => {
    render(<FloorPlanViewer floorPlan={floorPlan} currency="CAD" />);
    tapBooth('A1');
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('choosing a spot on the booth page', () => {
  const props = {
    event: { slug: 'expo', title: 'Expo', currency: 'CAD', organizerName: 'Org' },
    booth: { id: 'type-std', name: 'Standard', priceCents: 25000, staffPasses: 2, includes: [], remaining: 5, soldOut: false },
    addons: [], mode: 'instant', open: true, holdMinutes: 20, floorPlan, spots: ['b-a1', 'b-a2'],
  };

  it('a free booth of this kind can be picked', () => {
    render(<BoothDetail {...props} />);
    tapBooth('A1');
    expect(screen.queryByText('This booth cannot be chosen.')).toBeNull();
    expect(screen.getByText(/Spot chosen/)).toBeInTheDocument();
  });

  it('a sold booth cannot', () => {
    render(<BoothDetail {...props} />);
    tapBooth('A2');
    expect(screen.getByText('This booth cannot be chosen.')).toBeInTheDocument();
    expect(screen.queryByText(/Spot chosen/)).toBeNull();
  });

  it('arrives with the spot tapped on the floor plan already chosen', () => {
    render(<BoothDetail {...props} initialSpot="b-a1" />);
    expect(screen.getByText(/Spot chosen/)).toBeInTheDocument();
  });
});
