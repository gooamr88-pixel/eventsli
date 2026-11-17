const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Some modules below build a Supabase client on load; nothing here reaches the
// database, so placeholders are enough.
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-placeholder';

const {
  editConsequence, roughMonth, canAcceptTerms, termsAcceptedFor, partitionPatch,
} = require('../services/eventRules');
const T = require('../services/emailTemplates');
const email = require('../services/emailService');
const { isTransient } = require('../services/comingSoonService');
const purchasability = require('../services/purchasability');
const discovery = require('../controllers/discoveryController');

/**
 * "Coming soon" events (owner, 2026-11-17): a teaser published with a title,
 * a city, a cover and a month; a "Notify me" list; and sales opened later
 * through the normal publish checks.
 */

// ── The rough date ──────────────────────────────────────────────────────────

test('a whole month at the venue is a rough date', () => {
  // March 2027 in Toronto: 00:00 on the 1st (EST, -05:00) to 23:59 on the 31st (EDT, -04:00).
  assert.equal(roughMonth({
    startsAt: '2027-03-01T05:00:00.000Z', endsAt: '2027-04-01T03:59:00.000Z', timezone: 'America/Toronto',
  }), '2027-03');
  // February in a leap year ends on the 29th.
  assert.equal(roughMonth({
    startsAt: '2028-02-01T00:00:00.000Z', endsAt: '2028-02-29T23:59:00.000Z', timezone: 'UTC',
  }), '2028-02');
});

test('exact times are not a rough date', () => {
  for (const [startsAt, endsAt] of [
    ['2027-03-14T23:00:00.000Z', '2027-03-15T03:00:00.000Z'],          // an evening
    ['2027-03-01T00:00:00.000Z', '2027-03-30T23:59:00.000Z'],          // one day short
    ['2027-03-01T00:00:00.000Z', '2027-04-30T23:59:00.000Z'],          // two months
    ['2028-02-01T00:00:00.000Z', '2028-02-28T23:59:00.000Z'],          // leap year, a day short
  ]) {
    assert.equal(roughMonth({ startsAt, endsAt, timezone: 'UTC' }), null, `${startsAt} → ${endsAt}`);
  }
  // The same instants read in another zone are not that zone's month.
  assert.equal(roughMonth({
    startsAt: '2027-03-01T00:00:00.000Z', endsAt: '2027-03-31T23:59:00.000Z', timezone: 'America/Toronto',
  }), null);
  assert.equal(roughMonth({ startsAt: 'nonsense', endsAt: null, timezone: 'UTC' }), null);
});

// ── What an organizer may change ────────────────────────────────────────────

test('comingSoon is an organizer field, and a draft can switch either way', () => {
  const { allowed, denied } = partitionPatch({ comingSoon: true }, { isAdmin: false });
  assert.deepEqual(allowed, { coming_soon: true });
  assert.deepEqual(denied, []);
  for (const status of ['draft', 'rejected']) {
    const r = editConsequence({ status, columns: ['coming_soon'], isAdmin: false });
    assert.deepEqual(r.refused, [], status);
  }
});

test('a live event cannot switch between coming soon and on sale by an edit', () => {
  for (const comingSoon of [true, false]) {
    const r = editConsequence({ status: 'published', columns: ['coming_soon'], isAdmin: false, comingSoon });
    assert.deepEqual(r.refused, ['coming_soon']);
    assert.equal(r.reason, 'COMING_SOON_LOCKED');
  }
});

test('a live teaser is edited freely — nothing on it is on sale', () => {
  const r = editConsequence({
    status: 'published',
    columns: ['title', 'starts_at', 'ends_at', 'venue_name', 'venue_address', 'purchase_mode', 'updated_at'],
    isAdmin: false,
    comingSoon: true,
  });
  assert.deepEqual(r.refused, []);
  assert.equal(r.withdrawsLaunch, false);
  assert.equal(r.returnsToDraft, false, 'and it stays live');
});

test('an edit withdraws a waiting request to open sales', () => {
  const r = editConsequence({
    status: 'published', columns: ['venue_name'], isAdmin: false, comingSoon: true, launchRequested: true,
  });
  assert.deepEqual(r.refused, []);
  assert.equal(r.withdrawsLaunch, true, 'the admin must approve what they saw');
});

test('an event on sale keeps its review rules', () => {
  const r = editConsequence({ status: 'published', columns: ['venue_name'], isAdmin: false, comingSoon: false });
  assert.deepEqual(r.refused, ['venue_name']);
  assert.equal(r.reason, 'EVENT_ON_SALE');
});

// ── Terms ───────────────────────────────────────────────────────────────────

test('terms can be accepted before submitting and on a live teaser, not on an event on sale', () => {
  assert.equal(canAcceptTerms({ status: 'draft' }), true);
  assert.equal(canAcceptTerms({ status: 'published', comingSoon: true }), true);
  assert.equal(canAcceptTerms({ status: 'published', comingSoon: false }), false);
  assert.equal(canAcceptTerms({ status: 'pending_review', comingSoon: true }), false);
});

test('a live teaser needs the CURRENT terms to open sales', () => {
  const teaser = { status: 'published', coming_soon: true, terms_accepted_id: 'v1' };
  assert.equal(termsAcceptedFor(teaser, 'v2'), false, 'new terms since the teaser was published');
  assert.equal(termsAcceptedFor(teaser, 'v1'), true);
  // An event on sale keeps the version it went on sale under.
  assert.equal(termsAcceptedFor({ ...teaser, coming_soon: false }, 'v2'), true);
});

// ── Buying ──────────────────────────────────────────────────────────────────

test('a teaser cannot be bought online, whatever it accepts', async () => {
  const ways = await purchasability.forEvent({
    id: 'e1', listing_type: 'ticketed', coming_soon: true, accepts_stripe: true, accepts_manual: true,
  });
  assert.deepEqual(ways, { card: false, offline: false, free: false, online: false });
});

test('a teaser card shows the city, not the venue or a way to pay', () => {
  const card = discovery.shape({
    id: 'e1', slug: 'jazz', title: 'Jazz', coming_soon: true,
    venue_name: 'The Rex', city: 'Toronto', venue_lat: 43.65, venue_lng: -79.39,
    accepts_stripe: true, accepts_manual: true, starts_at: '2027-03-01T05:00:00Z', ends_at: '2027-04-01T03:59:00Z',
  });
  assert.equal(card.comingSoon, true);
  assert.equal(card.venue, null);
  assert.equal(card.venueLocation, null);
  assert.equal(card.city, 'Toronto');
  assert.deepEqual(card.payments, { card: false, manual: false });

  const onSale = discovery.shape({ id: 'e2', venue_name: 'The Rex', accepts_stripe: true });
  assert.equal(onSale.comingSoon, false);
  assert.equal(onSale.venue, 'The Rex');
});

// ── Email ───────────────────────────────────────────────────────────────────

test('an email names a teaser by its month, never an invented time', () => {
  const html = T.eventCard({
    title: 'Jazz', comingSoon: true, venue: 'The Rex', city: 'Toronto',
    startsAt: '2027-03-01T05:00:00.000Z', timezone: 'America/Toronto',
  });
  assert.match(html, /Coming soon · March 2027/);
  assert.doesNotMatch(html, /12:00/);
  assert.doesNotMatch(html, /The Rex/, 'the venue is not announced yet');
  assert.match(html, /Toronto/);
});

test('a failed notice is retried only when the failure was not the address', () => {
  for (const r of ['not_configured', 'network', 'http_429', 'http_500', 'http_503']) assert.equal(isTransient(r), true, r);
  for (const r of ['http_400', 'no_recipient', undefined]) assert.equal(isTransient(r), false, String(r));
});

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

test('the on-sale notice links to the event and says it is the only one', async () => {
  const r = await email.sendComingSoonOnSale({
    to: 'fan@example.com',
    event: { id: 'e1', slug: 'jazz-night', title: 'Jazz Night', startsAt: '2027-03-14T23:00:00Z', timezone: 'America/Toronto', city: 'Toronto' },
  });
  assert.equal(r.sent, true);
  assert.equal(sent[0].to[0].email, 'fan@example.com');
  assert.match(sent[0].subject, /Tickets are on sale — Jazz Night/);
  assert.match(sent[0].htmlContent, /one-time email/);
});

test('a teaser going live is not announced as "on sale"', async () => {
  await email.sendEventApproved({
    to: 'org@example.com', organizerName: 'Org', direct: true,
    event: { id: 'e1', slug: 'jazz', title: 'Jazz', comingSoon: true, startsAt: '2027-03-01T05:00:00Z', timezone: 'America/Toronto' },
  });
  assert.match(sent[0].htmlContent, /coming-soon page/);
  assert.doesNotMatch(sent[0].htmlContent, /now on sale/);
});

test('a declined launch says the teaser is still live', async () => {
  await email.sendLaunchDeclined({
    to: 'org@example.com', organizerName: 'Org', reason: 'Add the venue address.',
    event: { id: 'e1', slug: 'jazz', title: 'Jazz', startsAt: '2027-03-01T05:00:00Z', timezone: 'America/Toronto' },
  });
  assert.match(sent[0].subject, /Ticket sales not opened yet/);
  assert.match(sent[0].htmlContent, /still live/);
  assert.match(sent[0].htmlContent, /Add the venue address\./);
});
