const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const T = require('../services/vip/vipText');
const { clean, publicView, DEFAULTS } = require('../services/vip/vipSettings');
const webhook = require('../services/whatsapp/webhook');
const { templateText } = require('../services/whatsapp/cloudApi');
const waConfig = require('../services/whatsapp/config');

/**
 * VIP Services with WhatsApp (2026-11-28): the rules with no database —
 * references, links, which channel a message goes by, Meta's signature and
 * webhook payloads, and the settings.
 */

// ── References ───────────────────────────────────────────────────────────

test('a reference is VIP- and six unambiguous characters', () => {
  for (let i = 0; i < 200; i += 1) {
    const r = T.newReference();
    assert.match(r, /^VIP-[2-9A-HJ-NP-Z]{6}$/);
  }
  assert.equal(T.newReference(Buffer.from([0, 1, 2, 3, 4, 30])), 'VIP-23456Z');
});

test('references are found however they are typed, and only real ones', () => {
  assert.deepEqual(T.referencesIn('Hi, about VIP-7KQ2MX please'), ['VIP-7KQ2MX']);
  assert.deepEqual(T.referencesIn('vip 7kq2mx and VIP7KQ2MY'), ['VIP-7KQ2MX', 'VIP-7KQ2MY']);
  assert.deepEqual(T.referencesIn('VIP-7KQ2MX VIP-7KQ2MX'), ['VIP-7KQ2MX']);
  // 0, 1, I, L, O are never in a reference.
  assert.deepEqual(T.referencesIn('VIP-0OIL1X'), []);
  assert.deepEqual(T.referencesIn(''), []);
  assert.deepEqual(T.referencesIn(null), []);
});

// ── Numbers and links ────────────────────────────────────────────────────

test('numbers as people type them become E.164, or nothing', () => {
  assert.equal(T.normalisePhone('+1 (619) 666-6620'), '+16196666620');
  assert.equal(T.normalisePhone('0020 100 123 4567'), '+201001234567');
  assert.equal(T.normalisePhone('+20-100-123-4567'), '+201001234567');
  assert.equal(T.normalisePhone('619 666 6620'), null, 'no country code: not guessed');
  assert.equal(T.normalisePhone('+0123456789'), null);
  assert.equal(T.normalisePhone(''), null);
  assert.equal(T.displayPhone('+16196666620'), '+1 (619) 666-6620');
  assert.equal(T.displayPhone('+201001234567'), '+201001234567');
});

test('click-to-chat links carry the number in digits and the text encoded', () => {
  assert.equal(T.waLink('+16196666620'), 'https://wa.me/16196666620');
  const link = T.waLink('+16196666620', 'Hi & hello\nVIP-7KQ2MX');
  assert.equal(link, 'https://wa.me/16196666620?text=Hi%20%26%20hello%0AVIP-7KQ2MX');
  assert.equal(T.waLink('', 'x'), null);
});

test('the opening message puts the reference first and lists the rest', () => {
  const text = T.openingMessage({
    reference: 'VIP-7KQ2MX', contactName: 'Sara Haddad',
    serviceTitles: ['Seat map design', 'Door and check-in team'], eventLabel: 'Gala Night', eventDate: '2026-12-31',
  });
  const lines = text.split('\n');
  assert.match(lines[0], /VIP-7KQ2MX/);
  assert.ok(text.includes('Services: Seat map design, Door and check-in team'));
  assert.ok(text.includes('Event: Gala Night (2026-12-31)'));
  assert.deepEqual(T.referencesIn(text), ['VIP-7KQ2MX'], 'the webhook finds it again');
});

// ── Which channel ────────────────────────────────────────────────────────

const NOW = Date.parse('2026-11-28T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const decide = (over) => T.decideChannel({
  canSend: true, e164: '+16195550100', optIn: true, preferred: 'whatsapp', lastInboundAt: null, now: NOW, ...over,
});

test('they wrote on WhatsApp in the last 24 hours: a normal WhatsApp reply', () => {
  assert.equal(decide({ lastInboundAt: hoursAgo(2) }).via, 'whatsapp_text');
  // …even if they never ticked the box or prefer email: they are chatting there.
  assert.equal(decide({ lastInboundAt: hoursAgo(2), optIn: false, preferred: 'email' }).via, 'whatsapp_text');
});

test('the window closes a few minutes before 24 hours', () => {
  assert.equal(decide({ lastInboundAt: hoursAgo(23.8) }).via, 'whatsapp_text');
  assert.equal(decide({ lastInboundAt: hoursAgo(23.95) }).via, 'whatsapp_template');
  assert.equal(decide({ lastInboundAt: hoursAgo(30) }).via, 'whatsapp_template');
});

test('outside the window only an opted-in organizer who prefers WhatsApp gets the template', () => {
  assert.equal(decide({}).via, 'whatsapp_template');
  assert.equal(decide({ optIn: false }).via, 'email');
  assert.equal(decide({ preferred: 'email' }).via, 'email');
});

test('no number, or WhatsApp not connected: email, with the reason', () => {
  const a = decide({ e164: null, lastInboundAt: hoursAgo(1) });
  assert.equal(a.via, 'email');
  assert.match(a.reason, /No WhatsApp number/);
  const b = decide({ canSend: false, lastInboundAt: hoursAgo(1) });
  assert.equal(b.via, 'email');
  assert.match(b.reason, /not connected/);
});

test('template parameters: first name, reference, the text flattened', () => {
  assert.deepEqual(T.templateParams({ contactName: '  Sara Haddad ', reference: 'VIP-7KQ2MX', text: 'Hello' }), ['Sara', 'VIP-7KQ2MX', 'Hello']);
  assert.equal(T.firstName(''), 'there');
  // Meta refuses a parameter with a newline, a tab or 4+ spaces in a row.
  assert.equal(templateText('a\nb\tc     d'), 'a b c   d');
  assert.equal(templateText(''), '-');
  const long = templateText('x'.repeat(2000));
  assert.equal(long.length, 900);
  assert.ok(long.endsWith('…'));
});

// ── Meta's signature ─────────────────────────────────────────────────────

const SECRET = 'app-secret-for-tests';
const sign = (raw, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

test('a webhook is believed only with the right signature over the raw bytes', () => {
  const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));
  assert.equal(webhook.verifySignature(raw, sign(raw), SECRET), true);
  assert.equal(webhook.verifySignature(raw, sign(raw).toUpperCase().replace('SHA256=', 'sha256='), SECRET), true);
  assert.equal(webhook.verifySignature(raw, sign(raw, 'another-secret'), SECRET), false);
  assert.equal(webhook.verifySignature(Buffer.from(`${raw} `), sign(raw), SECRET), false, 'one byte changed');
  assert.equal(webhook.verifySignature(raw, 'sha256=abc', SECRET), false);
  assert.equal(webhook.verifySignature(raw, undefined, SECRET), false);
  assert.equal(webhook.verifySignature(raw, sign(raw), ''), false, 'no secret, nothing believed');
  assert.equal(webhook.verifySignature(undefined, sign(raw), SECRET), false);
});

// ── Meta's payloads ──────────────────────────────────────────────────────

const envelope = (field, value, phoneNumberId = '111') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '16196666620', phone_number_id: phoneNumberId }, ...value } }] }],
});

test('an inbound text: who, what, when, their WhatsApp name', () => {
  const events = webhook.parse(envelope('messages', {
    contacts: [{ profile: { name: 'Sara' }, wa_id: '16195550100' }],
    messages: [{ from: '16195550100', id: 'wamid.A', timestamp: '1764331200', type: 'text', text: { body: 'Hi VIP-7KQ2MX' } }],
  }), { phoneNumberId: '111' });
  assert.equal(events.length, 1);
  assert.deepEqual(
    { kind: events[0].kind, from: events[0].from, name: events[0].name, text: events[0].text, waId: events[0].waId },
    { kind: 'message', from: '+16195550100', name: 'Sara', text: 'Hi VIP-7KQ2MX', waId: 'wamid.A' },
  );
  assert.equal(events[0].at, new Date(1764331200 * 1000).toISOString());
});

test('photos and documents keep their media id and caption; locations become a map link', () => {
  const events = webhook.parse(envelope('messages', {
    messages: [
      { from: '16195550100', id: 'wamid.P', timestamp: '1', type: 'image', image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'The hall' } },
      { from: '16195550100', id: 'wamid.D', timestamp: '1', type: 'document', document: { id: 'MEDIA2', mime_type: 'application/pdf', filename: 'floor.pdf' } },
      { from: '16195550100', id: 'wamid.L', timestamp: '1', type: 'location', location: { latitude: 32.7, longitude: -117.1, name: 'Venue' } },
      { from: '16195550100', id: 'wamid.R', timestamp: '1', type: 'reaction', reaction: { message_id: 'x', emoji: '' } },
    ],
  }));
  assert.equal(events.length, 3, 'a removed reaction is nothing to show');
  assert.deepEqual(events[0].media, { type: 'image', id: 'MEDIA1', mimeType: 'image/jpeg', filename: null, voice: undefined });
  assert.equal(events[0].text, 'The hall');
  assert.equal(events[1].media.filename, 'floor.pdf');
  assert.match(events[2].text, /Venue/);
  assert.match(events[2].text, /maps\.google\.com\/\?q=32\.7,-117\.1/);
});

test('delivery receipts, with the reason a message failed', () => {
  const events = webhook.parse(envelope('messages', {
    statuses: [
      { id: 'wamid.S', status: 'read', recipient_id: '16195550100', timestamp: '1' },
      { id: 'wamid.F', status: 'failed', recipient_id: '16195550100', timestamp: '1', errors: [{ code: 131047, title: 'Re-engagement message', error_data: { details: 'More than 24 hours' } }] },
    ],
  }));
  assert.deepEqual(events.map((e) => [e.kind, e.status]), [['status', 'read'], ['status', 'failed']]);
  assert.equal(events[1].errorCode, 131047);
  assert.match(events[1].error, /131047 Re-engagement message — More than 24 hours/);
});

test('what the team types in the WhatsApp Business app arrives as an echo', () => {
  const events = webhook.parse(envelope('smb_message_echoes', {
    message_echoes: [{ from: '16196666620', to: '16195550100', id: 'wamid.E', timestamp: '1', type: 'text', text: { body: 'On it!' } }],
  }));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'echo');
  assert.equal(events[0].to, '+16195550100');
  assert.equal(events[0].text, 'On it!');
});

test('another number on the same WhatsApp account, or junk: nothing', () => {
  const other = envelope('messages', { messages: [{ from: '16195550100', id: 'wamid.X', timestamp: '1', type: 'text', text: { body: 'x' } }] }, '999');
  assert.deepEqual(webhook.parse(other, { phoneNumberId: '111' }), []);
  assert.deepEqual(webhook.parse(null), []);
  assert.deepEqual(webhook.parse({ object: 'page', entry: [] }), []);
  assert.deepEqual(webhook.parse({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'no-from' }] } }] }] }), []);
});

// ── Settings ─────────────────────────────────────────────────────────────

test('nothing saved: the owner\'s number and email, every service on', () => {
  const s = clean(undefined);
  assert.equal(s.whatsappNumber, '+16196666620');
  assert.equal(s.email, 'info@eventsli.com');
  assert.equal(s.services.length, DEFAULTS.services.length);
  assert.ok(s.services.every((x) => x.enabled));
});

test('settings are cleaned: a bad number keeps the default, unknown services are dropped', () => {
  const s = clean({
    whatsappNumber: '+20 100 123 4567',
    email: 'NOT AN EMAIL',
    services: [{ key: 'seating', title: '  Maps  ', enabled: false }, { key: 'hack', title: 'x' }],
    notifyEmails: ['A@B.co', 'a@b.co', 'nope'],
  });
  assert.equal(s.whatsappNumber, '+201001234567');
  assert.equal(s.email, 'info@eventsli.com');
  const seating = s.services.find((x) => x.key === 'seating');
  assert.equal(seating.title, 'Maps');
  assert.equal(seating.enabled, false);
  assert.ok(!s.services.some((x) => x.key === 'hack'));
  assert.deepEqual(s.notifyEmails, ['a@b.co']);
  assert.equal(clean({ whatsappNumber: 'call me' }).whatsappNumber, '+16196666620');
});

test('switching every service off still leaves "Something else"', () => {
  const s = clean({ services: DEFAULTS.services.map((x) => ({ ...x, enabled: false })) });
  assert.deepEqual(s.services.filter((x) => x.enabled).map((x) => x.key), ['other']);
});

test('organizers see the offer, not who is emailed', () => {
  const v = publicView(clean({ services: [{ key: 'door', enabled: false }] }));
  assert.equal(v.notifyEmails, undefined);
  assert.ok(!v.services.some((x) => x.key === 'door'));
  assert.ok(v.services.every((x) => x.enabled === undefined));
});

// ── Configuration ────────────────────────────────────────────────────────

test('the console is told what is missing, never the values', () => {
  const st = waConfig.status({ token: 'secret-token', phoneNumberId: '111', appSecret: '', verifyToken: '', graphVersion: 'v23.0', updateTemplate: 'vip_request_update', templateLanguage: 'en', dryRun: false });
  assert.equal(st.sending, true);
  assert.equal(st.receiving, false);
  assert.deepEqual(st.missing, ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']);
  assert.ok(!JSON.stringify(st).includes('secret-token'));
  assert.deepEqual(waConfig.bootWarnings({ token: '', phoneNumberId: '', appSecret: '', verifyToken: '' }), [], 'nothing set: nothing to warn about');
  assert.equal(waConfig.bootWarnings({ token: 't', phoneNumberId: '', appSecret: '', verifyToken: '' }).length, 2);
});
