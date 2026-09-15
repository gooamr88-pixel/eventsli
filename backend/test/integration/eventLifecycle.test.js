const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');

/**
 * The event lifecycle, end to end, against the real database.
 *
 * What this proves that a unit test cannot: that the field allowlist actually
 * stops an organizer setting their own commission, that the review loop really
 * blocks self-publishing, that the price freeze is enforced by Postgres rather
 * than by a controller someone can route around.
 */

let server; let baseUrl;
const cleanup = { profiles: [], organizers: [], events: [] };

const PASSWORD = 'a-perfectly-long-passphrase';
const stamp = Date.now();
const ORG_EMAIL = `org-${stamp}@eventsli-test.invalid`;
const ADMIN_EMAIL = `adm-${stamp}@eventsli-test.invalid`;

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

const organizer = client();
const admin = client();
let eventId;

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const o = await organizer('POST', '/auth/register', {
    email: ORG_EMAIL, password: PASSWORD, fullName: 'Org Owner',
  });
  cleanup.profiles.push(o.body.data.id);
  // Registering no longer signs in: confirm the address as the emailed code
  // would, then sign in.
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', o.body.data.id);
  await organizer('POST', '/auth/login', { email: ORG_EMAIL, password: PASSWORD });

  const a = await admin('POST', '/auth/register', {
    email: ADMIN_EMAIL, password: PASSWORD, fullName: 'Admin Person',
  });
  cleanup.profiles.push(a.body.data.id);
  // Promoted directly: there is no self-service path to admin, by design.
  await supabase.from('profiles')
    .update({ role: 'admin', email_verified_at: new Date().toISOString() })
    .eq('id', a.body.data.id);
  await admin('POST', '/auth/login', { email: ADMIN_EMAIL, password: PASSWORD });
});

after(async () => {
  for (const id of cleanup.events) await supabase.from('events').delete().eq('id', id);
  for (const id of cleanup.organizers) await supabase.from('organizers').delete().eq('id', id);
  for (const id of cleanup.profiles) {
    await supabase.from('terms_acceptances').delete().eq('user_id', id);
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
  }
  await new Promise((r) => server.close(r));
});

test('creating an organizer profile grants the organizer role', async () => {
  const before = await organizer('GET', '/auth/me');
  assert.equal(before.body.data.role, 'attendee');

  const res = await organizer('POST', '/organizer', { displayName: 'Test Events Co', country: 'CA' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  cleanup.organizers.push(res.body.data.id);

  // The role must be live on the very next request — the access cache is
  // invalidated explicitly for exactly this reason.
  const after_ = await organizer('GET', '/auth/me');
  assert.equal(after_.body.data.role, 'organizer');
  assert.equal(after_.body.data.isOrganizer, true);
});

test('currency is derived from the event country, not chosen', async () => {
  const res = await organizer('POST', '/events', {
    title: 'Integration Test Gala',
    country: 'CA',
    timezone: 'America/Toronto',
    startsAt: new Date(Date.now() + 30 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 30 * 86400e3 + 4 * 3600e3).toISOString(),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  eventId = res.body.data.id;
  cleanup.events.push(eventId);

  assert.equal(res.body.data.currency, 'CAD', 'a Canadian event must be priced in CAD');
  assert.equal(res.body.data.status, 'draft');
  assert.equal(res.body.data.fees.commissionPct, 1.5);
  assert.equal(res.body.data.fees.paymentFeeMode, 'auto');
  assert.match(res.body.data.slug, /^integration-test-gala/);
});

test('a US event is priced in USD', async () => {
  const res = await organizer('POST', '/events', {
    title: 'US Test Event',
    country: 'US',
    timezone: 'America/New_York',
    startsAt: new Date(Date.now() + 40 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 40 * 86400e3 + 3600e3).toISOString(),
  });
  assert.equal(res.status, 201);
  cleanup.events.push(res.body.data.id);
  assert.equal(res.body.data.currency, 'USD');
});

test('an unsupported country is refused rather than defaulted', async () => {
  const res = await organizer('POST', '/events', {
    title: 'Nowhere Event',
    country: 'EG',
    timezone: 'Africa/Cairo',
    startsAt: new Date(Date.now() + 20 * 86400e3).toISOString(),
    endsAt: new Date(Date.now() + 20 * 86400e3 + 3600e3).toISOString(),
  });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /CA|US/, 'the message should say which markets are open');
});

// ── BRD §05 — the commission is the admin's, and only the admin's ───────────

test('an organizer cannot set their own commission', async () => {
  const res = await organizer('PATCH', `/events/${eventId}`, { commission_pct: 0 });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body.meta.deniedFields, ['commission_pct']);
  // Told, not silently ignored: a 200 here would have them believing it worked.
  assert.match(res.body.message, /cannot change/i);
});

test('an organizer cannot set the tax or the payment fee either', async () => {
  const res = await organizer('PATCH', `/events/${eventId}`, {
    event_tax_pct: 0, payment_fee_pct: 0, payment_fee_mode: 'manual',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.meta.deniedFields.length, 3);
});

test('an organizer CAN choose who bears the payment fee', async () => {
  const res = await organizer('PATCH', `/events/${eventId}`, { feeBearer: 'organizer' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.fees.feeBearer, 'organizer');
});

test('an unknown field is rejected, not quietly dropped', async () => {
  const res = await organizer('PATCH', `/events/${eventId}`, { status: 'published' });
  assert.equal(res.status, 403, 'status must not be settable through the edit endpoint');
  assert.deepEqual(res.body.meta.deniedFields, ['status']);
});

// ── BRD §16 / §21 — review and terms ────────────────────────────────────────

test('submitting without accepting the terms is refused', async () => {
  const seen = await organizer('GET', `/events/${eventId}`);
  assert.equal(seen.body.data.review.termsAccepted, false);

  const res = await organizer('POST', `/events/${eventId}/submit`);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'TERMS_NOT_ACCEPTED');
  assert.equal(res.body.meta.version, 1);
});

test('REGRESSION: an accepted draft reads as accepted BEFORE it is submitted', async () => {
  // The dashboard shows Submit only when `review.termsAccepted` is true. That
  // flag came from a column only `submit` wrote, so accepting changed nothing
  // the page could see and Submit stayed locked behind itself.
  const accept = await organizer('POST', `/events/${eventId}/accept-terms`);
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  assert.equal(accept.body.data.version, 1);
  assert.equal(accept.body.data.event.review.termsAccepted, true, 'the answer must carry the updated event');
  assert.equal(accept.body.data.event.status, 'draft', 'accepting is not submitting');

  const seen = await organizer('GET', `/events/${eventId}`);
  assert.equal(seen.body.data.review.termsAccepted, true, 'a reload must show the acceptance');

  const { data: row } = await supabase
    .from('events').select('status, terms_accepted_id').eq('id', eventId).single();
  assert.equal(row.terms_accepted_id, accept.body.data.termsId);
  assert.equal(row.status, 'draft');

  const { data: ledger } = await supabase
    .from('terms_acceptances').select('id').eq('event_id', eventId).eq('terms_id', accept.body.data.termsId);
  assert.equal(ledger.length, 1, 'the acceptance itself is still recorded');

  // A double click lands on the same record.
  const again = await organizer('POST', `/events/${eventId}/accept-terms`);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const { data: ledgerAfter } = await supabase
    .from('terms_acceptances').select('id').eq('event_id', eventId).eq('terms_id', accept.body.data.termsId);
  assert.equal(ledgerAfter.length, 1);
});

test('accepting the terms then submitting moves it to review', async () => {
  const res = await organizer('POST', `/events/${eventId}/submit`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'pending_review');
  assert.equal(res.body.data.review.termsAccepted, true);

  // Past the terms step: there is nothing left to accept.
  const late = await organizer('POST', `/events/${eventId}/accept-terms`);
  assert.equal(late.status, 409, JSON.stringify(late.body));
});

test('editing an event under review withdraws it, and it has to be resubmitted', async () => {
  // BRD §16. Edits used to land on an event in the queue, so the reviewer
  // approved content they had never seen.
  const edit = await organizer('PATCH', `/events/${eventId}`, { description: 'Added after submitting.' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.data.status, 'draft');
  assert.equal(edit.body.meta.returnedToDraft, true);

  const again = await organizer('POST', `/events/${eventId}/submit`);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.data.status, 'pending_review');
});

test('the event is not public until an admin approves it', async () => {
  const { data } = await supabase.from('events').select('status').eq('id', eventId).single();
  assert.equal(data.status, 'pending_review', 'an organizer must not be able to publish');
});

test('an organizer cannot reach the approval queue', async () => {
  const res = await organizer('GET', '/admin/approvals');
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'FORBIDDEN');
});

test('rejection requires a reason, and the organizer sees it', async () => {
  const noReason = await admin('POST', `/admin/events/${eventId}/reject`, { reason: 'too short' });
  assert.equal(noReason.status, 400, 'a one-word rejection helps nobody');

  const res = await admin('POST', `/admin/events/${eventId}/reject`, {
    reason: 'The venue address is missing. Please add it and resubmit.',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'rejected');

  const seen = await organizer('GET', `/events/${eventId}`);
  assert.match(seen.body.data.review.rejectionReason, /venue address/i);
});

test('a rejected event can be fixed and resubmitted', async () => {
  // Asserted, not just performed. An earlier version of this test ignored the
  // PATCH result and passed while the edit was silently returning 403 — the
  // camelCase field names matched nothing in the allowlist.
  const fix = await organizer('PATCH', `/events/${eventId}`, {
    venueAddress: '123 Test Street, Toronto',
  });
  assert.equal(fix.status, 200, JSON.stringify(fix.body));
  assert.equal(fix.body.data.venue.address, '123 Test Street, Toronto');

  const res = await organizer('POST', `/events/${eventId}/submit`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'pending_review');
  assert.equal(res.body.data.review.rejectionReason, null, 'the old verdict must clear');
});

test('approval publishes it, and a second approval is refused', async () => {
  const res = await admin('POST', `/admin/events/${eventId}/approve`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'published');

  const again = await admin('POST', `/admin/events/${eventId}/approve`);
  assert.equal(again.status, 409, 'two reviewers must not both publish');
});

test('a live event takes a description change, but not a new date', async () => {
  const note = await organizer('PATCH', `/events/${eventId}`, { description: 'Doors open at 7pm.' });
  assert.equal(note.status, 200, JSON.stringify(note.body));
  assert.equal(note.body.data.status, 'published', 'an operational change keeps it on sale');

  const moved = await organizer('PATCH', `/events/${eventId}`, {
    startsAt: new Date(Date.now() + 60 * 86400e3).toISOString(),
  });
  assert.equal(moved.status, 409, JSON.stringify(moved.body));
  assert.deepEqual(moved.body.meta.lockedFields, ['startsAt']);

  const { data } = await supabase.from('events').select('status, starts_at').eq('id', eventId).single();
  assert.equal(data.status, 'published');
});

// ── BRD §17 — who may cancel, and who may suspend ───────────────────────────

test('an admin suspends; the event stays, hidden', async () => {
  const res = await admin('POST', `/admin/events/${eventId}/suspend`, {
    reason: 'Reported for review by the trust team.',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'suspended');

  await admin('POST', `/admin/events/${eventId}/unsuspend`);
});

test('the organizer cannot cancel their own event (BRD §17)', async () => {
  const res = await organizer('POST', `/events/${eventId}/cancel`, {
    reason: 'The venue double-booked us.',
  });
  assert.notEqual(res.status, 200, 'there must be no organizer path to cancellation');

  const viaAdminRoute = await organizer('POST', `/admin/events/${eventId}/cancel`, {
    reason: 'The venue double-booked us.',
  });
  assert.equal(viaAdminRoute.status, 403);

  const { data } = await supabase.from('events').select('status').eq('id', eventId).single();
  assert.equal(data.status, 'published', 'the refused attempts must change nothing');
});

test('an admin cancel needs a real reason', async () => {
  const res = await admin('POST', `/admin/events/${eventId}/cancel`, { reason: 'no' });
  assert.equal(res.status, 400);
});

test('the admin cancels, and nothing is deleted', async () => {
  const res = await admin('POST', `/admin/events/${eventId}/cancel`, {
    reason: 'The venue double-booked the organizer.',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'cancelled');
  assert.match(res.body.data.cancelledReason, /double-booked/);

  const { data: trail } = await supabase
    .from('admin_audit').select('action').eq('target_id', eventId).eq('action', 'event.cancelled');
  assert.equal(trail.length, 1, 'a cancellation must be on the audit trail');

  // The record survives — a buyer must still be able to see what they bought.
  const { data } = await supabase.from('events').select('id, status').eq('id', eventId).single();
  assert.equal(data.status, 'cancelled');

  // And scanning stopped.
  const { data: scan } = await supabase
    .from('scanner_access').select('is_locked, locked_reason').eq('event_id', eventId).single();
  assert.equal(scan.is_locked, true);
  assert.equal(scan.locked_reason, 'event_cancelled');
});

test('a cancelled event cannot be edited or revived', async () => {
  const edit = await organizer('PATCH', `/events/${eventId}`, { title: 'Back From The Dead' });
  assert.equal(edit.status, 409);

  const submit = await organizer('POST', `/events/${eventId}/submit`);
  assert.equal(submit.status, 409, 'cancelled is terminal');
});

test('one organizer cannot see another organizer\'s event', async () => {
  const stranger = client();
  const s = await stranger('POST', '/auth/register', {
    email: `stranger-${stamp}@eventsli-test.invalid`, password: PASSWORD, fullName: 'A Stranger',
  });
  cleanup.profiles.push(s.body.data.id);
  await supabase.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', s.body.data.id);
  await stranger('POST', '/auth/login', { email: `stranger-${stamp}@eventsli-test.invalid`, password: PASSWORD });
  const so = await stranger('POST', '/organizer', { displayName: 'Other Co', country: 'US' });
  cleanup.organizers.push(so.body.data.id);

  const res = await stranger('GET', `/events/${eventId}`);
  // 404, not 403: a 403 would confirm the id is real and invite enumeration.
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'EVENT_NOT_FOUND');
});
