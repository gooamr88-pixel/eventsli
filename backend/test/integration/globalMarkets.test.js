const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');

// Card payments switched on for the platform, so the refusals below are the
// country's, not the platform's. Nothing here reaches Stripe: every path
// tested is refused before a Stripe call.
process.env.PAYMENTS_STRIPE_ENABLED = 'true';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_integration_unused';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_integration_unused';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || 'whsec_integration_unused';

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Eventsli is open in every country (20261121090000). An organizer where card
 * checkout is not on — Egypt here — signs up, is offered their own payment
 * methods only, can never start a Stripe account, and prices events in their
 * own currency. A sanctioned country cannot be chosen at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */
let server; let baseUrl;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const cleanup = { profiles: [], organizers: [], events: [] };
const ORG_SETUP = {
  legalName: 'Global Test Events LLC',
  description: 'Runs the events the global markets integration suite creates and deletes.',
  acceptPolicies: true,
};

function client() {
  let cookie = null;
  return async function call(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

async function signedIn(tag) {
  const call = client();
  const email = `global-${tag}-${stamp}@eventsli-test.invalid`;
  const r = await call('POST', '/auth/register', { email, password: PASSWORD, fullName: `Global ${tag}` });
  assert.ok(r.body?.data?.id, `register ${tag}: ${r.status} ${JSON.stringify(r.body)}`);
  cleanup.profiles.push(r.body.data.id);
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', r.body.data.id);
  await call('POST', '/auth/login', { email, password: PASSWORD });
  return call;
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(async () => {
  for (const id of cleanup.events) await supabase.from('events').delete().eq('id', id);
  for (const id of cleanup.organizers) {
    await supabase.from('organizer_payment_methods').delete().eq('organizer_id', id);
    await supabase.from('organizers').delete().eq('id', id);
  }
  for (const id of cleanup.profiles) {
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

test('the public market list is the whole world, with card only where it is on', async () => {
  const res = await client()('GET', '/public/markets');
  assert.equal(res.status, 200);
  const { countries, card, markets } = res.body.data;
  assert.ok(countries.length > 230, `${countries.length} open`);
  assert.ok(countries.includes('EG') && countries.includes('CA'));
  assert.ok(!countries.includes('RU'), 'a sanctioned country is never open');
  assert.ok(card.includes('CA') && !card.includes('EG'));
  assert.deepEqual(markets.find((m) => m.country === 'EG'), { country: 'EG', currency: 'EGP', card: false });
});

test('a sanctioned country cannot be chosen at sign-up', async () => {
  const call = await signedIn('ru');
  const res = await call('POST', '/organizer', { displayName: 'Nowhere Co', ...ORG_SETUP, country: 'RU' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
});

test('an organizer in Egypt sells offline: no card, no Stripe account, events in EGP', async () => {
  const call = await signedIn('eg');
  const created = await call('POST', '/organizer', { displayName: 'Cairo Nights', ...ORG_SETUP, country: 'EG' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  cleanup.organizers.push(created.body.data.id);
  assert.equal(created.body.data.country, 'EG');
  assert.equal(created.body.data.payments.cardAvailable, false);
  assert.deepEqual(created.body.data.payments.choices, []);

  // Stripe is refused BEFORE any account is created: an account's country is permanent.
  const onboard = await call('POST', '/organizer/stripe/onboard');
  assert.equal(onboard.status, 403, JSON.stringify(onboard.body));
  assert.equal(onboard.body.error, 'CARD_NOT_AVAILABLE');
  const { data: org } = await supabase.from('organizers').select('stripe_account_id').eq('id', created.body.data.id).single();
  assert.equal(org.stripe_account_id, null);

  // Their own method makes them ready to sell — manual only.
  const method = await call('POST', '/organizer/payment-methods', {
    kind: 'other', label: 'Vodafone Cash', instructions: 'Send to 010 0000 0000 with your order number in the note.',
  });
  assert.equal(method.status, 201, JSON.stringify(method.body));
  const me = await call('GET', '/organizer/me');
  assert.deepEqual(me.body.data.payments.choices, ['manual']);
  assert.equal(me.body.data.payments.stripeReady, false);

  const event = await call('POST', '/events', {
    title: 'Cairo Jazz Night',
    country: 'EG',
    timezone: 'Africa/Cairo',
    startsAt: new Date(Date.now() + 30 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 30 * 86400e3 + 3 * 3600e3).toISOString(),
  });
  assert.equal(event.status, 201, JSON.stringify(event.body));
  cleanup.events.push(event.body.data.id);
  assert.equal(event.body.data.currency, 'EGP');
});

test('the database itself refuses a currency that is not the country’s', async () => {
  const { data: anyOrg } = await supabase.from('organizers').select('id').limit(1).single();
  const { error } = await supabase.from('events').insert({
    organizer_id: anyOrg.id, title: 'Wrong currency', slug: `wrong-currency-${stamp}`, country: 'EG', currency: 'USD',
    timezone: 'Africa/Cairo', starts_at: new Date(Date.now() + 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 2 * 86400e3).toISOString(),
  });
  assert.ok(error, 'an EG event in USD was accepted');
  assert.match(error.message, /events_currency_follows_country|foreign key|violates/);
});

// ── Phase 1: no buyer is let into a checkout that cannot take payment ───────

async function publishedEvent(call, { priceCents, country = 'EG', timezone = 'Africa/Cairo' }) {
  const ev = await call('POST', '/events', {
    title: `${country} ${priceCents ? 'Paid' : 'Free'} Night`, country, timezone,
    admissionType: 'general',
    startsAt: new Date(Date.now() + 40 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 40 * 86400e3 + 3 * 3600e3).toISOString(),
  });
  assert.equal(ev.status, 201, JSON.stringify(ev.body));
  cleanup.events.push(ev.body.data.id);
  const tier = await call('POST', `/events/${ev.body.data.id}/tiers`, { name: 'Entry', priceCents, quantity: 50 });
  assert.equal(tier.status, 201, JSON.stringify(tier.body));
  // Published straight in the database: the publishing rules are not what is under test.
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { error: published } = await supabase.from('events')
    .update({ status: 'published', accepts_stripe: true, accepts_manual: true, terms_accepted_id: terms.id })
    .eq('id', ev.body.data.id);
  assert.ifError(published);
  return { slug: ev.body.data.slug, tierId: tier.body.data.id };
}

test('phase 1: a paid event where card payments are off has no Buy, and a hold is refused', async () => {
  const call = await signedIn('eg-buy');
  const org = await call('POST', '/organizer', { displayName: 'Cairo Paid Co', ...ORG_SETUP, country: 'EG' });
  assert.equal(org.status, 201, JSON.stringify(org.body));
  cleanup.organizers.push(org.body.data.id);
  const { slug, tierId } = await publishedEvent(call, { priceCents: 50000 });

  const page = await client()('GET', `/public/events/${slug}`);
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.equal(page.body.data.purchasable, false);
  assert.deepEqual(page.body.data.payments, { card: false, manual: false });

  const hold = await client()('POST', `/public/events/${slug}/hold`, { lines: [{ tierId, quantity: 1 }] });
  assert.equal(hold.status, 403, JSON.stringify(hold.body));
  assert.equal(hold.body.error, 'TICKETS_NOT_SOLD_ONLINE');
});

test('phase 1: a free event in the same country can still be claimed online', async () => {
  const call = await signedIn('eg-free');
  const org = await call('POST', '/organizer', { displayName: 'Cairo Free Co', ...ORG_SETUP, country: 'EG' });
  cleanup.organizers.push(org.body.data.id);
  const { slug, tierId } = await publishedEvent(call, { priceCents: 0 });

  const page = await client()('GET', `/public/events/${slug}`);
  assert.equal(page.body.data.purchasable, true);
  const hold = await client()('POST', `/public/events/${slug}/hold`, { lines: [{ tierId, quantity: 1 }] });
  assert.equal(hold.status, 201, JSON.stringify(hold.body));
  await supabase.from('reservations').delete().eq('id', hold.body.data.reservationId);
});

test('phase 1: Canada is unchanged — a paid event takes cards and can be held', async () => {
  const call = await signedIn('ca-buy');
  const org = await call('POST', '/organizer', { displayName: 'Toronto Paid Co', ...ORG_SETUP, country: 'CA' });
  assert.equal(org.status, 201, JSON.stringify(org.body));
  cleanup.organizers.push(org.body.data.id);
  assert.equal(org.body.data.payments.cardAvailable, true);
  const { slug, tierId } = await publishedEvent(call, { priceCents: 2500, country: 'CA', timezone: 'America/Toronto' });

  const page = await client()('GET', `/public/events/${slug}`);
  assert.equal(page.body.data.purchasable, true);
  assert.equal(page.body.data.payments.card, true);
  assert.equal(page.body.data.currency, 'CAD');
  const hold = await client()('POST', `/public/events/${slug}/hold`, { lines: [{ tierId, quantity: 1 }] });
  assert.equal(hold.status, 201, JSON.stringify(hold.body));
  await supabase.from('reservations').delete().eq('id', hold.body.data.reservationId);
});
