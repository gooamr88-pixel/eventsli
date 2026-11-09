const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sellableSeats } = require('../services/seatSellability');

/**
 * The public seat map's "can this be bought" rules (TECH-AUDIT-LOG S-07). They
 * mirror hold_seats, so each refusal it makes has a case here.
 */

const now = new Date('2026-11-09T12:00:00Z');
const tier = (over) => ({
  id: 't1', price_cents: 5000, quantity: null, sold_count: 0, sales_start_at: null, sales_end_at: null, ...over,
});
const seat = (over) => ({ id: 's', tier_id: 't1', status: 'available', price_override_cents: null, ...over });

test('an available, priced seat of a type on sale can be bought', () => {
  const s = sellableSeats([seat()], [tier()], now);
  assert.equal(s.reasonFor(seat()), null);
  assert.equal(s.priceOf(seat()), 5000);
});

test('held, sold and blocked seats are all just "taken" to a buyer', () => {
  const s = sellableSeats([], [tier()], now);
  for (const status of ['held', 'sold', 'blocked']) assert.equal(s.reasonFor(seat({ status })), 'taken');
});

test('a seat with no override and no ticket type is not on sale — zero is a price, nothing is not', () => {
  const s = sellableSeats([], [tier({ price_cents: 0 })], now);
  assert.equal(s.reasonFor(seat({ tier_id: null })), 'not_on_sale');
  assert.equal(s.priceOf(seat({ tier_id: null })), null);
  assert.equal(s.reasonFor(seat()), null, 'a free ticket type is a price');
  assert.equal(s.reasonFor(seat({ tier_id: null, price_override_cents: 2500 })), null, 'an override is a price');
});

test('a type outside its sale window is not on sale, at either end', () => {
  const early = sellableSeats([], [tier({ sales_start_at: '2026-11-10T00:00:00Z' })], now);
  assert.equal(early.reasonFor(seat()), 'not_on_sale');
  const ended = sellableSeats([], [tier({ sales_end_at: '2026-11-09T12:00:00Z' })], now);
  assert.equal(ended.reasonFor(seat()), 'not_on_sale', 'the end instant is already closed, as in SQL');
  assert.equal(ended.tier.get('t1').onSale, false);
});

test('an allocation used up by sales AND live holds is sold out', () => {
  const seats = [seat({ id: 'a', status: 'held' }), seat({ id: 'b' })];
  const s = sellableSeats(seats, [tier({ quantity: 2, sold_count: 1 })], now);
  assert.equal(s.reasonFor(seats[1]), 'sold_out');
  assert.equal(s.tier.get('t1').soldOut, true);

  const room = sellableSeats(seats, [tier({ quantity: 3, sold_count: 1 })], now);
  assert.equal(room.reasonFor(seats[1]), null);
});
