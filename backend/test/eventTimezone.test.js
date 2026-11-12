const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { reanchor, zonedToUtcIso, localParts } = require('../utils/zonedTime');
const places = require('../services/placesService');

/**
 * An event's time is the VENUE's time. These pin the two server pieces of
 * that: the venue's zone coming back from venue search, and the repair that
 * moves an event saved on the wrong (North American) zone to the right one
 * without changing the clock time everyone was shown.
 */

test('reanchor keeps the wall clock and moves the instant to the new zone', () => {
  // Saved as 8 pm Toronto (EST, −5) for a Sydney show (AEDT, +11).
  const wrong = zonedToUtcIso('2027-01-20T20:00', 'America/Toronto');
  assert.equal(wrong, '2027-01-21T01:00:00.000Z');

  const right = reanchor(wrong, 'America/Toronto', 'Australia/Sydney');
  assert.equal(right, '2027-01-20T09:00:00.000Z');
  assert.equal(localParts(right, 'Australia/Sydney').local, '2027-01-20T20:00');
  assert.equal((new Date(wrong) - new Date(right)) / 3600e3, 16);
});

test('reanchor handles half-hour zones and refuses unknown ones', () => {
  const vancouver = zonedToUtcIso('2026-11-20T19:30', 'America/Vancouver');
  const delhi = reanchor(vancouver, 'America/Vancouver', 'Asia/Kolkata');
  assert.equal(localParts(delhi, 'Asia/Kolkata').local, '2026-11-20T19:30');

  assert.equal(reanchor(vancouver, 'America/Vancouver', 'Not/AZone'), null);
  assert.equal(reanchor(null, 'America/Vancouver', 'Asia/Kolkata'), null);
});

test('validZone accepts IANA zones and nothing else', () => {
  assert.equal(places.validZone('Australia/Sydney'), 'Australia/Sydney');
  assert.equal(places.validZone(' Europe/London '), 'Europe/London');
  assert.equal(places.validZone('Mars/Olympus_Mons'), null);
  assert.equal(places.validZone(''), null);
  assert.equal(places.validZone(undefined), null);
  assert.equal(places.validZone({ id: 'Australia/Sydney' }), null);
});

/** Answers the next `https.request` with `body`, and records the request. */
function stubGoogle(body) {
  const seen = {};
  mock.method(https, 'request', (url, options, onResponse) => {
    seen.url = String(url);
    seen.headers = options.headers;
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setEncoding = () => {};
      onResponse(res);
      res.emit('data', JSON.stringify(body));
      res.emit('end');
    };
    return req;
  });
  return seen;
}

test('place details return the venue time zone, asked for in the field mask', async (t) => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  t.after(() => { delete process.env.GOOGLE_PLACES_API_KEY; mock.restoreAll(); });

  const seen = stubGoogle({
    id: 'ChIJ3S-JXmauEmsRUcIaWtf4MzE',
    displayName: { text: 'Sydney Opera House' },
    shortFormattedAddress: 'Bennelong Point, Sydney',
    addressComponents: [{ longText: 'Sydney', types: ['locality'] }],
    location: { latitude: -33.8568, longitude: 151.2153 },
    timeZone: { id: 'Australia/Sydney', version: '2025a' },
  });

  const place = await places.details({ placeId: 'ChIJ3S-JXmauEmsRUcIaWtf4MzE' });
  assert.match(seen.headers['X-Goog-FieldMask'], /(^|,)timeZone(,|$)/);
  assert.equal(place.timeZone, 'Australia/Sydney');
  assert.equal(place.city, 'Sydney');
});

test('a place without a usable zone returns null, never a guess', async (t) => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  t.after(() => { delete process.env.GOOGLE_PLACES_API_KEY; mock.restoreAll(); });

  stubGoogle({ id: 'x', displayName: { text: 'Somewhere' }, timeZone: { id: 'Not/AZone' } });
  const place = await places.details({ placeId: 'x' });
  assert.equal(place.timeZone, null);
});
