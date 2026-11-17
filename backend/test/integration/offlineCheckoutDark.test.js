const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../helpers/testEnv');
const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 2 SHIPS DARK. With `offline_checkout.enabled` false (the default the
 * migration writes), nothing a buyer can reach offers or creates an offline
 * reservation — even for an event that accepts manual payment from an
 * organizer with methods set up — and the card checkout is untouched.
 * ─────────────────────────────────────────────────────────────────────────────
 */
let server; let baseUrl; let settingBefore;
const stamp = Date.now();
const PASSWORD = 'a-perfectly-long-passphrase';
const ids = {};

function client() {
  let cookie = null;
  return async function call(method, path, body, headers = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const { data: s } = await supabase.from('platform_settings').select('value').eq('key', 'offline_checkout').maybeSingle();
  settingBefore = s?.value || null;
  await supabase.from('platform_settings').upsert(
    { key: 'offline_checkout', value: { enabled: false, payment_hours: 48, min_hours_before_event: 2 } }, { onConflict: 'key' },
  );

  ids.org = client();
  const email = `dark-org-${stamp}@eventsli-test.invalid`;
  const reg = await ids.org('POST', '/auth/register', { email, password: PASSWORD, fullName: 'Dark Org' });
  ids.user = reg.body.data.id;
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', ids.user);
  await ids.org('POST', '/auth/login', { email, password: PASSWORD });
  const org = await ids.org('POST', '/organizer', {
    displayName: 'Dark Toronto', legalName: 'Dark Toronto Ltd', acceptPolicies: true, country: 'CA',
    description: 'Runs the events the phase 2 dark-launch suite creates and deletes.',
  });
  ids.organizerId = org.body.data.id;
  const m = await ids.org('POST', '/organizer/payment-methods', { kind: 'bank_transfer', label: 'Bank transfer', instructions: 'Transfer to account 123, reference = your order.' });
  ids.methodId = m.body.data.id;
  const ev = await ids.org('POST', '/events', {
    title: `Dark Event ${stamp}`, country: 'CA', timezone: 'America/Toronto', admissionType: 'general',
    startsAt: new Date(Date.now() + 20 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 20 * 86400e3 + 3600e3).toISOString(),
  });
  ids.eventId = ev.body.data.id;
  ids.slug = ev.body.data.slug;
  const tier = await ids.org('POST', `/events/${ids.eventId}/tiers`, { name: 'GA', priceCents: 2500, quantity: 20 });
  ids.tierId = tier.body.data.id;
  const { data: terms } = await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('events').update({ status: 'published', accepts_stripe: true, accepts_manual: true, terms_accepted_id: terms.id }).eq('id', ids.eventId);
});

after(async () => {
  if (settingBefore) await supabase.from('platform_settings').update({ value: settingBefore }).eq('key', 'offline_checkout');
  await supabase.from('reservations').delete().eq('event_id', ids.eventId);
  await supabase.from('events').delete().eq('id', ids.eventId);
  await supabase.from('organizer_payment_methods').delete().eq('organizer_id', ids.organizerId);
  await supabase.from('organizers').delete().eq('id', ids.organizerId);
  await supabase.from('terms_acceptances').delete().eq('user_id', ids.user);
  await supabase.from('sessions').delete().eq('user_id', ids.user);
  await supabase.from('profiles').delete().eq('id', ids.user);
  await new Promise((r) => server.close(r));
});

test('dark: the event page offers card only, never "pay the organizer"', async () => {
  const page = await client()('GET', `/public/events/${ids.slug}`);
  assert.equal(page.body.data.purchasable, true);
  assert.deepEqual(page.body.data.payments, { card: true, manual: false });
});

test('dark: the checkout gets card only, and reserving offline is refused with nothing recorded', async () => {
  const buyer = client();
  const hold = await buyer('POST', `/public/events/${ids.slug}/hold`, { lines: [{ tierId: ids.tierId, quantity: 1 }] });
  assert.equal(hold.status, 201, JSON.stringify(hold.body));
  const token = { 'x-access-token': hold.body.data.reservationToken };
  const rid = hold.body.data.reservationId;

  const opts = await buyer('GET', `/public/reservations/${rid}/offline-options`, null, token);
  assert.equal(opts.status, 200);
  assert.deepEqual(opts.body.data, { card: true, available: false });

  const off = await buyer('POST', `/public/reservations/${rid}/offline`, {
    methodId: ids.methodId, email: 'dark-buyer@eventsli-test.invalid', acceptTerms: true, signature: { method: 'typed', name: 'Dark Buyer' },
  }, token);
  assert.equal(off.status, 503, JSON.stringify(off.body));
  assert.equal(off.body.error, 'FEATURE_DISABLED');

  const { count: rows } = await supabase.from('offline_payments').select('id', { count: 'exact', head: true }).eq('reservation_id', rid);
  assert.equal(rows, 0, 'no offline payment was created');
  const { count: accepted } = await supabase.from('terms_acceptances').select('id', { count: 'exact', head: true }).eq('reservation_id', rid);
  assert.equal(accepted, 0, 'refused before the terms acceptance was recorded');
  const { data: resv } = await supabase.from('reservations').select('state, expires_at').eq('id', rid).single();
  assert.equal(resv.state, 'active');
  assert.ok(new Date(resv.expires_at) < new Date(Date.now() + 2 * 3600e3), 'the hold was not extended to a payment deadline');

  // A direct call to the database function does not care about the switch —
  // which is why only the service role can execute it (see the next test).
  await supabase.rpc('release_reservation', { p_reservation_id: rid });
});

// The public (anon) key is assumed known: it must not reach the offline tables
// or functions directly through the data API, switch or no switch.
const ANON = process.env.SUPABASE_ANON_KEY;
test('dark: the public database key cannot read offline tables or call offline functions',
  { skip: !ANON && 'SUPABASE_ANON_KEY is not set' }, async () => {
    const rest = (path, init = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1${path}`, {
      ...init, headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json', ...init.headers },
    });
    for (const table of ['offline_payments', 'payment_audit']) {
      const body = await (await rest(`/${table}?select=id&limit=1`)).json();
      assert.ok(!Array.isArray(body), `${table} returned rows to the anon key`);
    }
    for (const fn of ['offline_reserve', 'offline_confirm', 'offline_cancel', 'order_void_offline', 'payment_audit_write']) {
      const res = await rest(`/rpc/${fn}`, { method: 'POST', body: '{}' });
      assert.ok(res.status >= 400, `${fn} answered ${res.status} to the anon key`);
    }
  });

test('dark: the organizer side shows the switch is off and has nothing to act on', async () => {
  const list = await ids.org('GET', `/events/${ids.eventId}/offline-payments`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.enabled, false);
  assert.deepEqual(list.body.data.payments, []);
  const me = await ids.org('GET', '/organizer/me');
  assert.equal(me.body.data.payments.offlineCheckout, false);
});
