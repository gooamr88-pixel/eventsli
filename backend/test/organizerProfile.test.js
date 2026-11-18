const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-placeholder';

const { supabase } = require('../config/supabase');
const P = require('../services/organizerProfileService');

/**
 * Organizer public profiles + "Message the organizer" (owner, 2026-11-18).
 */

const realFrom = supabase.from.bind(supabase);
afterEach(() => { supabase.from = realFrom; });

const refuses = (fn, pattern) => assert.throws(fn, (e) => e.code === 'VALIDATION_ERROR' && (!pattern || pattern.test(e.message)));

test('page address: lowercase words and single hyphens, 2–60, not reserved', () => {
  assert.equal(P.slugOf('Starlight-Events'), 'starlight-events');
  refuses(() => P.slugOf('a'));
  refuses(() => P.slugOf('two--hyphens'));
  refuses(() => P.slugOf('-edge'));
  refuses(() => P.slugOf('with space'));
  refuses(() => P.slugOf('admin'), /reserved/);
});

test('a social handle becomes a link on that network', () => {
  assert.equal(P.socialLink('instagram', '@starlight.events'), 'https://instagram.com/starlight.events');
  assert.equal(P.socialLink('tiktok', 'starlight'), 'https://tiktok.com/@starlight');
  assert.equal(P.socialLink('x', 'https://twitter.com/starlight'), 'https://twitter.com/starlight');
  assert.equal(P.socialLink('instagram', ''), null, 'empty clears it');
});

test('a link to another site in a network box is refused — no phishing via "Instagram"', () => {
  refuses(() => P.socialLink('instagram', 'https://evil.example/instagram.com'), /instagram\.com/);
  refuses(() => P.socialLink('facebook', 'http://facebook.com/x'), /facebook\.com/);
  refuses(() => P.socialLink('youtube', 'bad handle!'));
});

test('website gets https:// when typed bare; nonsense is refused', () => {
  assert.equal(P.websiteUrl('starlight.ca'), 'https://starlight.ca/');
  assert.equal(P.websiteUrl(''), null);
  refuses(() => P.websiteUrl('not a site'));
  refuses(() => P.websiteUrl('javascript:alert(1)'));
});

test('public email and phone are checked, and optional', () => {
  assert.equal(P.publicEmail('hello@starlight.ca'), 'hello@starlight.ca');
  assert.equal(P.publicEmail(''), null);
  refuses(() => P.publicEmail('nope'));
  assert.equal(P.publicPhone('+1 (416) 555-0100'), '+1 (416) 555-0100');
  refuses(() => P.publicPhone('call me'));
});

test('the public shape shows only what was published — never an account email', () => {
  const shaped = P.publicShape({
    slug: 's', display_name: 'Starlight', description: null, country: 'CA', created_at: '2026-01-01',
    logo_path: null, public_email: null, public_phone: '+1 555 0100', website_url: null,
    social_links: { instagram: 'https://instagram.com/s', bogus: 'https://x' },
  });
  assert.deepEqual(shaped.contact, { email: null, phone: '+1 555 0100', website: null });
  assert.deepEqual(shaped.social, [{ key: 'instagram', label: 'Instagram', url: 'https://instagram.com/s' }]);
  assert.equal('owner_user_id' in shaped, false);
});

/** A tiny query stub: each table answers with the rows given. */
function stub(tables) {
  const inserted = [];
  supabase.from = (table) => {
    const rows = tables[table];
    const chain = {
      select: () => chain, eq: () => chain, gte: () => chain, update: () => chain,
      maybeSingle: async () => ({ data: rows, error: null }),
      single: async () => ({ data: { id: 'msg-1' }, error: null }),
      insert: (row) => { inserted.push({ table, row }); return chain; },
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    return chain;
  };
  return inserted;
}

const order = { id: 'abcdef12-0000', guest_email: 'buyer@example.com', guest_name: 'Sam', events: { id: 'e1', title: 'Gala', slug: 'gala', organizer_id: 'o1' }, profiles: null };

test('a message is refused once the order has sent its hourly share', async () => {
  const recent = Array.from({ length: P.LIMITS.perHour }, () => ({ created_at: new Date().toISOString() }));
  stub({ orders: order, organizer_messages: recent });
  await assert.rejects(P.messageFromOrder({ orderId: order.id, body: 'Is there parking?' }), (e) => e.code === 'RATE_LIMITED');
});

test('an empty or overlong message is refused before anything is read', async () => {
  await assert.rejects(P.messageFromOrder({ orderId: 'x', body: ' ' }), (e) => e.code === 'VALIDATION_ERROR');
  await assert.rejects(P.messageFromOrder({ orderId: 'x', body: 'a'.repeat(2001) }), (e) => e.code === 'VALIDATION_ERROR');
});

test('a message is recorded with the buyer as sender, then emailed to the organizer', async () => {
  const inserted = stub({ orders: order, organizer_messages: [], organizers: { id: 'o1', display_name: 'Starlight', profiles: { email: 'owner@starlight.ca' } } });
  const email = require('../services/emailService');
  const realSend = email.sendOrganizerMessage;
  let sent;
  email.sendOrganizerMessage = async (args) => { sent = args; return { sent: true }; };
  try {
    const result = await P.messageFromOrder({ orderId: order.id, body: 'Is there parking?' });
    assert.equal(result.sent, true);
    assert.equal(inserted[0].table, 'organizer_messages');
    assert.equal(inserted[0].row.sender_email, 'buyer@example.com');
    assert.equal(sent.to, 'owner@starlight.ca');
    assert.equal(sent.senderEmail, 'buyer@example.com', 'the reply goes to the buyer');
    assert.equal(sent.orderRef, 'ABCDEF12');
  } finally {
    email.sendOrganizerMessage = realSend;
  }
});
