const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const email = require('../services/emailService');
const { SETTING_DEFAULTS, validateSetting } = require('../utils/settingsSchema');

/**
 * Publish first, review after (owner, 2026-11-03): the setting that controls
 * it, and the emails it sends — admins when an event goes live, the organizer
 * when an admin rejects, suspends or cancels it, with the admin's reason.
 *
 * No network: `fetch` is replaced and the Brevo request it would have sent is
 * read back.
 */

let sent;
let savedFetch;
let savedKey;
beforeEach(() => {
  sent = [];
  savedFetch = global.fetch;
  savedKey = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = 'test-key';
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 201, json: async () => ({ messageId: 'm1' }), text: async () => '' };
  };
});
afterEach(() => {
  global.fetch = savedFetch;
  if (savedKey === undefined) delete process.env.BREVO_API_KEY; else process.env.BREVO_API_KEY = savedKey;
});

const EVENT = {
  id: 'e1', slug: 'spring-gala', title: 'Spring Gala', listingType: 'ticketed',
  startsAt: '2026-12-05T23:00:00.000Z', timezone: 'America/Toronto', venue: 'Harbourfront Hall', city: 'Toronto',
};

test('publishing needs no approval by default, and the switch is a real on/off', () => {
  assert.equal(SETTING_DEFAULTS.event_publishing.require_approval, false);
  assert.deepEqual(validateSetting('event_publishing', { require_approval: true }), { ok: true, value: { require_approval: true } });
  assert.equal(validateSetting('event_publishing', { require_approval: 'yes' }).ok, false);
});

test('admins are told a new event is live, with a link to review it', async () => {
  await email.sendEventPublishedToAdmins({
    to: 'owner@eventsli.test', event: EVENT, organizerName: 'Harbour Events',
    adminUrl: 'https://eventsli.com/admin/events/e1', publicUrl: 'https://eventsli.com/e/spring-gala',
  });
  const [msg] = sent;
  assert.equal(msg.to[0].email, 'owner@eventsli.test');
  assert.equal(msg.subject, 'New event live — Spring Gala');
  assert.match(msg.htmlContent, /Harbour Events/);
  assert.match(msg.htmlContent, /https:\/\/eventsli\.com\/admin\/events\/e1/);
  assert.match(msg.htmlContent, /Reject/);
});

test('a live event taken down tells the organizer why, in the admin\'s words — escaped', async () => {
  await email.sendEventRejected({
    to: 'org@eventsli.test', organizerName: 'Harbour Events', event: EVENT, wasLive: true,
    reason: 'The poster uses an artist\'s photo without permission. <script>alert(1)</script>',
  });
  const [msg] = sent;
  assert.equal(msg.subject, 'Taken down for changes — Spring Gala');
  assert.match(msg.htmlContent, /artist&#39;s photo|artist's photo/);
  assert.ok(!msg.htmlContent.includes('<script>alert(1)</script>'), 'the reason is escaped');
  assert.match(msg.htmlContent, /Tickets already sold stay valid/);
});

test('suspension and cancellation each carry the reason, and say what happens to tickets', async () => {
  await email.sendEventSuspended({ to: 'org@eventsli.test', organizerName: 'H', event: EVENT, reason: 'Venue licence under review.' });
  await email.sendEventCancelledByAdmin({ to: 'org@eventsli.test', organizerName: 'H', event: EVENT, reason: 'The venue closed permanently.' });
  assert.equal(sent[0].subject, 'Suspended — Spring Gala');
  assert.match(sent[0].htmlContent, /Venue licence under review\./);
  assert.match(sent[0].htmlContent, /not a cancellation/);
  assert.equal(sent[1].subject, 'Cancelled by Eventsli — Spring Gala');
  assert.match(sent[1].htmlContent, /The venue closed permanently\./);
  assert.match(sent[1].htmlContent, /no longer admit anyone/);
});

test('the organizer hears their event is live, and that review comes afterwards', async () => {
  await email.sendEventApproved({ to: 'org@eventsli.test', organizerName: 'H', event: EVENT, url: 'https://eventsli.com/e/spring-gala', direct: true });
  const [msg] = sent;
  assert.equal(msg.subject, 'Spring Gala is live');
  assert.match(msg.htmlContent, /is published and is now on sale/);
  assert.match(msg.htmlContent, /reviews new events after they go live/);
});
