const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'twilio-token';
process.env.VONAGE_API_KEY = 'vk';
process.env.VONAGE_API_SECRET = 'vs';

const twilio = require('../services/sms/providers/twilio');
const vonage = require('../services/sms/providers/vonage');
const { toMicros, networkOutcome } = require('../services/sms/providers/httpOutcome');
const auth = require('../services/sms/webhookAuth');

/**
 * The provider adapters against a fake `fetch`: what each HTTP answer means
 * for "was it sent?", which is the question the duplicate rule turns on.
 * Plus webhook authentication and our own signed links.
 */

const realFetch = global.fetch;
let calls;
function respond(status, json) {
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { status, ok: status >= 200 && status < 300, json: async () => json, text: async () => JSON.stringify(json) };
  };
}
function throwing(err) {
  global.fetch = async () => { throw err; };
}
beforeEach(() => { calls = []; });
afterEach(() => { global.fetch = realFetch; });

const sender = { kind: 'long_code', value: '+15005550006' };
const send = (adapter, extra = {}) => adapter.send({ to: '+12125550199', body: 'Hi', sender, callbackUrl: 'https://api.test/cb', clientRef: 'mid-1', encoding: 'GSM-7', ...extra });

describe('Twilio', () => {
  test('201 → accepted with the SID and segment count', async () => {
    respond(201, { sid: 'SM123', num_segments: '2', status: 'queued' });
    const r = await send(twilio);
    assert.equal(r.outcome, 'accepted');
    assert.equal(r.providerMessageId, 'SM123');
    assert.equal(r.segments, 2);
    const body = new URLSearchParams(calls[0].init.body.toString());
    assert.equal(body.get('From'), '+15005550006');
    assert.equal(body.get('StatusCallback'), 'https://api.test/cb');
    assert.match(calls[0].init.headers.authorization, /^Basic /);
  });

  test('a messaging service is sent as MessagingServiceSid, not From', async () => {
    respond(201, { sid: 'SM1' });
    await send(twilio, { sender: { kind: 'messaging_service', value: 'MG0123456789abcdef0123456789abcdef' } });
    const body = new URLSearchParams(calls[0].init.body.toString());
    assert.equal(body.get('MessagingServiceSid'), 'MG0123456789abcdef0123456789abcdef');
    assert.equal(body.get('From'), null);
  });

  test('error codes map to who refused', async () => {
    respond(400, { code: 21211, message: 'Invalid To' });
    assert.deepEqual([(await send(twilio)).outcome, (await send(twilio)).scope], ['rejected', 'recipient']);
    respond(400, { code: 21610, message: 'unsubscribed' });
    assert.equal((await send(twilio)).suppress, 'carrier_opt_out');
    respond(400, { code: 21408, message: 'Permission to send an SMS has not been enabled for the region' });
    assert.equal((await send(twilio)).scope, 'provider', 'another provider may reach this region');
    respond(401, { code: 20003, message: 'Authenticate' });
    const auth401 = await send(twilio);
    assert.equal(auth401.scope, 'provider');
    assert.equal(auth401.providerHealthy, false);
    respond(429, { code: 20429 });
    assert.equal((await send(twilio)).outcome, 'retryable');
  });

  test('a 5xx is UNCERTAIN: Twilio may have created the message', async () => {
    respond(500, {});
    assert.equal((await send(twilio)).outcome, 'uncertain');
  });

  test('a 201 without a SID is uncertain, not accepted', async () => {
    respond(201, {});
    assert.equal((await send(twilio)).outcome, 'uncertain');
  });

  test('status callbacks map to our states', () => {
    assert.equal(twilio.parseStatus({ MessageSid: 'SM1', MessageStatus: 'delivered' }).status, 'delivered');
    assert.equal(twilio.parseStatus({ MessageSid: 'SM1', MessageStatus: 'sent' }).status, 'sent');
    const bad = twilio.parseStatus({ MessageSid: 'SM1', MessageStatus: 'undelivered', ErrorCode: '30006' });
    assert.equal(bad.status, 'undelivered');
    assert.equal(bad.suppress, 'invalid_number');
  });

  test('inbound keeps Twilio’s own opt-out verdict', () => {
    const p = twilio.parseInbound({ From: '+12125550199', Body: 'Stop please', MessageSid: 'SM9', OptOutType: 'STOP' });
    assert.equal(p.optOutType, 'stop');
    assert.equal(twilio.inboundReply('Hi <you>').body.includes('Hi &lt;you&gt;'), true);
  });

  test('pricing takes the highest carrier price', async () => {
    respond(200, { price_unit: 'usd', outbound_sms_prices: [
      { prices: [{ number_type: 'local', current_price: '0.0075' }] },
      { prices: [{ number_type: 'mobile', current_price: '0.0110' }] },
    ] });
    assert.deepEqual(await twilio.pricing('US'), { available: true, costMicros: 11000, currency: 'USD' });
    respond(404, {});
    assert.equal((await twilio.pricing('KP')).available, false);
  });

  test('credential status names what is missing, never a value', () => {
    const saved = process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_AUTH_TOKEN;
    const status = twilio.credentialStatus();
    process.env.TWILIO_AUTH_TOKEN = saved;
    assert.deepEqual(status.missing, ['TWILIO_AUTH_TOKEN']);
    assert.ok(!JSON.stringify(twilio.credentialStatus()).includes('twilio-token'));
  });
});

describe('Vonage', () => {
  test('status 0 → accepted; multi-part counts segments and sums price', async () => {
    respond(200, { 'message-count': '2', messages: [
      { status: '0', 'message-id': 'V1', 'message-price': '0.0300' },
      { status: '0', 'message-id': 'V2', 'message-price': '0.0300' },
    ] });
    const r = await send(vonage, { encoding: 'UCS-2' });
    assert.equal(r.outcome, 'accepted');
    assert.equal(r.segments, 2);
    assert.equal(r.priceMicros, 60000);
    assert.deepEqual(r.partIds, ['V1', 'V2']);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.to, '12125550199');
    assert.equal(body.type, 'unicode');
    assert.equal(body['client-ref'], 'mid-1', 'our id travels so receipts can find the message');
  });

  test('status codes map to who refused', async () => {
    respond(200, { messages: [{ status: '1', 'error-text': 'Throttled' }] });
    assert.equal((await send(vonage)).outcome, 'retryable');
    respond(200, { messages: [{ status: '4', 'error-text': 'Bad Credentials' }] });
    const creds = await send(vonage);
    assert.deepEqual([creds.outcome, creds.scope, creds.providerHealthy], ['rejected', 'provider', false]);
    respond(200, { messages: [{ status: '33', 'error-text': 'Number de-activated' }] });
    assert.equal((await send(vonage)).suppress, 'invalid_number');
    respond(200, { messages: [{ status: '29', 'error-text': 'Non-whitelisted destination' }] });
    assert.equal((await send(vonage)).scope, 'provider');
  });

  test('a partial send is still a send: retrying would duplicate the parts that went', async () => {
    respond(200, { messages: [{ status: '0', 'message-id': 'V1' }, { status: '5', 'error-text': 'x' }] });
    assert.equal((await send(vonage)).outcome, 'accepted');
  });

  test('receipts carry client-ref back', () => {
    const r = vonage.parseStatus({ messageId: 'V1', status: 'delivered', 'client-ref': 'mid-1', price: '0.03', 'err-code': '0' });
    assert.deepEqual([r.status, r.clientRef, r.priceMicros, r.errorCode], ['delivered', 'mid-1', 30000, null]);
    assert.equal(vonage.parseStatus({ status: 'expired' }).status, 'undelivered');
  });
});

describe('network failures', () => {
  test('never connected → retryable; timeout or reset → uncertain', () => {
    assert.equal(networkOutcome({ cause: { code: 'ENOTFOUND' } }).outcome, 'retryable');
    assert.equal(networkOutcome({ cause: { code: 'ECONNREFUSED' } }).outcome, 'retryable');
    assert.equal(networkOutcome({ name: 'TimeoutError' }).outcome, 'uncertain');
    assert.equal(networkOutcome({ cause: { code: 'ECONNRESET' } }).outcome, 'uncertain');
  });
  test('adapters route thrown fetch errors through it', async () => {
    throwing(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    assert.equal((await send(twilio)).outcome, 'retryable');
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    throwing(timeout);
    assert.equal((await send(vonage)).outcome, 'uncertain');
  });
});

describe('money in micros', () => {
  test('exact decimal parsing, no float multiplication', () => {
    assert.equal(toMicros('0.0075'), 7500);
    assert.equal(toMicros('-0.00750'), 7500);
    assert.equal(toMicros('1'), 1_000_000);
    assert.equal(toMicros('0.1234567'), 123456);
    assert.equal(toMicros(''), null);
    assert.equal(toMicros('abc'), null);
  });
});

describe('webhook authentication', () => {
  test('Twilio signature: HMAC-SHA1 over URL + sorted params', () => {
    const url = 'https://api.test/api/v1/sms/webhooks/twilio/inbound';
    const params = { To: '+1500', From: '+1212', Body: 'STOP' };
    const expected = crypto.createHmac('sha1', 'twilio-token').update(`${url}BodySTOPFrom+1212To+1500`).digest('base64');
    assert.equal(auth.twilioSignature(url, params, 'twilio-token'), expected);
    assert.ok(twilio.verifyWebhook({ url, params, headers: { 'x-twilio-signature': expected } }));
    assert.ok(!twilio.verifyWebhook({ url, params: { ...params, Body: 'START' }, headers: { 'x-twilio-signature': expected } }), 'tampered body');
    assert.ok(!twilio.verifyWebhook({ url, params, headers: {} }), 'missing header');
  });

  test('Vonage signature: md5hash and HMAC variants, with a freshness window', () => {
    const now = Date.now();
    const params = { msisdn: '447700900000', text: 'a&b=c', timestamp: String(Math.floor(now / 1000)) };
    for (const method of ['md5hash', 'sha256']) {
      const sig = auth.vonageSignature(params, 'sec', method);
      assert.ok(auth.verifyVonage({ params: { ...params, sig }, secret: 'sec', method, now }), method);
      assert.ok(!auth.verifyVonage({ params: { ...params, sig }, secret: 'other', method, now }));
    }
    const sig = auth.vonageSignature(params, 'sec');
    assert.ok(!auth.verifyVonage({ params: { ...params, sig }, secret: 'sec', now: now + 3_600_000 }), 'stale');
  });

  test('our per-message token binds a receipt to ONE message', () => {
    const t = auth.sign('status:aaaa');
    assert.ok(auth.verify('status:aaaa', t));
    assert.ok(!auth.verify('status:bbbb', t));
    assert.ok(!auth.verify('inbound:aaaa', t), 'a token for one purpose never verifies for another');
    assert.ok(!auth.verify('status:aaaa', ''));
  });

  test('unsubscribe tokens round-trip, are short, and refuse tampering', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const token = auth.unsubscribeToken(id);
    assert.ok(token.length <= 33, `short enough for a text (${token.length})`);
    assert.equal(auth.readUnsubscribeToken(token), id);
    assert.equal(auth.readUnsubscribeToken(`${token.slice(0, -1)}x`), null);
    assert.equal(auth.readUnsubscribeToken('nonsense'), null);
  });
});
