import { describe, test, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
const { nameParts, withName } = await import('../src/app/checkout/[reservationId]/CheckoutClient');

/**
 * Checkout's "Your details" asks for First name and Last name in two boxes
 * (owner, 2026-11-24: "still not appear first and last"). The API still
 * receives one name: the two joined.
 */
describe('checkout buyer name boxes', () => {
  test('a remembered full name splits into first word and the rest', () => {
    expect(nameParts('Ahmed Albasrawi')).toEqual({ first: 'Ahmed', last: 'Albasrawi' });
    expect(nameParts('  Ana  Maria Buyer ')).toEqual({ first: 'Ana', last: 'Maria Buyer' });
    expect(nameParts('')).toEqual({ first: '', last: '' });
  });

  test('typing in either box keeps the joined name the API reads', () => {
    const b = withName({ email: 'a@x.test' }, 'Ahmed ', '');
    expect(b).toEqual({ email: 'a@x.test', first: 'Ahmed ', last: '', name: 'Ahmed' });
    expect(withName(b, 'Ahmed', ' Albasrawi').name).toBe('Ahmed Albasrawi');
  });
});
