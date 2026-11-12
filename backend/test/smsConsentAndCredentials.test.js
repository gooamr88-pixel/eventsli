const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const credentials = require('../services/sms/credentials');
const { evaluate } = require('../services/sms/policy');
const { render, CONSENT_TEXT } = require('../services/sms/consentText');
const twilio = require('../services/sms/providers/twilio');
const vonage = require('../services/sms/providers/vonage');
const { compose } = require('../services/sms/compose');
const { bootWarnings } = require('../services/sms/bootCheck');

/**
 * Part 2 of the SMS system, pure parts: credential storage, the separation of
 * transactional and marketing consent in the policy, the consent wording, and
 * the read-only provider account calls.
 */

const KEY = Buffer.alloc(32, 9).toString('base64');
const SID = `AC${'a'.repeat(32)}`;
const TOKEN = 'b'.repeat(32);
const ENV = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'VONAGE_API_KEY', 'VONAGE_API_SECRET', 'SMS_CREDENTIALS_KEY'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.SMS_CREDENTIALS_KEY = KEY;
  credentials.setStoredRows([]);
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  credentials.setStoredRows([]);
});

const row = (providerId, values) => ({ provider_id: providerId, ...credentials.encrypt(values), hints: {}, updated_at: new Date().toISOString() });

describe('credentials', () => {
  test('encrypt → decrypt round-trips, and the ciphertext holds no secret', () => {
    const sealed = credentials.encrypt({ accountSid: SID, authToken: TOKEN });
    assert.ok(!sealed.ciphertext.includes(TOKEN));
    assert.deepEqual(credentials.decrypt(sealed), { accountSid: SID, authToken: TOKEN });
  });

  test('a different key reads as "stored but unreadable", never as garbage credentials', () => {
    const r = row('twilio', { accountSid: SID, authToken: TOKEN });
    process.env.SMS_CREDENTIALS_KEY = Buffer.alloc(32, 1).toString('base64');
    credentials.setStoredRows([r]);
    const s = credentials.status('twilio');
    assert.equal(s.storedUnreadable, true);
    assert.equal(s.configured, false);
    assert.equal(credentials.resolve('twilio').authToken, undefined);
  });

  test('tampering with the ciphertext is detected (GCM tag)', () => {
    const r = row('twilio', { accountSid: SID, authToken: TOKEN });
    const bytes = Buffer.from(r.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    credentials.setStoredRows([{ ...r, ciphertext: bytes.toString('base64') }]);
    assert.equal(credentials.status('twilio').storedUnreadable, true);
  });

  test('no key: storing is refused', () => {
    delete process.env.SMS_CREDENTIALS_KEY;
    assert.throws(() => credentials.encrypt({ a: 1 }), /SMS_CREDENTIALS_KEY/);
    assert.equal(credentials.keyConfigured(), false);
  });

  test('environment variables win over stored values, field by field', () => {
    credentials.setStoredRows([row('twilio', { accountSid: SID, authToken: TOKEN })]);
    process.env.TWILIO_AUTH_TOKEN = 'c'.repeat(32);
    const r = credentials.resolve('twilio');
    assert.equal(r.accountSid, SID);
    assert.equal(r.authToken, 'c'.repeat(32));
    const s = credentials.status('twilio');
    assert.equal(s.fields.accountSid.source, 'stored');
    assert.equal(s.fields.authToken.source, 'env');
  });

  test('status never contains a secret; non-secret ids show only their last four characters', () => {
    credentials.setStoredRows([row('twilio', { accountSid: SID, authToken: TOKEN })]);
    const text = JSON.stringify(credentials.status('twilio'));
    assert.ok(!text.includes(TOKEN));
    assert.ok(!text.includes(SID));
    assert.equal(credentials.status('twilio').fields.accountSid.hint, '…aaaa');
    assert.equal(credentials.status('twilio').fields.authToken.hint, null);
  });

  test('prepare validates formats, requires what is required, and keeps stored values for blank fields', () => {
    assert.match(credentials.prepare('twilio', { accountSid: 'nope', authToken: TOKEN }).error, /Account SID/);
    assert.match(credentials.prepare('twilio', { accountSid: SID }).error, /Auth token/);
    credentials.setStoredRows([row('twilio', { accountSid: SID, authToken: TOKEN })]);
    const p = credentials.prepare('twilio', { apiKeySid: `SK${'d'.repeat(32)}` });
    assert.deepEqual(Object.keys(p.values).sort(), ['accountSid', 'apiKeySid', 'authToken']);
    assert.equal(p.values.authToken, TOKEN, 'a blank secret keeps the stored one');
    assert.match(credentials.prepare('nope', {}).error, /Unknown provider/);
  });

  test('adapters read stored credentials when no environment variable is set', () => {
    assert.equal(twilio.configured(), false);
    credentials.setStoredRows([row('twilio', { accountSid: SID, authToken: TOKEN }), row('vonage', { apiKey: 'abcd1234', apiSecret: 'Secret1234' })]);
    assert.equal(twilio.configured(), true);
    assert.equal(vonage.configured(), true);
  });
});

describe('read-only provider account calls', () => {
  const realFetch = global.fetch;
  let urls;
  const respond = (status, json) => {
    global.fetch = async (url) => { urls.push(String(url)); return { status, ok: status < 300, json: async () => json }; };
  };
  beforeEach(() => { urls = []; });
  afterEach(() => { global.fetch = realFetch; });

  test('Twilio test: an active account is OK; a 401 is a clear refusal; candidates are used when given', async () => {
    respond(200, { status: 'active', friendly_name: 'Eventsli' });
    const ok = await twilio.testConnection({ accountSid: SID, authToken: TOKEN });
    assert.deepEqual([ok.ok, ok.account], [true, 'Eventsli']);
    assert.ok(urls[0].endsWith(`/Accounts/${SID}.json`));
    respond(200, { status: 'suspended' });
    assert.equal((await twilio.testConnection({ accountSid: SID, authToken: TOKEN })).ok, false);
    respond(401, {});
    assert.match((await twilio.testConnection({ accountSid: SID, authToken: TOKEN })).error, /refused/);
  });

  test('Twilio numbers: SMS-capable numbers and messaging services, toll-free recognised', async () => {
    global.fetch = async (url) => {
      urls.push(String(url));
      const json = String(url).includes('messaging.twilio.com')
        ? { services: [{ sid: 'MG123', friendly_name: 'Main' }] }
        : { incoming_phone_numbers: [{ phone_number: '+14165550199', capabilities: { sms: true } }, { phone_number: '+18005550100', capabilities: { sms: true } }] };
      return { status: 200, ok: true, json: async () => json };
    };
    const list = await twilio.listNumbers({ accountSid: SID, authToken: TOKEN });
    assert.deepEqual(list.map((n) => n.kind), ['messaging_service', 'long_code', 'toll_free']);
  });

  test('Vonage test reads the balance; numbers come back in E.164 with their SMS feature', async () => {
    respond(200, { value: 12.5, autoReload: false });
    const ok = await vonage.testConnection({ apiKey: 'abcd1234', apiSecret: 'Secret1234' });
    assert.deepEqual([ok.ok, ok.balance], [true, 12.5]);
    respond(200, { numbers: [{ msisdn: '447700900000', country: 'GB', type: 'mobile-lvn', features: ['SMS', 'VOICE'] }] });
    const nums = await vonage.listNumbers({ apiKey: 'abcd1234', apiSecret: 'Secret1234' });
    assert.deepEqual(nums[0], { value: '+447700900000', kind: 'long_code', label: 'GB number', country: 'GB', sms: true });
  });
});

describe('transactional and marketing consent are separate answers', () => {
  const settings = { sending_enabled: true, country_hourly_limit: 100, spend_currency: 'USD', default_quiet_start: 21, default_quiet_end: 8 };
  const country = { status: 'enabled', marketing_allowed: true, timezone: 'UTC', quiet_hours_start: 0, quiet_hours_end: 0 };
  const participant = { enabled: true, traffic_class: 'transactional', requires_consent: true, per_recipient_daily_limit: 10 };
  const marketing = { enabled: true, traffic_class: 'marketing', requires_consent: true, per_recipient_daily_limit: 1 };
  const t = (over) => evaluate({ msg: { traffic_class: 'transactional', metadata: {} }, settings, category: participant, country, ...over });

  test('a confirmation needs TRANSACTIONAL consent when the category requires it', () => {
    assert.equal(t({}).reason, 'no_transactional_consent');
    assert.equal(t({ consent: { status: 'opted_out' } }).reason, 'no_transactional_consent');
    assert.deepEqual(t({ consent: { status: 'opted_in' } }), { action: 'send' });
    assert.deepEqual(t({ category: { ...participant, requires_consent: false } }), { action: 'send' }, 'an admin may relax it where the law allows');
  });

  test('the double opt-in request and console tests are exempt — but never from a STOP', () => {
    for (const purpose of ['double_opt_in', 'console_test']) {
      const msg = { traffic_class: 'transactional', metadata: { consentExempt: purpose } };
      assert.deepEqual(t({ msg }), { action: 'send' }, purpose);
      assert.equal(t({ msg, suppression: { scope: 'all' } }).reason, 'suppressed');
    }
    assert.equal(t({ msg: { traffic_class: 'transactional', metadata: { consentExempt: 'anything_else' } } }).reason, 'no_transactional_consent');
  });

  test('marketing is decided by marketing consent only', () => {
    const m = (consent) => evaluate({ msg: { traffic_class: 'marketing', metadata: {}, campaign_id: 'c' }, settings, category: marketing, country, consent });
    assert.equal(m(null).reason, 'no_consent');
    assert.deepEqual(m({ status: 'opted_in' }), { action: 'send' });
  });
});

describe('what a suppressed number may still receive', () => {
  const settings = { sending_enabled: true, country_hourly_limit: 100, spend_currency: 'USD', default_quiet_start: 21, default_quiet_end: 8 };
  const country = { status: 'enabled', marketing_allowed: true, timezone: 'UTC', quiet_hours_start: 0, quiet_hours_end: 0 };
  const participant = { enabled: true, traffic_class: 'transactional', requires_consent: true, per_recipient_daily_limit: 10 };
  const run = (purpose, over = {}) => evaluate({
    msg: { traffic_class: 'transactional', metadata: { consentExempt: purpose } }, settings, category: participant, country,
    suppression: { scope: 'all' }, ...over,
  });
  test('the STOP confirmation and the HELP reply get through a STOP; nothing else does', () => {
    assert.deepEqual(run('stop_confirmation'), { action: 'send' });
    assert.deepEqual(run('keyword_reply'), { action: 'send' });
    assert.equal(run('console_test').reason, 'suppressed');
    assert.equal(run('double_opt_in').reason, 'suppressed');
    assert.equal(run(undefined).reason, 'suppressed');
  });
  test('the exemption never applies to marketing traffic', () => {
    const marketing = { enabled: true, traffic_class: 'marketing', requires_consent: true, per_recipient_daily_limit: 1 };
    const d = evaluate({ msg: { traffic_class: 'marketing', metadata: { consentExempt: 'keyword_reply' }, campaign_id: 'c' }, settings, category: marketing, country, suppression: { scope: 'all' }, consent: { status: 'opted_in' } });
    assert.equal(d.reason, 'suppressed');
  });
});

describe('boot checks', () => {
  test('production misconfiguration is named; development is quiet', () => {
    const prod = bootWarnings({ NODE_ENV: 'production', SMS_DRY_RUN: 'true', BACKEND_URL: 'http://api.example.com', SMS_CREDENTIALS_KEY: 'short' });
    assert.equal(prod.length, 4);
    assert.ok(prod.some((w) => /IGNORED/.test(w)));
    assert.ok(prod.some((w) => /SMS_WEBHOOK_SECRET/.test(w)));
    assert.ok(prod.some((w) => /not HTTPS/.test(w)));
    assert.ok(prod.some((w) => /32 bytes/.test(w)));
    assert.deepEqual(bootWarnings({ NODE_ENV: 'production', SMS_WEBHOOK_SECRET: 's', BACKEND_URL: 'https://api.example.com', SMS_CREDENTIALS_KEY: KEY }), []);
    assert.deepEqual(bootWarnings({ NODE_ENV: 'development', SMS_DRY_RUN: 'true' }), []);
  });
});

describe('consent wording', () => {
  test('every version renders, organizer names are filled in, and every opt-in names how to stop', () => {
    assert.match(render('checkout.marketing_organizer.v1', { organizer: 'Jazz Club' }), /from Jazz Club by text/);
    assert.match(render('checkout.marketing_organizer.v1', {}), /from the organizer by text/);
    for (const v of Object.keys(CONSENT_TEXT).filter((k) => !k.startsWith('account.'))) assert.match(CONSENT_TEXT[v], /Reply STOP/, v);
    assert.throws(() => render('nope.v9'), /unknown consent text/);
  });

  test('an organizer campaign opens with the organizer’s name', () => {
    const out = compose({ baseBody: 'Early entry', category: { traffic_class: 'marketing', append_opt_out: true }, settings: { brand_name: 'Eventsli', opt_out_text: 'Reply STOP to opt out' }, brand: 'Jazz Club' });
    assert.equal(out.body, 'Jazz Club: Early entry\nReply STOP to opt out');
  });
});

