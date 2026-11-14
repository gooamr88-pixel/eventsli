const { test } = require('node:test');
const assert = require('node:assert/strict');
const { supabase } = require('../../config/supabase');
const dispatcher = require('../../services/sms/dispatcher');
const campaigns = require('../../services/sms/campaigns');
const notifications = require('../../services/sms/notifications');
const config = require('../../services/sms/config');
const auth = require('../../services/sms/webhookAuth');
const maintenance = require('../../services/sms/maintenance');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The four SMS categories end to end, consent capture, preferences, organizer
 * campaigns, credentials and country management — against the real database.
 *
 * Not a test file of its own (no `.test.js`): sms.test.js runs these after its
 * own tests, in the same process, because both change platform-wide SMS state
 * (the sending switch, categories, the test country) and two files doing that
 * in parallel would race each other.
 *
 * Every number is in the private test country ZQ (+999), set up by sms.test.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function waitFor(fn, { timeout = 6000, label = 'condition' } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
    // eslint-disable-next-line no-await-in-loop
    await wait(150);
  }
}

module.exports = function smsFlows(ctx) {
  const { call, cookies, ids, stamp, PASSWORD } = ctx;
  const tail = String(stamp).slice(-6);
  const P = { reg: `+99920${tail}`, A: `+99931${tail}`, B: `+99932${tail}`, C: `+99933${tail}` };
  const flow = { users: [], orders: {} };

  async function consentsOf(phone) {
    const { data } = await supabase.from('sms_consents').select('scope, kind, status, source, evidence').eq('phone_e164', phone);
    return data || [];
  }
  async function messageByKey(key) {
    const { data } = await supabase.from('sms_messages').select('*').eq('idempotency_key', key).maybeSingle();
    return data;
  }
  async function claim(phone, sms) {
    const hold = await call('POST', `/public/events/${flow.slug}/hold`, { lines: [{ tierId: flow.tier, quantity: 1 }] });
    assert.equal(hold.status, 201, hold.text);
    const { reservationId, reservationToken } = hold.body.data;
    const res = await fetch(`${ctx.baseUrl()}/public/reservations/${reservationId}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-token': reservationToken },
      body: JSON.stringify({ email: `sms-buyer-${phone.slice(-4)}-${stamp}@eventsli-test.invalid`, name: 'Buyer', acceptTerms: true, phone, ...(sms ? { sms } : {}) }),
    });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.orderId;
  }
  /** The platform state these flows need, re-asserted: another test may have changed it. */
  async function live() {
    await supabase.from('sms_settings').update({ sending_enabled: true }).eq('id', 1);
    await supabase.from('sms_categories').update({ enabled: true }).in('key', ['participant', 'event_notification', 'marketing', 'segmentation']);
    await supabase.from('sms_countries').update({ quiet_hours_start: 0, quiet_hours_end: 0, marketing_allowed: true, paused_until: null }).eq('iso2', 'ZQ');
    config.invalidate();
  }

  test('flows: seed an organizer, a free GA event and its tier', async () => {
    await ctx.makeUser('org', 'organizer');
    const { data: terms } = await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single();
    const { data: org, error: oErr } = await supabase.from('organizers').insert({
      owner_user_id: ids.org, display_name: `Org ${tail}`, country: 'CA',
    }).select('id').single();
    assert.ifError(oErr);
    flow.org = org.id;
    flow.slug = `sms-flow-${stamp}`;
    const { data: ev, error } = await supabase.from('events').insert({
      organizer_id: org.id, slug: flow.slug, title: `SMS Flow ${tail}`, country: 'CA', timezone: 'America/Toronto',
      starts_at: new Date(Date.now() + 10 * 86400e3).toISOString(), ends_at: new Date(Date.now() + 10 * 86400e3 + 3600e3).toISOString(),
      currency: 'CAD', status: 'published', terms_accepted_id: terms.id, admission_type: 'general', purchase_mode: 'seat_only',
    }).select('id').single();
    assert.ifError(error);
    flow.event = ev.id;
    const { data: tier, error: tErr } = await supabase.from('ticket_tiers').insert({
      event_id: ev.id, name: `Free ${tail}`, price_cents: 0, quantity: 50,
    }).select('id').single();
    assert.ifError(tErr);
    flow.tier = tier.id;
    await live();
  });

  test('registration: separate SMS consents recorded with the exact words; a ticked box without a usable number is a form error', async () => {
    const email = `sms-reg-${stamp}@eventsli-test.invalid`;
    const r = await call('POST', '/auth/register', {
      email, password: PASSWORD, fullName: 'Reg Person', phone: P.reg, sms: { transactional: true, marketing: true },
    });
    assert.equal(r.status, 201, r.text);
    flow.users.push(r.body.data.id);
    flow.regUser = r.body.data.id;
    flow.regEmail = email;
    const rows = await consentsOf(P.reg);
    const t = rows.find((x) => x.kind === 'transactional');
    const m = rows.find((x) => x.kind === 'marketing' && x.scope === 'platform');
    assert.equal(t.status, 'opted_in');
    assert.equal(t.source, 'registration');
    assert.equal(t.evidence.version, 'registration.transactional.v1');
    assert.match(t.evidence.text, /Reply STOP/);
    assert.equal(m.status, 'opted_in');

    const bad = await call('POST', '/auth/register', {
      email: `sms-reg-bad-${stamp}@eventsli-test.invalid`, password: PASSWORD, fullName: 'Bad Number', phone: '0412 345 678', sms: { transactional: true },
    });
    assert.equal(bad.status, 400);
    const { data: none } = await supabase.from('profiles').select('id').eq('email', `sms-reg-bad-${stamp}@eventsli-test.invalid`).maybeSingle();
    assert.equal(none, null, 'no account is created when the SMS choice cannot be honoured');

    const quiet = await call('POST', '/auth/register', {
      email: `sms-reg-none-${stamp}@eventsli-test.invalid`, password: PASSWORD, fullName: 'No Texts', phone: '0412 345 678',
    });
    assert.equal(quiet.status, 201, 'no boxes ticked: the phone format is not the SMS system’s business');
    flow.users.push(quiet.body.data.id);
  });

  test('preferences: a person changes each kind on its own; organizer consent can be withdrawn', async () => {
    await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', flow.regUser);
    const login = await fetch(`${ctx.baseUrl()}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: flow.regEmail, password: PASSWORD }),
    });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    let r = await call('GET', '/sms/preferences', null, cookie);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.transactional.status, 'opted_in');
    assert.equal(r.body.data.marketing.status, 'opted_in');

    r = await call('PUT', '/sms/preferences', { phone: P.reg, transactional: false, marketing: true }, cookie);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.transactional.status, 'opted_out');
    assert.equal(r.body.data.marketing.status, 'opted_in', 'turning one off leaves the other alone');

    // An organizer consent appears in the list and can be withdrawn from here.
    await supabase.from('sms_consents').insert({ phone_e164: P.reg, scope: flow.org, kind: 'marketing', status: 'opted_in', source: 'checkout' });
    r = await call('GET', '/sms/preferences', null, cookie);
    assert.equal(r.body.data.organizers[0].name, `Org ${tail}`);
    r = await call('PUT', '/sms/preferences', { phone: P.reg, organizers: [{ organizerId: flow.org, marketing: false }] }, cookie);
    assert.equal(r.body.data.organizers[0].status, 'opted_out');
    const { count } = await supabase.from('sms_consent_log').select('id', { count: 'exact', head: true }).eq('phone_e164', P.reg);
    assert.ok(count >= 5, 'every change is in the history');
  });

  test('PARTICIPANT: checkout consent is recorded at fulfilment, and only a buyer who ticked it gets the confirmation', async () => {
    flow.orders.A = await claim(P.A, { transactional: true, marketingOrganizer: true });
    flow.orders.B = await claim(P.B, null);
    flow.orders.C = await claim(P.C, { marketingPlatform: true });

    const a = await waitFor(async () => {
      const rows = await consentsOf(P.A);
      return rows.length >= 2 ? rows : null;
    }, { label: 'A consents' });
    assert.ok(a.some((x) => x.kind === 'transactional' && x.status === 'opted_in' && x.source === 'checkout'));
    assert.ok(a.some((x) => x.kind === 'marketing' && x.scope === flow.org && x.status === 'opted_in'));
    assert.ok(!a.some((x) => x.kind === 'marketing' && x.scope === 'platform'), 'an unticked box records nothing');
    assert.equal(a.find((x) => x.kind === 'transactional').evidence.orderId, flow.orders.A);
    assert.deepEqual(await consentsOf(P.B), []);

    const msgA = await waitFor(() => messageByKey(`order:${flow.orders.A}:confirmation`), { label: 'A confirmation' });
    const msgB = await waitFor(() => messageByKey(`order:${flow.orders.B}:confirmation`), { label: 'B confirmation' });
    assert.equal(msgA.consent_kind, 'transactional');
    await live();
    await dispatcher.runOnce({ budgetMs: 10_000 });
    assert.equal((await messageByKey(msgA.idempotency_key)).status, 'sent');
    const b = await messageByKey(msgB.idempotency_key);
    assert.deepEqual([b.status, b.block_reason], ['blocked', 'no_transactional_consent']);
  });

  test('EVENT NOTIFICATIONS: the reminder job reaches only consenting buyers, once per number', async () => {
    flow.orders.A2 = await claim(P.A, null);   // A buys again: still ONE reminder
    await supabase.from('events').update({ starts_at: new Date(Date.now() + 3 * 3600e3).toISOString() }).eq('id', flow.event);
    await live();
    await notifications.eventReminders();
    const a = await messageByKey(`event:${flow.event}:reminder:${P.A}`);
    const b = await messageByKey(`event:${flow.event}:reminder:${P.B}`);
    assert.ok(a && b, 'queued for every buyer with a phone; consent decides at dispatch');
    assert.equal(a.category, 'event_notification');
    await dispatcher.runOnce({ budgetMs: 10_000 });
    assert.equal((await messageByKey(a.idempotency_key)).status, 'sent');
    assert.equal((await messageByKey(b.idempotency_key)).block_reason, 'no_transactional_consent');
    // The job is idempotent: a second run queues nothing new.
    await notifications.eventReminders();
    const { count } = await supabase.from('sms_messages').select('id', { count: 'exact', head: true }).like('idempotency_key', `event:${flow.event}:reminder:%`);
    assert.equal(count, 3);
  });

  test('MARKETING: an Eventsli campaign reaches platform-consent holders only', async () => {
    await live();
    let r = await call('POST', '/admin/sms/segments', { name: `Flow buyers ${tail}`, definition: { eventIds: [flow.event] } }, cookies.admin);
    assert.equal(r.status, 201, r.text);
    flow.platformSegment = r.body.data.id;
    r = await call('POST', '/admin/sms/campaigns', { name: `Flow promo ${tail}`, category: 'marketing', body: 'Two for one this weekend', segmentId: flow.platformSegment }, cookies.admin);
    assert.equal(r.status, 201, r.text);
    flow.platformCampaign = r.body.data.id;
    await call('POST', `/admin/sms/campaigns/${flow.platformCampaign}/submit`, {}, cookies.admin);
    r = await call('POST', `/admin/sms/campaigns/${flow.platformCampaign}/approve`, {}, cookies.admin2);
    assert.equal(r.status, 200, r.text);

    await campaigns.runCampaigns({ budgetMs: 10_000 });
    await campaigns.runCampaigns({ budgetMs: 10_000 });
    const { data: msgs } = await supabase.from('sms_messages').select('to_e164, body, consent_kind').eq('campaign_id', flow.platformCampaign);
    assert.deepEqual(msgs.map((m) => m.to_e164), [P.C], 'A (organizer consent) and B (none) are excluded');
    assert.equal(msgs[0].consent_kind, 'marketing');
    const { data: c } = await supabase.from('sms_campaigns').select('skipped_reasons').eq('id', flow.platformCampaign).single();
    assert.ok(c.skipped_reasons.no_consent >= 2);
    await dispatcher.runOnce({ budgetMs: 10_000 });
    const { data: sent } = await supabase.from('sms_messages').select('status, body').eq('campaign_id', flow.platformCampaign).single();
    assert.equal(sent.status, 'sent');
    assert.match(sent.body, /^Eventsli: Two for one this weekend\nReply STOP to opt out$/);
  });

  test('SEGMENTATION by an organizer: own buyers, own consent, admin approval, monthly cap', async () => {
    await live();
    // No access yet: the organizer can read, not send.
    let r = await call('GET', '/organizer/sms', null, cookies.org);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.access.enabled, false);
    assert.equal(r.body.data.consent.optedIn, 1, 'A ticked "offers from this organizer" at checkout');
    r = await call('POST', '/organizer/sms/campaigns', { name: 'Nope', category: 'segmentation', body: 'x' }, cookies.org);
    assert.equal(r.status, 403);

    assert.equal((await call('PUT', `/admin/sms/organizers/${flow.org}`, { enabled: true, monthlyCap: 1 }, cookies.admin)).status, 403, 'granting is a super admin call');
    r = await call('PUT', `/admin/sms/organizers/${flow.org}`, { enabled: true, monthlyCap: 1 }, cookies.super);
    assert.equal(r.status, 200, r.text);

    r = await call('POST', '/organizer/sms/segments', { name: 'Someone else', definition: { eventIds: ['00000000-0000-4000-8000-000000000000'] } }, cookies.org);
    assert.equal(r.status, 400, 'only their own events');
    r = await call('POST', '/organizer/sms/segments', { name: 'Everyone', definition: { organizerIds: [flow.org] } }, cookies.org);
    assert.equal(r.status, 400, 'organizerIds is not theirs to set');
    r = await call('POST', '/organizer/sms/segments', { name: `My buyers ${tail}`, definition: { eventIds: [flow.event] } }, cookies.org);
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.body.data.definition.organizerIds, [flow.org], 'pinned to the organizer');
    flow.orgSegment = r.body.data.id;
    r = await call('POST', `/organizer/sms/segments/${flow.orgSegment}/preview`, {}, cookies.org);
    assert.equal(r.body.data.eligible, 1);

    r = await call('POST', '/organizer/sms/campaigns', { name: `VIP ${tail}`, category: 'segmentation', body: 'Doors open early for you tonight', segmentId: flow.orgSegment }, cookies.org);
    assert.equal(r.status, 201, r.text);
    assert.match(r.body.data.preview.body, new RegExp(`^Org ${tail}: `));
    flow.orgCampaign = r.body.data.id;

    // An admin can neither submit an organizer's draft (it could skip review),
    // nor use the organizer's audience or consent in a platform campaign.
    r = await call('POST', `/admin/sms/campaigns/${flow.orgCampaign}/submit`, {}, cookies.admin);
    assert.equal(r.status, 409, 'organizers submit their own campaigns');
    r = await call('POST', '/admin/sms/campaigns', { name: 'Borrowed consent', category: 'marketing', body: 'x', consentScope: flow.org }, cookies.admin);
    assert.equal(r.status, 400, 'a platform campaign cannot use consent given to an organizer');
    r = await call('POST', '/admin/sms/campaigns', { name: 'Borrowed audience', category: 'marketing', body: 'x', segmentId: flow.orgSegment }, cookies.admin);
    assert.equal(r.status, 400, 'nor an organizer’s audience');
    r = await call('GET', '/admin/sms/segments', null, cookies.admin);
    assert.ok(!r.body.data.some((s) => s.id === flow.orgSegment), 'organizer audiences are not listed in the console');

    r = await call('POST', `/organizer/sms/campaigns/${flow.orgCampaign}/submit`, {}, cookies.org);
    assert.equal(r.body.data.status, 'pending_approval', 'always reviewed by Eventsli');
    r = await call('POST', `/admin/sms/campaigns/${flow.orgCampaign}/approve`, {}, cookies.admin);
    assert.equal(r.status, 200, r.text);

    await campaigns.runCampaigns({ budgetMs: 10_000 });
    await campaigns.runCampaigns({ budgetMs: 10_000 });
    const { data: msgs } = await supabase.from('sms_messages').select('to_e164, consent_scope').eq('campaign_id', flow.orgCampaign);
    assert.deepEqual(msgs.map((m) => m.to_e164), [P.A], 'only the buyer who opted in to THIS organizer');
    assert.equal(msgs[0].consent_scope, flow.org);
    await dispatcher.runOnce({ budgetMs: 10_000 });
    const { data: sent } = await supabase.from('sms_messages').select('status, body').eq('campaign_id', flow.orgCampaign).single();
    assert.equal(sent.status, 'sent');
    assert.match(sent.body, new RegExp(`^Org ${tail}: Doors open early for you tonight`));

    // The monthly allowance (1) is used: a second campaign queues nothing.
    r = await call('POST', '/organizer/sms/campaigns', { name: `Again ${tail}`, category: 'segmentation', body: 'One more thing', segmentId: flow.orgSegment }, cookies.org);
    flow.orgCampaign2 = r.body.data.id;
    await call('POST', `/organizer/sms/campaigns/${flow.orgCampaign2}/submit`, {}, cookies.org);
    await call('POST', `/admin/sms/campaigns/${flow.orgCampaign2}/approve`, {}, cookies.admin);
    await campaigns.runCampaigns({ budgetMs: 10_000 });
    const { data: c2 } = await supabase.from('sms_campaigns').select('recipients_queued, skipped_reasons').eq('id', flow.orgCampaign2).single();
    assert.equal(c2.recipients_queued, 0);
    assert.equal(c2.skipped_reasons.organizer_cap, 1);
    r = await call('GET', '/organizer/sms', null, cookies.org);
    assert.equal(r.body.data.access.usedThisMonth, 1);
  });

  test('queued campaign texts stop when the campaign is cancelled or the organizer loses access', async () => {
    await live();
    // A message queued by an organizer campaign that is still sending...
    const mk = async (key) => {
      const { data } = await supabase.from('sms_messages').insert({
        idempotency_key: key, category: 'segmentation', traffic_class: 'marketing', consent_kind: 'marketing',
        to_e164: P.A, country: 'ZQ', body: 'Gate test', consent_scope: flow.org, campaign_id: flow.orgCampaign2,
        metadata: { baseBody: 'Gate test' },
      }).select('id').single();
      return data.id;
    };
    await supabase.from('sms_campaigns').update({ status: 'sending' }).eq('id', flow.orgCampaign2);
    // ...then access is turned off directly in the database (so the API's own withdrawal does not mask the gate).
    await supabase.from('sms_organizer_access').update({ enabled: false }).eq('organizer_id', flow.org);
    const id1 = await mk(`gate:${stamp}:1`);
    await dispatcher.runOnce({ budgetMs: 10_000 });
    let { data: m } = await supabase.from('sms_messages').select('status, block_reason').eq('id', id1).single();
    assert.deepEqual(m, { status: 'blocked', block_reason: 'organizer_access_revoked' });

    await supabase.from('sms_organizer_access').update({ enabled: true }).eq('organizer_id', flow.org);
    await supabase.from('sms_campaigns').update({ status: 'cancelled' }).eq('id', flow.orgCampaign2);
    const id2 = await mk(`gate:${stamp}:2`);
    await dispatcher.runOnce({ budgetMs: 10_000 });
    ({ data: m } = await supabase.from('sms_messages').select('status, block_reason').eq('id', id2).single());
    assert.deepEqual(m, { status: 'blocked', block_reason: 'campaign_cancelled' });
    await supabase.from('sms_messages').delete().like('idempotency_key', `gate:${stamp}:%`);
  });

  test('EVENT NOTIFICATIONS: a cancellation texts consenting buyers', async () => {
    await live();
    const { cancelEvent } = require('../../services/eventCancellation');
    const result = await cancelEvent({ eventId: flow.event, reason: 'Venue flooded', actorId: ids.super });
    assert.ok(result.ok, JSON.stringify(result));
    const a = await waitFor(() => messageByKey(`event:${flow.event}:cancelled:${P.A}`), { label: 'cancellation text' });
    assert.match(a.body, /has been cancelled/);
    await dispatcher.runOnce({ budgetMs: 10_000 });
    assert.equal((await messageByKey(a.idempotency_key)).status, 'sent');
  });

  test('keywords: START restores only what STOP took away; HELP is answered through the queue on Vonage', async () => {
    const tok = auth.sign('inbound:vonage');
    const inbound = (text, id) => call('POST', `/sms/webhooks/vonage/inbound?t=${tok}`, { msisdn: P.C.slice(1), text, messageId: `${id}-${stamp}` });
    // C withdrew organizer consent on the account page, then texts STOP and START.
    await supabase.from('sms_consents').upsert({ phone_e164: P.C, scope: flow.org, kind: 'marketing', status: 'opted_out', source: 'account' }, { onConflict: 'phone_e164,scope,kind' });
    assert.equal((await inbound('STOP', 'kw1')).status, 200);
    assert.equal((await inbound('START', 'kw2')).status, 200);
    const rows = await consentsOf(P.C);
    assert.equal(rows.find((x) => x.scope === 'platform' && x.kind === 'marketing').status, 'opted_in', 'the STOP is undone');
    assert.equal(rows.find((x) => x.scope === flow.org).status, 'opted_out', 'an account-page opt-out stands');

    await supabase.from('sms_settings').update({ reply_to_help: true }).eq('id', 1);
    config.invalidate();
    const help = await inbound('HELP', 'kw3');
    assert.equal(help.status, 200);
    const { data: reply } = await supabase.from('sms_messages').select('to_e164, metadata').like('idempotency_key', 'reply:vonage:%').eq('to_e164', P.C).maybeSingle();
    assert.ok(reply, 'Vonage cannot answer inline, so the HELP reply is queued');
    assert.equal(reply.metadata.consentExempt, 'keyword_reply');
    await supabase.from('sms_settings').update({ reply_to_help: false }).eq('id', 1);
    await supabase.from('sms_messages').delete().like('idempotency_key', 'reply:vonage:%').eq('to_e164', P.C);

    // STOP confirmation, for a provider configured to need one — and it is
    // sent even though the number is now suppressed.
    await supabase.from('sms_settings').update({ stop_confirmation_providers: ['vonage'] }).eq('id', 1);
    config.invalidate();
    await live();
    assert.equal((await inbound('STOP', 'kw4')).status, 200);
    const { data: conf } = await supabase.from('sms_messages').select('id, metadata').like('idempotency_key', 'stopconf:vonage:%').eq('to_e164', P.C).single();
    assert.equal(conf.metadata.consentExempt, 'stop_confirmation');
    await dispatcher.runOnce({ budgetMs: 10_000 });
    const { data: confSent } = await supabase.from('sms_messages').select('status').eq('id', conf.id).single();
    assert.equal(confSent.status, 'sent', 'the one confirmation gets through the STOP');
    await supabase.from('sms_settings').update({ stop_confirmation_providers: [] }).eq('id', 1);
    await supabase.from('sms_messages').delete().eq('id', conf.id);
    await supabase.from('sms_suppressions').delete().eq('phone_e164', P.C);
    await supabase.from('sms_inbound').delete().eq('from_e164', P.C);
    config.invalidate();
  });

  test('credentials: stored encrypted, never returned, super admin only, refused without a key', async () => {
    const secret = `Sec${tail}abcdefgh`;
    assert.equal((await call('PUT', '/admin/sms/providers/vonage/credentials', { apiKey: 'abcd1234', apiSecret: secret }, cookies.admin)).status, 403);
    assert.equal((await call('PUT', '/admin/sms/providers/vonage/credentials', { apiKey: 'no!', apiSecret: secret }, cookies.super)).status, 400);

    const key = process.env.SMS_CREDENTIALS_KEY;
    delete process.env.SMS_CREDENTIALS_KEY;
    assert.equal((await call('PUT', '/admin/sms/providers/vonage/credentials', { apiKey: 'abcd1234', apiSecret: secret }, cookies.super)).status, 409);
    process.env.SMS_CREDENTIALS_KEY = key;

    const r = await call('PUT', '/admin/sms/providers/vonage/credentials', { apiKey: 'abcd1234', apiSecret: secret }, cookies.super);
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes(secret), 'the secret is never sent back');
    assert.equal(r.body.data.fields.apiKey.source, 'stored');
    assert.equal(r.body.data.fields.apiKey.hint, '…1234');
    assert.equal(r.body.data.fields.apiSecret.hint, null);
    const { data: row } = await supabase.from('sms_provider_credentials').select('*').eq('provider_id', 'vonage').single();
    assert.ok(!JSON.stringify(row).includes(secret), 'ciphertext only at rest');

    const list = await call('GET', '/admin/sms/providers', null, cookies.admin);
    assert.ok(!list.text.includes(secret));
    assert.equal(list.body.data.find((p) => p.id === 'vonage').credentials.configured, true);
    const audit = await supabase.from('admin_audit').select('payload').eq('action', 'sms.provider.credentials_saved').eq('actor_id', ids.super);
    assert.ok(!JSON.stringify(audit.data).includes(secret), 'the audit names fields, never values');

    const del = await call('DELETE', '/admin/sms/providers/vonage/credentials', null, cookies.super);
    assert.equal(del.body.data.configured, Boolean(process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET));
  });

  test('countries: ready filter, bulk switch refuses unverified ones, verification withdrawn only when off', async () => {
    await call('POST', '/admin/sms/countries', { iso2: 'ZX', name: 'Testland Two', dialCode: '990', timezone: 'UTC', region: 'Other' }, cookies.super);
    let r = await call('POST', '/admin/sms/countries/bulk-status', { iso2s: ['ZQ', 'ZX'], status: 'enabled' }, cookies.super);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.data.results.find((x) => x.iso2 === 'ZX'), { iso2: 'ZX', ok: false, reason: 'not_verified' });
    assert.ok(r.body.data.results.find((x) => x.iso2 === 'ZQ').ok);

    assert.equal((await call('POST', '/admin/sms/countries/ZQ/unverify', { reason: 'test' }, cookies.super)).status, 409, 'turn it off first');
    await call('POST', '/admin/sms/countries/bulk-status', { iso2s: ['ZQ'], status: 'disabled' }, cookies.super);
    r = await call('GET', '/admin/sms/countries?status=ready&q=Testland', null, cookies.admin);
    assert.ok(r.body.data.some((c) => c.iso2 === 'ZQ'), 'verified and off: ready to turn on');
    r = await call('GET', '/admin/sms/countries/ZQ/history', null, cookies.admin);
    assert.ok(r.body.data.some((h) => h.action === 'sms.country.verified'));
    await call('POST', '/admin/sms/countries/bulk-status', { iso2s: ['ZQ'], status: 'enabled' }, cookies.super);
    await supabase.from('sms_countries').delete().eq('iso2', 'ZX');
  });

  test('retention: old message text is redacted, the rows and consent evidence stay', async () => {
    const { data: old } = await supabase.from('sms_messages').insert({
      idempotency_key: `ret:${stamp}`, category: 'participant', traffic_class: 'transactional', to_e164: P.A, country: 'ZQ',
      body: 'Secret old text', status: 'delivered', created_at: new Date(Date.now() - 400 * 86400e3).toISOString(),
      metadata: { baseBody: 'Secret old text' },
    }).select('id').single();
    assert.deepEqual(await maintenance.applyRetention(), { skipped: 'retention not configured' }, 'off until the owner sets a period');
    await supabase.from('sms_settings').update({ message_retention_days: 365 }).eq('id', 1);
    config.invalidate();
    await maintenance.applyRetention();
    const { data: after } = await supabase.from('sms_messages').select('body, metadata, status, to_e164').eq('id', old.id).single();
    assert.equal(after.body, maintenance.REDACTED);
    assert.deepEqual(after.metadata, {});
    assert.equal(after.status, 'delivered', 'the row itself stays for analytics');
    const { count } = await supabase.from('sms_consent_log').select('id', { count: 'exact', head: true }).eq('phone_e164', P.A);
    assert.ok(count > 0, 'consent evidence is never redacted');
    await supabase.from('sms_settings').update({ message_retention_days: null }).eq('id', 1);
    await supabase.from('sms_messages').delete().eq('id', old.id);
    config.invalidate();
  });

  test('health: a backlog is reported (and logged at ERROR level for alerting)', async () => {
    await live();
    const { data: late } = await supabase.from('sms_messages').insert({
      idempotency_key: `health:${stamp}`, category: 'participant', traffic_class: 'transactional', to_e164: P.A, country: 'ZQ',
      body: 'Late', status: 'queued', next_attempt_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    }).select('id').single();
    const findings = await maintenance.checkHealth();
    assert.ok(findings.backlogMinutes >= 29);
    await supabase.from('sms_messages').delete().eq('id', late.id);
  });

  test('categories: transactional consent can be required or relaxed; marketing consent cannot be relaxed', async () => {
    let r = await call('PATCH', '/admin/sms/categories/participant', { requiresConsent: false }, cookies.admin);
    assert.equal(r.status, 403, 'a super admin decision');
    r = await call('PATCH', '/admin/sms/categories/participant', { requiresConsent: false }, cookies.super);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.data.requiresConsent, false);
    r = await call('PATCH', '/admin/sms/categories/participant', { requiresConsent: true }, cookies.super);
    assert.equal(r.body.data.requiresConsent, true);
    r = await call('PATCH', '/admin/sms/categories/marketing', { requiresConsent: false }, cookies.super);
    assert.equal(r.status, 400, 'marketing always requires consent');
    const { data } = await supabase.from('sms_categories').select('requires_consent').eq('key', 'marketing').single();
    assert.equal(data.requires_consent, true);
  });

  test('flows: clean up', async () => {
    const campaignsMade = [flow.platformCampaign, flow.orgCampaign, flow.orgCampaign2].filter(Boolean);
    if (campaignsMade.length) {
      await supabase.from('sms_messages').delete().in('campaign_id', campaignsMade);
      await supabase.from('sms_campaigns').delete().in('id', campaignsMade);
    }
    await supabase.from('sms_segments').delete().in('id', [flow.platformSegment, flow.orgSegment].filter(Boolean));
    await supabase.from('sms_messages').delete().eq('event_id', flow.event);
    for (const p of Object.values(P)) {
      await supabase.from('sms_consents').delete().eq('phone_e164', p);
      await supabase.from('sms_consent_log').delete().eq('phone_e164', p);
    }
    if (flow.event) {
      const { data: orders } = await supabase.from('orders').select('id').eq('event_id', flow.event);
      const orderIds = (orders || []).map((o) => o.id);
      if (orderIds.length) {
        await supabase.from('sms_messages').delete().in('order_id', orderIds);
        await supabase.from('tickets').delete().in('order_id', orderIds);
        await supabase.from('ledger_entries').delete().in('order_id', orderIds);
      }
      await supabase.from('orders').delete().eq('event_id', flow.event);
      const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', flow.event);
      for (const res of rs || []) await supabase.from('reservation_items').delete().eq('reservation_id', res.id);
      await supabase.from('terms_acceptances').delete().eq('event_id', flow.event);
      await supabase.from('reservations').delete().eq('event_id', flow.event);
      await supabase.from('scanner_access').delete().eq('event_id', flow.event);
      await supabase.from('ticket_tiers').delete().eq('event_id', flow.event);
      await supabase.from('events').delete().eq('id', flow.event);
    }
    if (flow.org) {
      await supabase.from('sms_organizer_access').delete().eq('organizer_id', flow.org);
      await supabase.from('organizers').delete().eq('id', flow.org);
    }
    for (const id of flow.users) {
      await supabase.from('email_verifications').delete().eq('user_id', id);
      await supabase.from('sessions').delete().eq('user_id', id);
      await supabase.from('profiles').delete().eq('id', id);
    }
  });
};
