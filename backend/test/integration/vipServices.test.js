const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

require('../helpers/testEnv');

// WhatsApp "connected" for this file, against a fake Meta (below).
process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '111000111';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
delete process.env.WHATSAPP_DRY_RUN;

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * VIP SERVICES WITH WHATSAPP, END TO END (2026-11-28).
 *
 * An organizer asks for VIP Services; the confirmation goes out as the
 * approved WhatsApp template; they write on WhatsApp quoting the reference
 * and the message lands on their request; the team replies (a normal
 * WhatsApp message, inside the 24-hour window) and changes the status;
 * receipts arrive out of order; a failed one falls back to email; a stranger
 * lands in the Unmatched inbox and is linked; the team's own phone messages
 * (echoes) are kept. Meta is faked at `fetch`; everything else is real.
 */
let server; let baseUrl;
const stamp = Date.now();
const tail = String(stamp).slice(-4);
const ORG_PHONE = `+1619555${tail}`;
const STRANGER = `+4420794${tail}0`;
const PASSWORD = 'a-perfectly-long-passphrase';
const users = []; const organizers = [];
let superCookie; let adminCookie; let orgCookie; let otherCookie; let eventId;
let originalSettings = null; let hadSettings = false;

// ── A fake Meta ──────────────────────────────────────────────────────────
const graph = [];
let failNextSend = null;
let sent = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://graph.facebook.com/')) {
    const body = init.body ? JSON.parse(init.body) : null;
    graph.push({ url: u, method: init.method || 'GET', body, auth: init.headers?.authorization });
    const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('/MEDIA-PHOTO')) {
      return json(200, { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg', file_size: 4, id: 'MEDIA-PHOTO' });
    }
    if (u.endsWith('/messages') && body?.status === 'read') return json(200, { success: true });
    if (u.endsWith('/messages')) {
      if (failNextSend) {
        const e = failNextSend; failNextSend = null;
        return json(400, { error: { message: e, code: 131026, error_data: { details: 'Receiver is incapable of receiving this message' } } });
      }
      sent += 1;
      return json(200, { messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.out.${stamp}.${sent}` }] });
    }
    return json(404, { error: { message: 'unknown', code: 100 } });
  }
  if (u.startsWith('https://lookaside.fbsbx.com/')) return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  return realFetch(url, init);
};

const call = async (method, path, { cookie, body } = {}) => {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
};

/** Meta posting to our webhook, signed (or not). */
async function hook(payload, { signed = true } = {}) {
  const raw = JSON.stringify(payload);
  const sig = `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
  const res = await realFetch(`${baseUrl}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signed ? { 'x-hub-signature-256': sig } : {}) },
    body: raw,
  });
  return res.status;
}
const envelope = (field, value) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '16196666620', phone_number_id: '111000111' }, ...value } }] }],
});
const digits = (e) => e.slice(1);
const inbound = (from, id, text, extra = {}) => envelope('messages', {
  contacts: [{ profile: { name: 'Sara WA' }, wa_id: digits(from) }],
  messages: [{ from: digits(from), id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text }, ...extra }],
});
const receipt = (id, status, errors) => envelope('messages', {
  statuses: [{ id, status, recipient_id: digits(ORG_PHONE), timestamp: '1', ...(errors ? { errors } : {}) }],
});

async function account(role, { organizer = false } = {}) {
  const email = `vip-${role}-${users.length}-${stamp}@eventsli-test.invalid`;
  const reg = await call('POST', '/auth/register', { body: { email, password: PASSWORD, fullName: `Vip ${role} ${users.length}` } });
  const id = reg.body.data.id;
  users.push(id);
  await supabase.from('profiles').update({ role, email_verified_at: new Date().toISOString() }).eq('id', id);
  if (organizer) {
    const { data: org } = await supabase.from('organizers').insert({ owner_user_id: id, display_name: `Vip Org ${users.length}`, country: 'US' }).select('id').single();
    organizers.push(org.id);
  }
  const login = await realFetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (login.headers.get('set-cookie') || '').split(';')[0];
}

async function rows(requestId) {
  const { data } = await supabase.from('vip_service_messages').select('*').eq('request_id', requestId).order('created_at');
  return data || [];
}

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const { data } = await supabase.from('platform_settings').select('value').eq('key', 'vip_services').maybeSingle();
  hadSettings = Boolean(data);
  originalSettings = data?.value ?? null;
  await supabase.from('platform_settings').delete().eq('key', 'vip_services');

  superCookie = await account('super_admin');
  adminCookie = await account('admin');
  orgCookie = await account('organizer', { organizer: true });
  otherCookie = await account('organizer', { organizer: true });

  const { data: terms } = await supabase.from('terms_versions').select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: organizers[0], slug: `vip-gala-${stamp}`, title: 'VIP Gala Night',
    country: 'US', timezone: 'America/Los_Angeles', city: 'San Diego',
    starts_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86400e3 + 3600e3).toISOString(),
    currency: 'USD', status: 'draft', terms_accepted_id: terms.id,
    admission_type: 'general', purchase_mode: 'seat_only', max_tickets_per_order: 10,
  }).select('id').single();
  if (error) throw new Error(`seed: ${error.message}`);
  eventId = ev.id;
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const id of organizers) await supabase.from('vip_service_requests').delete().eq('organizer_id', id);
  await supabase.from('vip_service_messages').delete().in('wa_contact', [ORG_PHONE, STRANGER]).is('request_id', null);
  if (eventId) await supabase.from('events').delete().eq('id', eventId);
  if (hadSettings) await supabase.from('platform_settings').upsert({ key: 'vip_services', value: originalSettings });
  else await supabase.from('platform_settings').delete().eq('key', 'vip_services');
  for (const id of organizers) await supabase.from('organizers').delete().eq('id', id);
  for (const id of users) {
    await supabase.from('admin_audit').delete().eq('actor_id', id);
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

let req; // the organizer's request, shared down the file

test('the start page: the offer, their events, and a WhatsApp link to the team', async () => {
  const r = await call('GET', '/organizer/vip/options', { cookie: orgCookie });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.settings.whatsappNumber, '+16196666620');
  assert.equal(r.body.data.settings.email, 'info@eventsli.com');
  assert.ok(r.body.data.settings.services.length >= 6);
  assert.deepEqual(r.body.data.events.map((e) => e.id), [eventId]);
  assert.match(r.body.data.chatUrl, /^https:\/\/wa\.me\/16196666620\?text=/);
  assert.equal((await call('GET', '/organizer/vip/options')).status, 401);
});

test('a request: stored with a reference, confirmed on WhatsApp as the approved template', async () => {
  graph.length = 0;
  const r = await call('POST', '/organizer/vip', {
    cookie: orgCookie,
    body: {
      services: ['seating', 'door'], eventId, guestCount: 400, budget: '5k_15k',
      details: 'Please draw our ballroom and staff two doors on the night.',
      contactName: 'Sara Haddad', contactEmail: `sara-${stamp}@eventsli-test.invalid`,
      whatsappNumber: `+1 619 555 ${tail}`, whatsappOptIn: true, preferredChannel: 'whatsapp',
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  req = r.body.data.request;
  assert.match(req.reference, /^VIP-[2-9A-HJ-NP-Z]{6}$/);
  assert.equal(req.whatsappNumber, ORG_PHONE);
  assert.deepEqual(req.serviceTitles, ['Seat map design', 'Door and check-in team']);
  assert.equal(req.event.title, 'VIP Gala Night');
  assert.ok(decodeURIComponent(r.body.data.chatUrl).includes(req.reference), 'the reference is typed into the chat');

  const send = graph.find((g) => g.url.endsWith('/111000111/messages'));
  assert.ok(send, 'WhatsApp was called');
  assert.equal(send.auth, 'Bearer test-token');
  assert.equal(send.body.to, digits(ORG_PHONE));
  assert.equal(send.body.type, 'template');
  assert.equal(send.body.template.name, 'vip_request_update');
  assert.deepEqual(send.body.template.components[0].parameters.slice(0, 2).map((p) => p.text), ['Sara', req.reference]);

  const msgs = await rows(req.id);
  assert.deepEqual(msgs.map((m) => [m.channel, m.author_kind]), [['system', 'system'], ['whatsapp', 'system']]);
  assert.equal(msgs[1].wa_status, 'queued');
  assert.equal(msgs[1].wa_template, 'update');
});

test('another organizer sees nothing of it and cannot use the event', async () => {
  assert.equal((await call('GET', `/organizer/vip/${req.id}`, { cookie: otherCookie })).status, 404);
  const list = await call('GET', '/organizer/vip', { cookie: otherCookie });
  assert.deepEqual(list.body.data.requests, []);
  const r = await call('POST', '/organizer/vip', {
    cookie: otherCookie,
    body: { services: ['seating'], eventId, details: 'Borrowing someone else event', contactName: 'X', contactEmail: `x-${stamp}@eventsli-test.invalid` },
  });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'EVENT_NOT_FOUND');
});

test('Meta\'s webhook check, and nothing unsigned is believed', async () => {
  const ok = await realFetch(`${baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '12345');
  const bad = await realFetch(`${baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`);
  assert.equal(bad.status, 403);
  assert.equal(await hook(inbound(ORG_PHONE, `wamid.forged.${stamp}`, `forged ${req.reference}`), { signed: false }), 401);
  const { count } = await supabase.from('vip_service_messages').select('id', { count: 'exact', head: true }).eq('wa_message_id', `wamid.forged.${stamp}`);
  assert.equal(count, 0);
});

test('they write on WhatsApp: it lands on their request, once, however often Meta delivers it', async () => {
  const payload = inbound(ORG_PHONE, `wamid.in.${stamp}.1`, `Hi Eventsli, about ${req.reference}: the ballroom has 40 tables.`);
  assert.equal(await hook(payload), 200);
  assert.equal(await hook(payload), 200);
  const msgs = (await rows(req.id)).filter((m) => m.direction === 'in' && m.channel === 'whatsapp');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].wa_contact_name, 'Sara WA');

  const view = await call('GET', `/organizer/vip/${req.id}`, { cookie: orgCookie });
  assert.ok(view.body.data.messages.some((m) => m.body?.includes('40 tables')));
  assert.ok(view.body.data.whatsapp.activeUntil, 'the 24-hour window is open');
});

test('the team replies: a normal WhatsApp message inside the window; receipts never step back', async () => {
  graph.length = 0;
  const r = await call('POST', `/admin/vip/requests/${req.id}/reply`, { cookie: adminCookie, body: { text: 'Lovely, send the floor plan here.' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.delivery.via, 'whatsapp_text');
  const send = graph.find((g) => g.body?.type === 'text');
  assert.equal(send.body.text.body, 'Lovely, send the floor plan here.');

  const out = (await rows(req.id)).find((m) => m.body === 'Lovely, send the floor plan here.');
  assert.equal(out.author_kind, 'team');
  assert.equal(await hook(receipt(out.wa_message_id, 'delivered')), 200);
  assert.equal(await hook(receipt(out.wa_message_id, 'sent')), 200); // late, out of order
  let now = (await rows(req.id)).find((m) => m.id === out.id);
  assert.equal(now.wa_status, 'delivered');
  await hook(receipt(out.wa_message_id, 'read'));
  now = (await rows(req.id)).find((m) => m.id === out.id);
  assert.equal(now.wa_status, 'read');

  // Answering a new request moved it on.
  const got = await call('GET', `/admin/vip/requests/${req.id}`, { cookie: adminCookie });
  assert.equal(got.body.data.request.status, 'in_review');
  assert.equal(got.body.data.delivery.via, 'whatsapp_text');
  // Opening it sent blue ticks for their last message.
  assert.ok(graph.some((g) => g.body?.status === 'read' && g.body.message_id === `wamid.in.${stamp}.1`));
});

test('a status change: recorded, emailed and sent on WhatsApp', async () => {
  graph.length = 0;
  const r = await call('PATCH', `/admin/vip/requests/${req.id}`, { cookie: adminCookie, body: { status: 'quoted', note: 'Proposal: $6,500 for both.' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.request.status, 'quoted');
  assert.equal(r.body.data.delivery.via, 'whatsapp_text');
  assert.match(graph.find((g) => g.body?.type === 'text').body.text.body, /Proposal: \$6,500/);
  const msgs = await rows(req.id);
  assert.ok(msgs.some((m) => m.channel === 'system' && m.body.startsWith('Status: Proposal sent')));
});

test('a WhatsApp failure falls back to email, and says why', async () => {
  failNextSend = 'Message undeliverable';
  const r = await call('POST', `/admin/vip/requests/${req.id}/reply`, { cookie: adminCookie, body: { text: 'This one will bounce.' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.delivery.via, 'email');
  const m = (await rows(req.id)).find((x) => x.body === 'This one will bounce.');
  assert.equal(m.channel, 'email');
  assert.equal(m.wa_status, 'failed');
  assert.match(m.wa_error, /131026/);

  // …and a LATER failure (a receipt) does the same.
  await call('POST', `/admin/vip/requests/${req.id}/reply`, { cookie: adminCookie, body: { text: 'Accepted, then failed.' } });
  const later = (await rows(req.id)).find((x) => x.body === 'Accepted, then failed.');
  await hook(receipt(later.wa_message_id, 'failed', [{ code: 131049, title: 'Not delivered to keep the ecosystem healthy' }]));
  const after_ = (await rows(req.id)).find((x) => x.id === later.id);
  assert.equal(after_.wa_status, 'failed');
  assert.match(after_.wa_error, /131049.*sent by email instead/);
  const org = await call('GET', `/organizer/vip/${req.id}`, { cookie: orgCookie });
  assert.match(org.body.data.messages.find((x) => x.id === later.id).error, /sent by email/);
});

test('what the team types on the business phone is kept on the request', async () => {
  const echo = envelope('smb_message_echoes', {
    message_echoes: [{ from: '16196666620', to: digits(ORG_PHONE), id: `wamid.echo.${stamp}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Typed on the phone' } }],
  });
  assert.equal(await hook(echo), 200);
  const m = (await rows(req.id)).find((x) => x.wa_message_id === `wamid.echo.${stamp}`);
  assert.equal(m.author_kind, 'team');
  assert.equal(m.direction, 'out');
});

test('STOP on WhatsApp turns updates there off (answered once); START turns them back on', async () => {
  graph.length = 0;
  assert.equal(await hook(inbound(ORG_PHONE, `wamid.in.${stamp}.stop`, 'STOP')), 200);
  let { data: r } = await supabase.from('vip_service_requests').select('whatsapp_opt_in, preferred_channel').eq('id', req.id).single();
  assert.deepEqual(r, { whatsapp_opt_in: false, preferred_channel: 'email' });
  assert.match(graph.find((g) => g.body?.type === 'text').body.text.body, /will not send you updates/);

  await hook(inbound(ORG_PHONE, `wamid.in.${stamp}.start`, 'start'));
  ({ data: r } = await supabase.from('vip_service_requests').select('whatsapp_opt_in, preferred_channel').eq('id', req.id).single());
  assert.deepEqual(r, { whatsapp_opt_in: true, preferred_channel: 'whatsapp' });
});

test('a photo from the chat: the organizer and the team can open it, nobody else', async () => {
  await hook(inbound(ORG_PHONE, `wamid.in.${stamp}.photo`, null, { type: 'image', text: undefined, image: { id: 'MEDIA-PHOTO', mime_type: 'image/jpeg', caption: 'Floor plan' } }));
  const m = (await rows(req.id)).find((x) => x.wa_message_id === `wamid.in.${stamp}.photo`);
  assert.equal(m.body, 'Floor plan');
  const mine = await realFetch(`${baseUrl}/organizer/vip/media/${m.id}`, { headers: { cookie: orgCookie } });
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get('content-type'), 'image/jpeg');
  assert.match(mine.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await mine.arrayBuffer()).byteLength, 4);
  assert.equal((await realFetch(`${baseUrl}/organizer/vip/media/${m.id}`, { headers: { cookie: otherCookie } })).status, 404);
  assert.equal((await realFetch(`${baseUrl}/admin/vip/media/${m.id}`, { headers: { cookie: adminCookie } })).status, 200);
});

test('a stranger lands in Unmatched; the team links them to a request', async () => {
  assert.equal(await hook(inbound(STRANGER, `wamid.in.${stamp}.stranger`, 'Hello, do you do weddings?')), 200);
  const inbox = await call('GET', '/admin/vip/whatsapp/unmatched', { cookie: adminCookie });
  const group = inbox.body.data.contacts.find((c) => c.contact === STRANGER);
  assert.ok(group, JSON.stringify(inbox.body));
  assert.equal(group.count, 1);
  assert.ok(group.windowOpenUntil);

  // Inside the window the team can answer straight from the inbox.
  const answer = await call('POST', '/admin/vip/whatsapp/reply', { cookie: adminCookie, body: { contact: STRANGER, text: 'We do! Start a request in your dashboard.' } });
  assert.equal(answer.status, 201, JSON.stringify(answer.body));

  const linked = await call('POST', '/admin/vip/whatsapp/link', { cookie: adminCookie, body: { contact: STRANGER, requestId: req.id } });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.data.moved, 2);
  assert.ok((await rows(req.id)).some((m) => m.wa_message_id === `wamid.in.${stamp}.stranger`));
});

test('a quoted reference from a different number is not trusted on its own', async () => {
  const other = `+4420794${tail}9`;
  await hook(inbound(other, `wamid.in.${stamp}.spoof`, `About ${req.reference}`));
  const { data } = await supabase.from('vip_service_messages').select('request_id').eq('wa_message_id', `wamid.in.${stamp}.spoof`).single();
  assert.equal(data.request_id, null);
  await supabase.from('vip_service_messages').delete().eq('wa_message_id', `wamid.in.${stamp}.spoof`);
});

test('no number given: the team\'s replies go by email; the organizer writes on the dashboard', async () => {
  const r = await call('POST', '/organizer/vip', {
    cookie: orgCookie,
    body: { services: ['marketing'], eventName: 'Spring Fair', details: 'A launch plan for a spring fair.', contactName: 'Sara', contactEmail: `sara-${stamp}@eventsli-test.invalid` },
  });
  assert.equal(r.status, 201);
  const second = r.body.data.request;
  assert.equal(second.preferredChannel, 'email');

  const reply = await call('POST', `/admin/vip/requests/${second.id}/reply`, { cookie: adminCookie, body: { text: 'Here is our plan.' } });
  assert.equal(reply.body.data.delivery.via, 'email');

  const msg = await call('POST', `/organizer/vip/${second.id}/messages`, { cookie: orgCookie, body: { text: 'Thank you!' } });
  assert.equal(msg.status, 201);
  const list = await call('GET', '/admin/vip/requests?view=open', { cookie: adminCookie });
  const row = list.body.data.requests.find((x) => x.id === second.id);
  assert.equal(row.unread, true);
  assert.ok(list.body.data.counts.waiting >= 1);

  // Cancelled: no more messages.
  const c = await call('POST', `/organizer/vip/${second.id}/cancel`, { cookie: orgCookie, body: { reason: 'Changed plans' } });
  assert.equal(c.body.data.request.status, 'cancelled');
  assert.equal((await call('POST', `/organizer/vip/${second.id}/messages`, { cookie: orgCookie, body: { text: 'hello?' } })).status, 400);
});

test('settings: every admin reads them, only a super admin changes them; switched off, nothing new', async () => {
  assert.equal((await call('GET', '/admin/vip/settings', { cookie: adminCookie })).status, 200);
  assert.equal((await call('PUT', '/admin/vip/settings', { cookie: adminCookie, body: { settings: { enabled: false } } })).status, 403);
  assert.equal((await call('GET', '/admin/vip/connection', { cookie: adminCookie })).status, 403);
  const conn = await call('GET', '/admin/vip/connection', { cookie: superCookie });
  assert.equal(conn.body.data.sending, true);
  assert.ok(!JSON.stringify(conn.body).includes('test-token'));

  const off = await call('PUT', '/admin/vip/settings', { cookie: superCookie, body: { settings: { enabled: false } } });
  assert.equal(off.status, 200);
  const r = await call('POST', '/organizer/vip', {
    cookie: orgCookie,
    body: { services: ['other'], details: 'Anything at all, please.', contactName: 'Sara', contactEmail: `sara-${stamp}@eventsli-test.invalid` },
  });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'FEATURE_DISABLED');
});
