const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addressLine, addressFields, addressParts } = require('../utils/venueAddress');

/** The event's address in full (2026-11-22): every part optional. */

const row = {
  venue_address: '147 Danforth Ave', venue_address_line2: 'Apt 4B', city: 'Toronto',
  venue_region: 'ON', venue_postal_code: 'M4K 1N2', venue_directions: 'Ring buzzer 12',
};

test('a row prints every part given, in letter order', () => {
  assert.equal(addressLine(row), '147 Danforth Ave, Apt 4B, Toronto, ON M4K 1N2');
  assert.deepEqual(addressFields(row), {
    venueAddressLine2: 'Apt 4B', venueRegion: 'ON', venuePostalCode: 'M4K 1N2',
    venueDirections: 'Ring buzzer 12', venueAddressFull: '147 Danforth Ave, Apt 4B, Toronto, ON M4K 1N2',
  });
});

test('nothing given is null; blanks are left out; the city is said once', () => {
  assert.equal(addressLine({ venue_address: ' ', city: null }), null);
  assert.equal(addressLine(null), null);
  assert.equal(addressLine({ city: 'Toronto', venue_postal_code: 'M4K' }), 'Toronto, M4K');
  assert.equal(addressLine({ venue_address: '11 Polson St, Toronto', city: 'Toronto' }), '11 Polson St, Toronto');
});

test('camelCase shapes read the same', () => {
  assert.equal(addressParts({ venueAddress: '1 Main', venueAddressLine2: 'Unit 3' }).line2, 'Unit 3');
  assert.equal(addressLine({ venueAddress: '1 Main', venueAddressLine2: 'Unit 3', city: 'Ottawa' }), '1 Main, Unit 3, Ottawa');
});
