const { test } = require('node:test');
const assert = require('node:assert/strict');
const links = require('../services/shareLinks');

/**
 * A QR code is a link printed on a poster. These prove the link can only ever
 * point at our own public event page, whatever a slug or tier name contains.
 */

test('the origin is PUBLIC_SITE_URL when set', () => {
  assert.equal(
    links.siteOrigin({ PUBLIC_SITE_URL: 'https://eventsli.com/', FRONTEND_URL: 'http://localhost:3000' }),
    'https://eventsli.com',
  );
});

test('otherwise the first FRONTEND_URL, never a later one', () => {
  assert.equal(
    links.siteOrigin({ FRONTEND_URL: ' https://eventsli.com , https://staging.eventsli.com' }),
    'https://eventsli.com',
  );
});

test('an origin with a path keeps only the origin', () => {
  assert.equal(links.siteOrigin({ PUBLIC_SITE_URL: 'https://eventsli.com/some/path?x=1' }), 'https://eventsli.com');
});

test('an event link is the public event page', () => {
  assert.equal(links.eventUrl('summer-gala', 'https://eventsli.com'), 'https://eventsli.com/e/summer-gala');
});

test('a tier link deep-links to the tier on that page', () => {
  const url = new URL(links.tierUrl('summer-gala', '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', 'https://eventsli.com'));
  assert.equal(url.pathname, '/e/summer-gala');
  assert.equal(url.searchParams.get('tier'), '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed');
});

test('a hostile slug cannot move the link to another host or path', () => {
  for (const slug of ['../../admin', '//evil.test', 'x?tier=1#frag', 'a/b', '@evil.test']) {
    const url = new URL(links.eventUrl(slug, 'https://eventsli.com'));
    assert.equal(url.host, 'eventsli.com', slug);
    assert.ok(url.pathname.startsWith('/e/'), slug);
    assert.equal(url.pathname.split('/').length, 3, `${slug} must stay one path segment`);
    assert.equal(url.search, '', slug);
  }
});

test('a download filename contains nothing a header could be broken with', () => {
  assert.match(links.qrFilename('summer-gala', 'VIP / Front "row"\r\nX-Evil: 1'), /^[a-z0-9-]+-qr\.png$/);
  assert.equal(links.qrFilename('summer-gala'), 'summer-gala-qr.png');
});
