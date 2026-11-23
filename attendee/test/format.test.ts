import type { Order } from '../src/api/types';
import { isUpcoming } from '../src/hooks/useTickets';
import { countdown, eventTime, eventSpanText, minorDigits, money, price } from '../src/lib/format';

/**
 * Money is an integer in the currency's MINOR unit. Dividing everything by 100
 * would print yen a hundred times too small and dinar ten times too large —
 * and every one of those prices is on a Pay button.
 */
describe('money', () => {
  it('knows each currency\'s decimals', () => {
    expect(minorDigits('USD')).toBe(2);
    expect(minorDigits('EGP')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
    expect(minorDigits('KWD')).toBe(3);
  });

  it('prints the amount the minor units mean', () => {
    expect(money(320000, 'EGP')).toMatch(/3,200/);
    expect(money(4050, 'USD')).toBe('$40.50');
    expect(money(3000, 'JPY')).toMatch(/3,000/);
    expect(money(12500, 'KWD')).toMatch(/12\.5/);
  });

  it('drops .00 on whole amounts but keeps a real fraction', () => {
    expect(money(4000, 'USD')).toBe('$40');
    expect(money(4001, 'USD')).toBe('$40.01');
  });

  it('says Free for zero and nothing for an unknown price', () => {
    expect(price(0, 'USD')).toBe('Free');
    expect(money(null, 'USD')).toBe('');
    expect(money(100, null)).toBe('');
  });
});

describe('event times', () => {
  it('are told in the event\'s zone, not the phone\'s', () => {
    // 18:00Z is 8 PM in Cairo (UTC+2 in November) whoever holds the phone.
    expect(eventTime('2026-11-20T18:00:00Z', 'Africa/Cairo')).toBe('8:00 PM');
    expect(eventTime('2026-11-20T18:00:00Z', 'America/Toronto')).toBe('1:00 PM');
  });

  it('name both days when an event runs past midnight into another date', () => {
    const span = eventSpanText('2026-11-20T18:00:00Z', '2026-11-22T02:00:00Z', 'Africa/Cairo');
    expect(span.date).toMatch(/Nov 20 – Nov 22, 2026/);
    expect(span.time).toMatch(/Nov 20, 8:00 PM – Nov 22, 4:00 AM/);
  });

  it('count a hold down in minutes and seconds', () => {
    expect(countdown(12 * 60_000 + 4_000)).toBe('12:04');
    expect(countdown(-5)).toBe('0:00');
  });
});

describe('My Tickets: upcoming or past', () => {
  const order = (startsAt: string, endsAt: string | null): Order => ({
    orderId: 'o', currency: 'USD', totalCents: 100, purchasedAt: startsAt, tickets: [],
    event: { id: 'e', title: 't', slug: 's', startsAt, endsAt, timezone: 'UTC', venue: null, cancelled: false },
  });
  const now = Date.parse('2026-11-20T21:00:00Z');

  it('keeps a show that has started but not ended under Upcoming — that is when the code is needed', () => {
    expect(isUpcoming(order('2026-11-20T20:00:00Z', '2026-11-20T23:00:00Z'), now)).toBe(true);
  });

  it('files it under Past once it has ended', () => {
    expect(isUpcoming(order('2026-11-20T17:00:00Z', '2026-11-20T20:00:00Z'), now)).toBe(false);
  });

  it('gives an event with no end time six hours from its start', () => {
    expect(isUpcoming(order('2026-11-20T18:00:00Z', null), now)).toBe(true);
    expect(isUpcoming(order('2026-11-20T10:00:00Z', null), now)).toBe(false);
  });
});
