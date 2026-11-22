const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test';

/**
 * The organizer's sale emails (2026-11-23) — the rules that need no database:
 * when the daily summary is due, how tickets become lines, who is emailed,
 * and that both emails render.
 */
const notices = require('../services/saleNoticeService');
const email = require('../services/emailService');

test('the daily summary is due once a day, from 8 am in the organizer’s zone', () => {
  const zone = 'America/Toronto';
  // 12:30 UTC = 7:30 Toronto (EST, UTC−5) on 2026-11-23: not yet.
  assert.equal(notices.digestDue({ sale_digest_last_at: null }, zone, new Date('2026-11-23T12:30:00Z')), false);
  // 13:30 UTC = 8:30 Toronto: due, never sent before.
  assert.equal(notices.digestDue({ sale_digest_last_at: null }, zone, new Date('2026-11-23T13:30:00Z')), true);
  // Already sent at 8:05 today: not again until tomorrow.
  assert.equal(notices.digestDue({ sale_digest_last_at: '2026-11-23T13:05:00Z' }, zone, new Date('2026-11-23T20:00:00Z')), false);
  // Last sent yesterday: due.
  assert.equal(notices.digestDue({ sale_digest_last_at: '2026-11-22T13:05:00Z' }, zone, new Date('2026-11-23T13:10:00Z')), true);
  // An unknown zone falls back to UTC rather than failing.
  assert.equal(notices.localParts(new Date('2026-11-23T09:00:00Z'), 'Not/AZone').hour, 9);
});

test('tickets become one line per type, with their seats and extras', () => {
  const lines = notices.linesOf([
    { tierName: 'VIP', tableLabel: '4', seatNumber: '1', addons: ['Parking'] },
    { tierName: 'VIP', tableLabel: '4', seatNumber: '2', addons: [] },
    { tierName: 'Standard', addons: [] },
  ]);
  assert.deepEqual(lines.map((l) => [l.name, l.count]), [['VIP', 2], ['Standard', 1]]);
  assert.deepEqual(lines[0].addons, ['Parking']);
  assert.equal(lines[1].seats.length, 0, 'general admission is not a seat');
});

test('who is emailed: the owner unless unticked, plus up to five more, once each', () => {
  const org = (over) => ({ sale_email_owner: true, sale_email_recipients: [], profiles: { email: 'Owner@Org.test' }, ...over });
  assert.deepEqual(notices.recipientsOf(org()), ['owner@org.test']);
  assert.deepEqual(notices.recipientsOf(org({ sale_email_owner: false, sale_email_recipients: ['box@org.test'] })), ['box@org.test']);
  assert.deepEqual(notices.recipientsOf(org({ sale_email_recipients: ['owner@org.test', 'b@org.test'] })), ['owner@org.test', 'b@org.test']);
  assert.deepEqual(notices.cleanRecipients([' A@B.test ', 'a@b.test', '']), ['a@b.test']);
  assert.throws(() => notices.cleanRecipients(['not-an-email']), /not an email/);
  assert.throws(() => notices.cleanRecipients(['1@x.t', '2@x.t', '3@x.t', '4@x.t', '5@x.t', '6@x.t']), /at most 5/);
});

test('both emails render, with a buyer name full of markup', async () => {
  // No email provider in tests: `send` answers "not configured" after the HTML
  // has been built, which is the part under test.
  const sale = {
    orderId: 'o1', currency: 'CAD', tickets: 2, paidCents: 9000, discountCents: 1000, netCents: 8100,
    free: false, pending: false, channel: 'stripe', guestOf: 'The groom', promo: 'EARLY', at: '2026-11-23T15:00:00Z',
    event: { title: 'Gala <b>', starts_at: '2027-01-10T23:00:00Z', timezone: 'America/Toronto' },
    buyer: { name: '<script>x</script>', email: 'buyer@x.test', phone: '+1 416 555 0100' },
    lines: [{ name: 'VIP', count: 2, seats: ['Table 4 · Seat 1', 'Table 4 · Seat 2'], addons: ['Parking'] }],
    progress: { orders: 12, tickets: 30, sold: 30, capacity: 100, gross: [{ currency: 'CAD', cents: 270000, netCents: 240000 }] },
    url: 'https://site/organizer/events/e1/orders',
  };
  const one = await email.sendSaleToOrganizer({ to: 'owner@org.test', organizerName: 'Org', sale });
  assert.equal(one.sent, false);
  assert.equal(one.reason, 'not_configured');

  const digest = await email.sendSalesDigest({
    to: 'owner@org.test', organizerName: 'Org', timeZone: 'America/Toronto',
    since: '2026-11-22T13:00:00Z', until: '2026-11-23T13:00:00Z',
    events: [{ event: { id: 'e1', title: 'Gala' }, orders: 3, tickets: 5, url: 'https://site/x', money: [{ currency: 'CAD', paidCents: 15000, netCents: 13500 }] }],
  });
  assert.equal(digest.reason, 'not_configured');
});
