import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BoothPickCard from '../src/app/components/vendors/BoothPickCard';
import EventMapView from '../src/app/e/[slug]/EventMapView';

/**
 * Booking a booth straight from the event map (2026-11-23). The owner: "booth
 * — I can't click on it and cannot buy it as a vendor". Booths on the buyers'
 * map were scenery; a tap now shows the booth and, while the event is taking
 * vendors and its type is open, "Reserve this booth" with the spot chosen.
 */
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function rect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() { return this; } };
  };
  if (!globalThis.ResizeObserver) globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

const types = [{ id: 'type-std', name: 'Standard', priceCents: 25000, sizeLabel: '3 × 3 m' }];
const zone = (over = {}) => ({ id: 'z_b1', kind: 'booth', label: 'A1', boothTypeId: 'type-std', blocked: false, state: { status: 'available' }, ...over });
const instant = { open: true, mode: 'instant', types: ['type-std'] };

describe('the booth card', () => {
  it('offers to reserve a free booth of an open type, that spot chosen', () => {
    render(<BoothPickCard zone={zone()} boothTypes={types} book={instant} slug="expo" currency="CAD" onClose={() => {}} />);
    expect(screen.getByText('Booth A1')).toBeInTheDocument();
    expect(screen.getByText(/Standard · 3 × 3 m · CA\$250\.00/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Reserve this booth/ }))
      .toHaveAttribute('href', '/e/expo/vendors/booths/type-std?spot=z_b1');
  });

  it('says Apply when the organizer reviews vendors first', () => {
    render(<BoothPickCard zone={zone()} boothTypes={types} book={{ ...instant, mode: 'apply' }} slug="expo" onClose={() => {}} />);
    expect(screen.getByRole('link', { name: /Apply for this booth/ })).toBeInTheDocument();
  });

  it('a booked booth shows who has it and offers nothing', () => {
    render(<BoothPickCard zone={zone({ state: { status: 'sold', vendor: { name: 'Rose Flowers', category: 'Florist' } } })} boothTypes={types} book={instant} slug="expo" onClose={() => {}} />);
    expect(screen.getByText('Rose Flowers')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a booth with no type is not open yet, and says where vendors book', () => {
    render(<BoothPickCard zone={zone({ boothTypeId: null })} boothTypes={types} book={instant} slug="expo" onClose={() => {}} />);
    expect(screen.getByText(/not open for booking yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the booths for vendors' })).toHaveAttribute('href', '/e/expo/vendors');
  });

  it('says so when the event is not taking vendors', () => {
    render(<BoothPickCard zone={zone()} boothTypes={types} book={{ open: false, mode: null, types: [] }} slug="expo" onClose={() => {}} />);
    expect(screen.getByText(/not taking vendors right now/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('tapping a booth on the event map', () => {
  const map = {
    currency: 'CAD',
    layout: { world: { width: 1000, height: 700 }, zones: [] },
    vendorBooths: {
      plan: { width: 1000, height: 700, onSeatMap: true, elements: [{ id: 'z_b1', kind: 'booth', x: 100, y: 500, w: 60, h: 60, r: 0, code: 'FLOWER', boothTypeId: 'type-std', blocked: false }] },
      booths: { z_b1: { status: 'available' } },
      boothTypes: types,
      book: instant,
    },
  };

  it('a booth on the map is a button, and a tap opens its card with Reserve', () => {
    render(<EventMapView map={map} slug="expo" />);
    fireEvent.click(screen.getByRole('button', { name: /Booth FLOWER, available/ }));
    expect(screen.getByText('Booth FLOWER')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Reserve this booth/ }))
      .toHaveAttribute('href', '/e/expo/vendors/booths/type-std?spot=z_b1');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Booth FLOWER')).toBeNull();
  });

  it('Enter on a focused booth opens it too', () => {
    render(<EventMapView map={map} slug="expo" />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Booth FLOWER/ }), { key: 'Enter' });
    expect(screen.getByRole('link', { name: /Reserve this booth/ })).toBeInTheDocument();
  });
});
