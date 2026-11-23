import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import EventMapView from '../src/app/e/[slug]/EventMapView';

/**
 * A general-admission event's map on its page (2026-11-23, the event map):
 * the room as drawn, its vendor booths in it, and — while vendors are being
 * taken — a way for a vendor to the booth floor plan.
 */
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function rect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() { return this; } };
  };
  if (!globalThis.ResizeObserver) globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

const map = {
  layout: {
    world: { width: 1000, height: 700 },
    zones: [{ id: 'z_stage', kind: 'stage', x: 50, y: 10, w: 144, h: 60, rotation: 0, label: 'Main stage' }],
  },
  vendorBooths: {
    plan: { width: 1000, height: 700, onSeatMap: true, elements: [{ id: 'b1', kind: 'booth', x: 100, y: 500, w: 60, h: 60, r: 0, code: 'A1', boothTypeId: null, blocked: false }] },
    booths: { b1: { status: 'available' } },
    boothTypes: [],
  },
};

describe('the event map on a general-admission event page', () => {
  it('draws the room under an "Event map" heading and says it is general admission', () => {
    const { container } = render(<EventMapView map={map} slug="fest" />);
    expect(screen.getByRole('heading', { name: 'Event map' })).toBeInTheDocument();
    expect(screen.getByText(/stand or sit where you like/)).toBeInTheDocument();
    expect(container.querySelector('#event-map svg')).not.toBeNull();
    expect(container.querySelector('[data-zone-id="b1"]')).not.toBeNull();
  });

  it('sends a vendor to the floor plan while vendors are being taken', () => {
    render(<EventMapView map={map} slug="fest" vendorsOpen />);
    expect(screen.getByRole('link', { name: /Are you a vendor\?/ })).toHaveAttribute('href', '/e/fest/vendors#floor-plan');
  });

  it('offers no vendor link when vendors are not being taken, or there are no booths', () => {
    const { unmount } = render(<EventMapView map={map} slug="fest" />);
    expect(screen.queryByRole('link')).toBeNull();
    unmount();
    render(<EventMapView map={{ ...map, vendorBooths: null }} slug="fest" vendorsOpen />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
