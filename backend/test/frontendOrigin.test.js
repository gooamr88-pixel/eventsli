const { test } = require('node:test');
const assert = require('node:assert/strict');
const { frontendOrigin } = require('../utils/frontendOrigin');

// The activation link is built from this. A link built from whatever `Origin`
// the request claimed would be an attacker's page in an email we sent.

test('an origin on the allowlist is used as sent', () => {
  assert.equal(frontendOrigin('https://staging.eventsli.com', 'https://eventsli.com, https://staging.eventsli.com'), 'https://staging.eventsli.com');
});

test('an origin that is not on the list falls back to the first entry', () => {
  assert.equal(frontendOrigin('https://evil.example', 'https://eventsli.com,https://staging.eventsli.com'), 'https://eventsli.com');
});

test('a missing origin falls back too, and trailing slashes do not matter', () => {
  assert.equal(frontendOrigin(undefined, 'https://eventsli.com/'), 'https://eventsli.com');
  assert.equal(frontendOrigin('https://eventsli.com/', 'https://eventsli.com'), 'https://eventsli.com');
});

test('with nothing configured it is the local frontend, never the claimed origin', () => {
  assert.equal(frontendOrigin('https://evil.example', ''), 'http://localhost:3000');
});
