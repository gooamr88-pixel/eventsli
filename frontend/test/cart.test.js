import { describe, test, expect, beforeEach } from 'vitest';
import { cartItemFor, withMyHolds, selectionFromCart } from '../src/app/e/[slug]/seats/cartSeats';
import {
  cartEntries, addToCart, dropFromCart, syncCart, rememberBuyer, recalledBuyer,
} from '../src/app/lib/cartStore';

/**
 * The ticket cart (2026-11-17): what the device keeps, and how the buyer's own
 * hold is shown on the seat map so it can be changed.
 */

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const item = (over = {}) => ({
  reservationId: 'r1', reservationToken: 't1', event: { slug: 'gala' }, selection: { seatIds: ['s1', 's2'] }, ...over,
});
const map = {
  seats: [
    { id: 's1', tableId: 'T', available: false, reason: 'held' },
    { id: 's2', tableId: 'T', available: false },
    { id: 's3', tableId: 'T', available: false },
    { id: 's4', tableId: 'U', available: true },
  ],
  tables: [{ id: 'T', label: '1', canBookWhole: false }, { id: 'U', label: '2', canBookWhole: true }],
};

describe('the buyer’s own hold on the map', () => {
  test('finds the cart item for this event only', () => {
    expect(cartItemFor([item()], 'gala').reservationId).toBe('r1');
    expect(cartItemFor([item()], 'other')).toBeNull();
  });

  test('draws their held seats as available, and nobody else’s', () => {
    const out = withMyHolds(map, item());
    expect(out.seats.find((s) => s.id === 's1')).toMatchObject({ available: true, reason: null });
    expect(out.seats.find((s) => s.id === 's2').available).toBe(true);
    expect(out.seats.find((s) => s.id === 's3').available).toBe(false);
    expect(map.seats[0].available).toBe(false); // the input is not changed
  });

  test('a held whole table is bookable again, with its seats', () => {
    const out = withMyHolds(map, item({ selection: { tableId: 'T' } }));
    expect(out.tables.find((t) => t.id === 'T').canBookWhole).toBe(true);
    expect(out.seats.filter((s) => s.tableId === 'T').every((s) => s.available)).toBe(true);
  });

  test('the page starts with what the cart holds', () => {
    expect(selectionFromCart(map, item()).seats.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(selectionFromCart(map, item({ selection: { tableId: 'U' } })).table.label).toBe('2');
    expect(selectionFromCart(map, null)).toEqual({ seats: [], table: null });
  });
});

describe('the cart on this device', () => {
  test('keeps one entry per hold, and a replace drops the old one', () => {
    addToCart({ reservationId: 'a', reservationToken: 'ta', slug: 'x' });
    addToCart({ reservationId: 'b', reservationToken: 'tb', slug: 'y' });
    addToCart({ reservationId: 'c', reservationToken: 'tc', slug: 'x' }, { replaces: 'a' });
    expect(cartEntries().map((e) => e.reservationId)).toEqual(['b', 'c']);
    dropFromCart('b');
    expect(cartEntries().map((e) => e.reservationId)).toEqual(['c']);
  });

  test('the server’s answer wins, with fresh tokens', () => {
    addToCart({ reservationId: 'a', reservationToken: 'old', slug: 'x' });
    syncCart([{ reservationId: 'a', reservationToken: 'new', event: { slug: 'x' } }, { reservationId: 'z', reservationToken: 'tz', event: { slug: 'q' } }]);
    expect(cartEntries()).toEqual([
      expect.objectContaining({ reservationId: 'a', reservationToken: 'new' }),
      expect.objectContaining({ reservationId: 'z', slug: 'q' }),
    ]);
  });

  test('a hold added while an answer was on its way is not dropped by it', () => {
    const askedAt = new Date(Date.now() - 1000).toISOString();
    addToCart({ reservationId: 'late', reservationToken: 'tl', slug: 'x' });
    syncCart([], { askedAt });
    expect(cartEntries().map((e) => e.reservationId)).toEqual(['late']);
    syncCart([]); // the next answer speaks for it
    expect(cartEntries()).toEqual([]);
  });

  test('corrupt storage is an empty cart, not a broken page', () => {
    localStorage.setItem('eventsli.cart.v1', '{not json');
    expect(cartEntries()).toEqual([]);
  });

  test('the buyer’s details are kept for the next checkout, in this tab only', () => {
    expect(recalledBuyer()).toBeNull();
    rememberBuyer({ name: 'Ada', email: 'ada@example.com', phone: '+1 416 555 0100' });
    expect(recalledBuyer()).toEqual({ name: 'Ada', email: 'ada@example.com', phone: '+1 416 555 0100' });
    expect(localStorage.getItem('eventsli.cart.buyer')).toBeNull();
  });
});
