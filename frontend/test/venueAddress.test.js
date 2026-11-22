import { describe, test, expect } from 'vitest';
import {
  VENUE_TBA, addressLine, addressLines, addressParts, hasVenue, mapQueryAddress,
} from '../src/app/lib/venueAddress';

/**
 * The event's address in full (2026-11-22, the owner: "the address may be
 * somewhere like a home — more details, the postal code, all optional").
 */
const home = {
  venueAddress: '147 Danforth Ave', venueAddressLine2: 'Apt 4B', city: 'Toronto',
  venueRegion: 'ON', venuePostalCode: 'M4K 1N2', venueDirections: 'Ring buzzer 12',
};

describe('one address, every part optional', () => {
  test('every part, in the order a letter is addressed', () => {
    expect(addressLine(home)).toBe('147 Danforth Ave, Apt 4B, Toronto, ON M4K 1N2');
    expect(addressLines(home)).toEqual(['147 Danforth Ave, Apt 4B', 'Toronto, ON M4K 1N2']);
    expect(addressParts(home).directions).toBe('Ring buzzer 12');
  });

  test('the server’s one-line form wins', () => {
    expect(addressLine({ ...home, venueAddressFull: 'From the server' })).toBe('From the server');
  });

  test('missing parts are left out, never printed as blanks', () => {
    expect(addressLine({ city: 'Toronto', venuePostalCode: 'M4K 1N2' })).toBe('Toronto, M4K 1N2');
    expect(addressLine({ venueAddress: '  ', city: '' })).toBeNull();
    expect(addressLine(null)).toBeNull();
  });

  test('a street that already names the city does not say it twice', () => {
    expect(addressLine({ venueAddress: '11 Polson St, Toronto', city: 'Toronto' })).toBe('11 Polson St, Toronto');
  });

  test('maps are asked without the unit number', () => {
    expect(mapQueryAddress(home)).toBe('147 Danforth Ave, Toronto, ON M4K 1N2');
    expect(mapQueryAddress({ city: 'Toronto' })).toBeNull();
  });

  test('a venue is "given" by a name or an address; otherwise it is to be announced', () => {
    expect(hasVenue({ venue: 'Rebel' })).toBe(true);
    expect(hasVenue({ venueAddressLine2: 'Unit 3' })).toBe(true);
    expect(hasVenue({ city: 'Toronto' })).toBe(false);
    expect(VENUE_TBA).toBe('Venue to be announced');
  });
});
