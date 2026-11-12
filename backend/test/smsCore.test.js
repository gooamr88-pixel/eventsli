const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const phone = require('../services/sms/phone');
const { analyze } = require('../services/sms/segments');
const { classify } = require('../services/sms/keywords');
const { quietUntil, isQuiet } = require('../services/sms/quietHours');
const { evaluate } = require('../services/sms/policy');
const routing = require('../services/sms/routing');
const { nextStep } = require('../services/sms/outcome');
const { compose } = require('../services/sms/compose');
const { normalizeDefinition, describe: describeSegment } = require('../services/sms/segmentDefinition');
const { exclusion } = require('../services/sms/eligibility');

/**
 * The SMS pipeline's pure core: numbering, segments, keywords, the compliance
 * policy, routing and the duplicate-prevention rule. No database, no network.
 */

const COUNTRIES = [
  { iso2: 'US', dial_code: '1', prefixes: [], dial_primary: true },
  { iso2: 'CA', dial_code: '1', prefixes: ['1416', '1604', '1514'], dial_primary: false },
  { iso2: 'BS', dial_code: '1', prefixes: ['1242'], dial_primary: false },
  { iso2: 'GB', dial_code: '44', prefixes: [], dial_primary: true },
  { iso2: 'JE', dial_code: '44', prefixes: ['447797'], dial_primary: false },
  { iso2: 'RU', dial_code: '7', prefixes: [], dial_primary: true },
  { iso2: 'KZ', dial_code: '7', prefixes: ['76', '77'], dial_primary: false },
  { iso2: 'EG', dial_code: '20', prefixes: [], dial_primary: true },
  { iso2: 'IT', dial_code: '39', prefixes: [], dial_primary: true },
  { iso2: 'BL', dial_code: '590', prefixes: [], dial_primary: false },
  { iso2: 'GP', dial_code: '590', prefixes: [], dial_primary: true },
];
const matcher = phone.buildMatcher(COUNTRIES);
const norm = (raw, defaultCountry) => phone.normalize(raw, { defaultCountry, matcher });

describe('phone numbers', () => {
  test('international formats normalise to E.164', () => {
    assert.deepEqual(norm('+1 (212) 555-0199'), { e164: '+12125550199', country: 'US' });
    assert.deepEqual(norm('0020 100 123 4567'), { e164: '+201001234567', country: 'EG' });
    assert.deepEqual(norm('011 44 7911 123456', 'US'), { e164: '+447911123456', country: 'GB' });
  });

  test('a national number takes the event country, dropping the trunk 0', () => {
    assert.deepEqual(norm('0100 123 4567', 'EG'), { e164: '+201001234567', country: 'EG' });
    assert.deepEqual(norm('07911 123456', 'GB'), { e164: '+447911123456', country: 'GB' });
    assert.deepEqual(norm('(416) 555-0199', 'CA'), { e164: '+14165550199', country: 'CA' });
  });

  test('Italy keeps its leading zero', () => {
    assert.equal(norm('06 1234 5678', 'IT').e164, '+390612345678');
  });

  test('shared calling codes resolve by the longest prefix', () => {
    assert.equal(norm('+1 416 555 0199').country, 'CA');
    assert.equal(norm('+1 242 555 0199').country, 'BS');
    assert.equal(norm('+1 917 555 0199').country, 'US');
    assert.equal(norm('+44 7797 123456').country, 'JE');
    assert.equal(norm('+44 7911 123456').country, 'GB');
    assert.equal(norm('+7 701 123 4567').country, 'KZ');
    assert.equal(norm('+7 912 123 4567').country, 'RU');
    // A non-primary country with no distinguishing prefix is never guessed.
    assert.equal(norm('+590 690 12 34 56').country, 'GP');
  });

  test('garbage is refused rather than guessed', () => {
    for (const bad of ['', null, 'call me', '12345', '+1 012 555 0199', '555-0199', '+999999999999999999']) {
      assert.equal(norm(bad, 'US'), null, String(bad));
    }
    assert.equal(norm('0412 345 678'), null, 'a national number with no default country');
  });

  test('extensions are stripped (they cannot receive SMS)', () => {
    assert.equal(norm('+1 212 555 0199 ext. 12').e164, '+12125550199');
  });

  test('mask shows enough to recognise, not enough to dial', () => {
    assert.equal(phone.mask('+12125550199'), '+121•••99');
    assert.ok(!phone.mask('+12125550199').includes('5550'));
  });
});

describe('segments', () => {
  test('GSM-7: 160 in one, 153 per part after', () => {
    assert.deepEqual(analyze('a'.repeat(160)), { encoding: 'GSM-7', units: 160, segments: 1 });
    assert.equal(analyze('a'.repeat(161)).segments, 2);
    assert.equal(analyze('a'.repeat(306)).segments, 2);
    assert.equal(analyze('a'.repeat(307)).segments, 3);
  });
  test('extension characters count twice', () => {
    assert.equal(analyze('€'.repeat(80)).units, 160);
    assert.equal(analyze('€'.repeat(81)).segments, 2);
  });
  test('one non-GSM character makes it UCS-2: 70, then 67', () => {
    assert.equal(analyze('مرحبا').encoding, 'UCS-2');
    assert.equal(analyze(`${'a'.repeat(69)}’`).segments, 1);
    assert.equal(analyze(`${'a'.repeat(70)}’`).segments, 2);
    assert.equal(analyze('🎟').units, 2, 'an emoji is two UTF-16 units');
  });
});

describe('keywords', () => {
  test('STOP and friends, any case, first word only', () => {
    for (const w of ['STOP', 'stop', 'Stop.', 'unsubscribe', 'STOPALL', 'arret', 'إلغاء', 'stop the music']) assert.equal(classify(w), 'stop', w);
    for (const w of ['START', 'yes', 'Unstop']) assert.equal(classify(w), 'start', w);
    assert.equal(classify('help'), 'help');
    assert.equal(classify('see you there'), null);
    assert.equal(classify(''), null);
  });
});

describe('quiet hours', () => {
  test('windows that wrap midnight', () => {
    assert.ok(isQuiet(22, 21, 8));
    assert.ok(isQuiet(3, 21, 8));
    assert.ok(!isQuiet(12, 21, 8));
    assert.ok(!isQuiet(12, 9, 9), 'an empty window is never quiet');
  });
  test('defers to the end of the window in the recipient’s zone', () => {
    const now = new Date('2026-11-12T21:30:00Z');   // 23:30 in Cairo (UTC+2)
    const until = quietUntil(now, 'Africa/Cairo', 21, 8);
    assert.ok(until);
    assert.equal(until.toISOString(), '2026-11-13T06:01:00.000Z');   // 08:01 Cairo
    assert.equal(quietUntil(new Date('2026-11-12T10:00:00Z'), 'Africa/Cairo', 21, 8), null);
  });
});

describe('the compliance policy', () => {
  const settings = {
    sending_enabled: true, country_hourly_limit: 100, daily_marketing_cap_micros: null, spend_currency: 'USD',
    default_quiet_start: 21, default_quiet_end: 8,
  };
  const country = { iso2: 'US', status: 'enabled', marketing_allowed: true, timezone: 'America/New_York', quiet_hours_start: null, quiet_hours_end: null };
  const transactional = { key: 'participant', enabled: true, traffic_class: 'transactional', requires_consent: false, per_recipient_daily_limit: 5, respect_quiet_hours: false };
  const marketing = { key: 'marketing', enabled: true, traffic_class: 'marketing', requires_consent: true, per_recipient_daily_limit: 1, respect_quiet_hours: true };
  const noon = new Date('2026-11-12T17:00:00Z');   // noon in New York
  const tMsg = { traffic_class: 'transactional', metadata: {} };
  const mMsg = { traffic_class: 'marketing', metadata: {}, campaign_id: 'c' };
  const run = (over) => evaluate({ msg: tMsg, settings, category: transactional, country, now: noon, ...over });

  test('a verified country, an enabled category: send', () => {
    assert.deepEqual(run({}), { action: 'send' });
  });

  test('NO COUNTRY IS SUPPORTED UNTIL IT IS ENABLED', () => {
    assert.equal(run({ country: { ...country, status: 'unverified' } }).reason, 'country_not_enabled');
    assert.equal(run({ country: null }).reason, 'country_unknown');
  });

  test('the global switch defers rather than drops', () => {
    assert.equal(run({ settings: { ...settings, sending_enabled: false } }).action, 'defer');
  });

  test('expired messages are never sent late', () => {
    assert.equal(run({ msg: { ...tMsg, metadata: { expiresAt: '2026-11-12T16:00:00Z' } } }).reason, 'expired');
  });

  test('a disabled category blocks', () => {
    assert.equal(run({ category: { ...transactional, enabled: false } }).reason, 'category_disabled');
  });

  test('suppression: "all" blocks everything, "marketing" only marketing', () => {
    assert.equal(run({ suppression: { scope: 'all' } }).reason, 'suppressed');
    assert.equal(run({ suppression: { scope: 'marketing' } }).action, 'send');
    assert.equal(run({ msg: mMsg, category: marketing, suppression: { scope: 'marketing' }, consent: { status: 'opted_in' } }).reason, 'suppressed');
  });

  test('marketing needs consent, confirmed, in a country that allows it', () => {
    const m = (over) => run({ msg: mMsg, category: marketing, ...over });
    assert.equal(m({}).reason, 'no_consent');
    assert.equal(m({ consent: { status: 'pending' } }).reason, 'consent_pending');
    assert.equal(m({ consent: { status: 'opted_out' } }).reason, 'no_consent');
    assert.equal(m({ consent: { status: 'opted_in' }, country: { ...country, marketing_allowed: false } }).reason, 'marketing_not_allowed');
    assert.deepEqual(m({ consent: { status: 'opted_in' } }), { action: 'send' });
    // Even a category row that claims no consent is needed cannot switch it off.
    assert.equal(m({ category: { ...marketing, requires_consent: false } }).reason, 'no_consent');
  });

  test('per-recipient daily limit', () => {
    assert.equal(run({ counts: { recipient: 5 } }).reason, 'recipient_rate_limited');
    assert.equal(run({ counts: { recipient: 4 } }).action, 'send');
  });

  test('SMS pumping: a burst to one country pauses it; campaigns are exempt', () => {
    const d = run({ counts: { countryHour: 100 } });
    assert.equal(d.reason, 'country_velocity');
    assert.equal(d.pauseCountry, true);
    assert.equal(run({ msg: { ...tMsg, campaign_id: 'c' }, counts: { countryHour: 100 } }).action, 'send');
  });

  test('a paused country defers until the pause ends', () => {
    const d = run({ country: { ...country, paused_until: '2026-11-12T18:00:00Z' } });
    assert.equal(d.reason, 'country_paused');
    assert.equal(d.until.toISOString(), '2026-11-12T18:00:00.000Z');
  });

  test('marketing spend cap defers marketing, never transactional', () => {
    const capped = { ...settings, daily_marketing_cap_micros: 1_000_000 };
    assert.equal(run({ settings: capped, msg: { ...mMsg, est_cost_micros: 10, currency: 'USD' }, category: marketing,
      consent: { status: 'opted_in' }, counts: { marketingSpendToday: 999_995 } }).reason, 'marketing_spend_cap');
    assert.equal(run({ settings: capped, counts: { marketingSpendToday: 5_000_000 } }).action, 'send');
  });

  test('quiet hours in the recipient’s zone, only where the category asks', () => {
    const night = new Date('2026-11-13T03:00:00Z');   // 22:00 New York
    assert.equal(run({ msg: mMsg, category: marketing, consent: { status: 'opted_in' }, now: night }).reason, 'quiet_hours');
    assert.equal(run({ now: night }).action, 'send');
  });
});

describe('routing and senders', () => {
  const providers = new Map([
    ['twilio', { id: 'twilio', enabled: true, priority: 10, traffic_classes: ['transactional', 'marketing'] }],
    ['vonage', { id: 'vonage', enabled: true, priority: 20, traffic_classes: ['transactional', 'marketing'] }],
  ]);
  const adapters = { twilio: { configured: () => true }, vonage: { configured: () => true } };
  const routes = [
    { country: 'EG', provider_id: 'vonage', priority: 50, active: true, verified: true },
    { country: 'EG', provider_id: 'twilio', priority: 100, active: true, verified: true },
    { country: 'EG', provider_id: 'cheap', priority: 1, active: true, verified: false },
  ];
  const cands = (over = {}) => routing.candidates({ routes, providers, adapters, country: 'EG', trafficClass: 'transactional', ...over })
    .map((r) => r.provider_id);

  test('only verified routes, by route priority', () => {
    assert.deepEqual(cands(), ['vonage', 'twilio']);
  });
  test('excluded providers drop out; an avoided one goes last', () => {
    assert.deepEqual(cands({ exclude: ['vonage'] }), ['twilio']);
    assert.deepEqual(cands({ avoid: 'vonage' }), ['twilio', 'vonage']);
  });
  test('disabled, unconfigured or tripped providers are skipped', () => {
    const tripped = new Map(providers);
    tripped.set('vonage', { ...providers.get('vonage'), circuit_open_until: new Date(Date.now() + 60_000).toISOString() });
    assert.deepEqual(cands({ providers: tripped }), ['twilio']);
    assert.deepEqual(cands({ adapters: { ...adapters, twilio: { configured: () => false } } }), ['vonage']);
  });

  const eg = { iso2: 'EG', sender_id_support: 'registration_required', requires_sender_registration: true };
  const s = (over) => ({ id: over.id || 'x', provider_id: 'vonage', active: true, traffic_classes: ['transactional'], countries: [], registration_status: 'not_required', kind: 'long_code', ...over });

  test('a registration country needs an APPROVED sender listed for it', () => {
    const route = { provider_id: 'vonage' };
    assert.deepEqual(routing.pickSender({ route, senders: [s({})], country: eg, trafficClass: 'transactional' }), { error: 'no_sender' });
    const ok = s({ id: 'ok', kind: 'alphanumeric', value: 'Eventsli', countries: ['EG'], registration_status: 'approved' });
    assert.equal(routing.pickSender({ route, senders: [s({ id: 'pending', countries: ['EG'], registration_status: 'pending' }), ok], country: eg, trafficClass: 'transactional' }).sender.id, 'ok');
  });

  test('alphanumeric senders are never used where support is unknown', () => {
    const unknown = { iso2: 'ZZ', sender_id_support: 'unknown', requires_sender_registration: false };
    const alpha = s({ kind: 'alphanumeric', value: 'Eventsli' });
    assert.equal(routing.pickSender({ route: { provider_id: 'vonage' }, senders: [alpha], country: unknown, trafficClass: 'transactional' }).error, 'no_sender');
  });

  test('a pinned sender that cannot be used is an error, not a silent substitute', () => {
    const route = { provider_id: 'vonage', sender_id: 'gone' };
    assert.equal(routing.pickSender({ route, senders: [s({})], country: { iso2: 'US', sender_id_support: 'supported' }, trafficClass: 'transactional' }).error, 'route_sender_unusable');
  });
});

describe('after a provider call: the duplicate rule', () => {
  const ctx = { attempt: 1, maxAttempts: 5, otherCandidates: 1 };
  test('accepted → sent', () => assert.equal(nextStep({ outcome: 'accepted' }, ctx).status, 'sent'));
  test('UNCERTAIN → unknown, never retried and never handed to another provider', () => {
    assert.deepEqual(nextStep({ outcome: 'uncertain' }, ctx), { status: 'unknown' });
    assert.deepEqual(nextStep({}, ctx), { status: 'unknown' }, 'an unrecognised result is treated as uncertain');
  });
  test('refused by the provider → next provider immediately', () => {
    assert.deepEqual(nextStep({ outcome: 'rejected', scope: 'provider' }, ctx), { status: 'queued', delayMs: 0, exclude: true });
    assert.equal(nextStep({ outcome: 'rejected', scope: 'provider' }, { ...ctx, otherCandidates: 0 }).status, 'failed');
  });
  test('refused for the recipient → failed, no fallback, maybe suppressed', () => {
    assert.deepEqual(nextStep({ outcome: 'rejected', scope: 'recipient', suppress: 'invalid_number' }, ctx), { status: 'failed', suppress: 'invalid_number' });
  });
  test('throttled → back off, preferring another provider; give up at the cap', () => {
    const step = nextStep({ outcome: 'retryable' }, ctx);
    assert.equal(step.status, 'queued');
    assert.ok(step.delayMs >= 24_000 && step.delayMs <= 36_000);
    assert.equal(step.avoid, true);
    assert.equal(nextStep({ outcome: 'retryable' }, { ...ctx, attempt: 5 }).status, 'failed');
  });
});

describe('composing the text', () => {
  const settings = { brand_name: 'Eventsli', opt_out_text: 'Reply STOP to opt out' };
  const marketing = { traffic_class: 'marketing', append_opt_out: true };
  test('marketing is branded and carries the opt-out', () => {
    assert.equal(compose({ baseBody: '20% off tonight', category: marketing, settings }).body, 'Eventsli: 20% off tonight\nReply STOP to opt out');
    assert.equal(compose({ baseBody: 'Eventsli: hi', category: marketing, settings }).body, 'Eventsli: hi\nReply STOP to opt out');
  });
  test('an alphanumeric sender cannot receive STOP, so it gets a link', () => {
    const out = compose({ baseBody: 'Offer', category: marketing, settings, sender: { kind: 'alphanumeric' }, unsubscribeUrl: 'https://e.li/s/x' });
    assert.ok(out.body.endsWith('Opt out: https://e.li/s/x'));
  });
  test('transactional text is left as written', () => {
    assert.equal(compose({ baseBody: 'Your tickets', category: { traffic_class: 'transactional' }, settings }).body, 'Your tickets');
  });
});

describe('segments and audience eligibility', () => {
  test('unknown filters are refused, values normalised', () => {
    assert.match(normalizeDefinition({ everyone: true }).error, /Unknown segment filter/);
    assert.deepEqual(normalizeDefinition({ eventCountries: ['ca', 'CA'], purchasedWithinDays: '30', attendedOnly: false }).value,
      { eventCountries: ['CA'], purchasedWithinDays: 30 });
    assert.match(normalizeDefinition({ purchasedWithinDays: 0 }).error, /whole number/);
    assert.equal(describeSegment({}), 'Every buyer with a phone number');
  });

  test('exclusion reasons, in order', () => {
    const cfg = { countryByIso: new Map([['US', { status: 'enabled', marketing_allowed: true }], ['EG', { status: 'unverified' }]]) };
    const us = { e164: '+12125550199', country: 'US' };
    const ok = { status: 'opted_in' };
    assert.equal(exclusion({ parsed: null, cfg, def: {} }), 'invalid_number');
    assert.equal(exclusion({ parsed: { e164: '+20', country: 'EG' }, cfg, def: {}, consent: ok }), 'country_not_enabled');
    assert.equal(exclusion({ parsed: us, cfg, def: { recipientCountries: ['CA'] }, consent: ok }), 'filtered_country');
    assert.equal(exclusion({ parsed: us, cfg, def: {}, suppression: { scope: 'marketing' }, consent: ok }), 'suppressed');
    assert.equal(exclusion({ parsed: us, cfg, def: {} }), 'no_consent');
    assert.equal(exclusion({ parsed: us, cfg, def: {}, consent: ok }), null);
  });
});
