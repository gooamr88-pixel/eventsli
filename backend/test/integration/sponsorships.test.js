const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const app = require('../../app');
const sessions = require('../../services/sessionService');
const portal = require('../../services/sponsorPortalService');

/**
 * Sponsorships (2026-11-20), against the real database:
 *
 *   · the public page exists only while the organizer has it open;
 *   · an inquiry becomes a lead, once per address;
 *   · a proposal's payments must add up to its amount exactly;
 *   · only the contact (or the company) can see, sign and pay a deal;
 *   · a package never sells past its quantity — enforced at signing;
 *   · nothing is paid before it is signed; a payment is recorded once;
 *   · fully paid → the sponsor is on the event page; cancelled → gone again;
 *   · a card payment counts only for the session and account we recorded.
 */

const stamp = Date.now();
const ACCOUNT = `acct_test_sponsor_${stamp}`;
const ids = { profiles: [], organizer: null, otherOrganizer: null, event: null, otherEvent: null };
const tokens = {};
let server; let base; let slug;

async function call(method, path, body, token) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function person(label, role = 'attendee') {
  const email = `sponsor-${label}-${stamp}@eventsli-test.invalid`;
  const { data, error } = await supabase.from('profiles').insert({
    email, full_name: `Test ${label}`, role, email_verified_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(`seed ${label}: ${error.message}`);
  ids.profiles.push(data.id);
  const { token } = await sessions.issue(null, { userId: data.id, email, role, cookie: false });
  return { id: data.id, email, token };
}

async function eventFor(organizerId, label) {
  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  const { data, error } = await supabase.from('events').insert({
    organizer_id: organizerId, slug: `sponsor-${label}-${stamp}`, title: `Sponsor ${label}`,
    country: 'CA', timezone: 'America/Toronto', city: 'Toronto',
    starts_at: new Date(Date.now() + 40 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 40 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    admission_type: 'general', purchase_mode: 'seat_only', max_tickets_per_order: 10,
  }).select('id, slug').single();
  if (error) throw new Error(`seed event: ${error.message}`);
  return data;
}

const O = (path) => `/events/${ids.event}/sponsorship${path}`;
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString();
const TYPED = { method: 'typed', name: 'Mona Adel' };

before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  const owner = await person('owner', 'organizer');
  tokens.owner = owner.token;
  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: owner.id, display_name: 'Sponsor Org', country: 'CA', stripe_account_id: ACCOUNT,
  }).select('id').single();
  ids.organizer = org.id;
  const ev = await eventFor(org.id, 'main');
  ids.event = ev.id;
  slug = ev.slug;

  const rival = await person('rival', 'organizer');
  tokens.rival = rival.token;
  const { data: org2 } = await supabase.from('organizers').insert({
    owner_user_id: rival.id, display_name: 'Rival Org', country: 'CA',
  }).select('id').single();
  ids.otherOrganizer = org2.id;
  ids.otherEvent = (await eventFor(org2.id, 'rival')).id;

  const brand = await person('brand');
  tokens.brand = brand.token;
  ids.brandEmail = brand.email;
  const second = await person('second');
  tokens.second = second.token;
  ids.secondEmail = second.email;
  tokens.stranger = (await person('stranger')).token;
});

after(async () => {
  for (const eventId of [ids.event, ids.otherEvent].filter(Boolean)) {
    await supabase.from('sponsorship_deals').delete().eq('event_id', eventId);
    await supabase.from('sponsorship_packages').delete().eq('event_id', eventId);
    await supabase.from('sponsorship_programs').delete().eq('event_id', eventId);
    await supabase.from('event_sponsors').delete().eq('event_id', eventId);
    await supabase.from('events').delete().eq('id', eventId);
  }
  await supabase.from('partner_companies').delete().in('created_by', ids.profiles);
  for (const id of [ids.organizer, ids.otherOrganizer].filter(Boolean)) await supabase.from('organizers').delete().eq('id', id);
  await supabase.from('sessions').delete().in('user_id', ids.profiles);
  await supabase.from('profiles').delete().in('id', ids.profiles);
  await new Promise((r) => server.close(r));
});

let headline; let gold; let leadId;

test('the public page exists only while the organizer has it open', async () => {
  const closed = await call('GET', `/public/events/${slug}/sponsorship`);
  assert.equal(closed.status, 404);

  const saved = await call('PUT', O('/program'), {
    isOpen: true, headline: 'Partner with us', intro: 'Reach 5,000 fans.',
    defaultTerms: 'The sponsor pays the amount; the organizer delivers the benefits.',
    paymentInstructions: 'Bank transfer to Sponsor Org, account 123.',
  }, tokens.owner);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.isOpen, true);

  const h = await call('POST', O('/packages'), {
    name: 'Headline', level: 'headline', priceCents: 1000000, quantity: 1,
    benefits: ['Logo on every ticket', '  ', 'Stage mention'],
  }, tokens.owner);
  assert.equal(h.status, 201, JSON.stringify(h.body));
  assert.deepEqual(h.body.data.benefits, ['Logo on every ticket', 'Stage mention']);
  headline = h.body.data.id;
  gold = (await call('POST', O('/packages'), { name: 'Gold', level: 'gold', priceCents: 250000 }, tokens.owner)).body.data.id;
  await call('POST', O('/packages'), { name: 'Private', priceCents: 1, isPublic: false }, tokens.owner);

  const open = await call('GET', `/public/events/${slug}/sponsorship`);
  assert.equal(open.status, 200);
  assert.equal(open.body.data.headline, 'Partner with us');
  assert.deepEqual(open.body.data.packages.map((p) => p.name), ['Headline', 'Gold']);
  assert.equal(open.body.data.packages[0].remaining, 1);
});

test('an inquiry becomes a lead, once per address; a honeypot hit is dropped', async () => {
  const body = {
    companyName: 'Acme Drinks', contactName: 'Mona', contactEmail: ids.brandEmail.toUpperCase(),
    website: 'https://acme.example', message: 'We would love the headline slot.', packageId: headline,
  };
  const first = await call('POST', `/public/events/${slug}/sponsorship/inquiries`, body);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const again = await call('POST', `/public/events/${slug}/sponsorship/inquiries`, body);
  assert.equal(again.body.data.duplicate, true);
  const bot = await call('POST', `/public/events/${slug}/sponsorship/inquiries`, { ...body, contactEmail: 'bot@x.invalid', website2: 'spam' });
  assert.equal(bot.status, 201);

  const board = await call('GET', O('/deals'), null, tokens.owner);
  assert.equal(board.status, 200);
  assert.equal(board.body.data.deals.length, 1);
  const lead = board.body.data.deals[0];
  assert.equal(lead.stage, 'lead');
  assert.equal(lead.contactEmail, ids.brandEmail); // stored lower-cased
  assert.equal(lead.amountCents, 1000000);
  leadId = lead.id;
});

test('another organizer cannot reach this pipeline', async () => {
  const res = await call('GET', O('/deals'), null, tokens.rival);
  assert.equal(res.status, 404);
  const deal = await call('GET', O(`/deals/${leadId}`), null, tokens.rival);
  assert.equal(deal.status, 404);
});

test('a proposal\'s payments must add up to its amount exactly', async () => {
  const bad = await call('POST', O(`/deals/${leadId}/proposal`), {
    packageId: headline, level: 'headline', amountCents: 1000000, terms: 'Terms.',
    installments: [{ label: 'Deposit', amountCents: 500000, dueAt: day(1) }, { amountCents: 499999, dueAt: day(20) }],
  }, tokens.owner);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'VALIDATION_ERROR');

  const good = await call('POST', O(`/deals/${leadId}/proposal`), {
    packageId: headline, level: 'headline', amountCents: 1000000, terms: 'Terms v1.', expiresAt: day(10),
    benefits: ['Logo on every ticket'],
    installments: [{ label: 'Deposit', amountCents: 500000, dueAt: day(1) }, { amountCents: 500000, dueAt: day(20) }],
  }, tokens.owner);
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.equal(good.body.data.stage, 'proposal');
  assert.deepEqual(good.body.data.installments.map((i) => i.label), ['Deposit', 'Payment 2']);
});

test('only the contact sees the deal; nothing is paid before it is signed', async () => {
  const mine = await call('GET', '/partner/sponsorships', null, tokens.brand);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.data.map((d) => d.id), [leadId]);
  assert.equal(mine.body.data[0].event.title, 'Sponsor main');

  const notMine = await call('GET', `/partner/sponsorships/${leadId}`, null, tokens.stranger);
  assert.equal(notMine.status, 404);
  assert.deepEqual((await call('GET', '/partner/sponsorships', null, tokens.stranger)).body.data, []);

  const view = await call('GET', `/partner/sponsorships/${leadId}`, null, tokens.brand);
  assert.equal(view.body.data.terms, 'Terms v1.');
  assert.equal(view.body.data.notes, undefined, 'organizer notes never reach the sponsor');

  const inst = view.body.data.installments[0];
  const early = await call('POST', O(`/deals/${leadId}/installments/${inst.id}/paid`), { method: 'bank_transfer' }, tokens.owner);
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'SPONSORSHIP_WRONG_STAGE');
});

let secondDeal;

test('a package never sells past its quantity — the second signer is refused', async () => {
  // A second brand is offered the same one-slot headline package.
  const created = await call('POST', O('/deals'), {
    companyName: 'Beta Bank', contactEmail: ids.secondEmail, packageId: headline,
  }, tokens.owner);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  secondDeal = created.body.data.id;
  const sent = await call('POST', O(`/deals/${secondDeal}/proposal`), {
    packageId: headline, level: 'headline', amountCents: 0, terms: 'In kind.', installments: [],
  }, tokens.owner);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));

  const noTick = await call('POST', `/partner/sponsorships/${leadId}/sign`, { signerName: 'Mona Adel', accept: false, signature: TYPED }, tokens.brand);
  assert.equal(noTick.status, 400);
  const noSig = await call('POST', `/partner/sponsorships/${leadId}/sign`, { signerName: 'Mona Adel', accept: true }, tokens.brand);
  assert.equal(noSig.body.error, 'SIGNATURE_REQUIRED');

  const signed = await call('POST', `/partner/sponsorships/${leadId}/sign`, { signerName: 'Mona Adel', accept: true, signature: TYPED }, tokens.brand);
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(signed.body.data.stage, 'signed');
  assert.match(signed.body.data.signatureSvg, /^<svg /);
  assert.equal(signed.body.data.payment.instructions, 'Bank transfer to Sponsor Org, account 123.');

  const twice = await call('POST', `/partner/sponsorships/${leadId}/sign`, { signerName: 'Mona Adel', accept: true, signature: TYPED }, tokens.brand);
  assert.equal(twice.body.error, 'SPONSORSHIP_WRONG_STAGE');

  const late = await call('POST', `/partner/sponsorships/${secondDeal}/sign`, { signerName: 'Bea', accept: true, signature: { method: 'typed', name: 'Bea Banker' } }, tokens.second);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'SPONSORSHIP_SOLD_OUT');

  // The signer became the owner of a company.
  const { data: deal } = await supabase.from('sponsorship_deals').select('company_id').eq('id', leadId).single();
  const { data: member } = await supabase.from('partner_members').select('role').eq('company_id', deal.company_id).single();
  assert.equal(member.role, 'owner');
});

test('a signed contact can no longer change; brand details can', async () => {
  const res = await call('PATCH', O(`/deals/${leadId}`), { companyName: 'Renamed' }, tokens.owner);
  assert.equal(res.status, 409);
  const brand = await call('PATCH', `/partner/sponsorships/${leadId}/brand`, { displayName: 'Acme', linkUrl: 'https://acme.example/fans' }, tokens.brand);
  assert.equal(brand.status, 200, JSON.stringify(brand.body));
  const bad = await call('PATCH', `/partner/sponsorships/${leadId}/brand`, { logoPath: `events/${ids.otherEvent}/sponsor-0123456789abcdef.png` }, tokens.brand);
  assert.equal(bad.status, 400);
});

test('paid in full → on the event page; a payment is recorded once', async () => {
  const deal = (await call('GET', O(`/deals/${leadId}`), null, tokens.owner)).body.data;
  const [first, second] = deal.installments;

  const one = await call('POST', O(`/deals/${leadId}/installments/${first.id}/paid`), { method: 'bank_transfer', reference: 'TX-1' }, tokens.owner);
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.data.status, 'part_paid');
  assert.equal(one.body.data.published, false);

  const again = await call('POST', O(`/deals/${leadId}/installments/${first.id}/paid`), { method: 'cash' }, tokens.owner);
  assert.equal(again.body.error, 'SPONSORSHIP_ALREADY_PAID');

  const two = await call('POST', O(`/deals/${leadId}/installments/${second.id}/paid`), { method: 'cheque' }, tokens.owner);
  assert.equal(two.body.data.status, 'paid');
  assert.equal(two.body.data.published, true);

  const { data: shown } = await supabase.from('event_sponsors').select('name, level, link_url').eq('event_id', ids.event);
  assert.deepEqual(shown, [{ name: 'Acme', level: 'headline', link_url: 'https://acme.example/fans' }]);

  const board = (await call('GET', O('/deals'), null, tokens.owner)).body.data;
  assert.equal(board.totals.paidCents, 1000000);
  assert.equal(board.totals.outstandingCents, 0);
});

test('a card payment counts only for the session and account we recorded', async () => {
  // A fresh signed deal on the Gold package, paid by card.
  const created = (await call('POST', O('/deals'), { companyName: 'Card Co', contactEmail: ids.secondEmail, packageId: gold }, tokens.owner)).body.data;
  await call('POST', O(`/deals/${created.id}/proposal`), {
    packageId: gold, level: 'gold', amountCents: 250000, terms: 'Gold terms.', installments: [{ amountCents: 250000, dueAt: day(5) }],
  }, tokens.owner);
  const signed = await call('POST', `/partner/sponsorships/${created.id}/sign`, { signerName: 'Bea', accept: true, signature: { method: 'typed', name: 'Bea Banker' } }, tokens.second);
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  const inst = signed.body.data.installments[0];
  await supabase.from('sponsorship_installments')
    .update({ pending_session_id: `cs_test_sp_${stamp}`, pending_account_id: ACCOUNT }).eq('id', inst.id);

  const session = (over = {}) => ({
    id: `cs_test_sp_${stamp}`, amount_total: 250000, payment_intent: `pi_test_sp_${stamp}`,
    metadata: { sponsorship_installment_id: inst.id }, ...over,
  });
  assert.equal(portal.isSponsorshipSession(session()), true);

  const wrongAccount = await portal.fulfilFromSession(session(), { account: 'acct_someone_else' });
  assert.equal(wrongAccount.ok, false);
  assert.equal(wrongAccount.permanent, true);
  const wrongSession = await portal.fulfilFromSession(session({ id: 'cs_test_other' }), { account: ACCOUNT });
  assert.equal(wrongSession.ok, false);
  const wrongAmount = await portal.fulfilFromSession(session({ amount_total: 1 }), { account: ACCOUNT });
  assert.equal(wrongAmount.ok, false);

  const paid = await portal.fulfilFromSession(session(), { account: ACCOUNT });
  assert.deepEqual(paid, { ok: true, alreadyPaid: false });
  const redelivered = await portal.fulfilFromSession(session(), { account: ACCOUNT });
  assert.deepEqual(redelivered, { ok: true, alreadyPaid: true });

  const { data: row } = await supabase.from('sponsorship_installments').select('status, method, stripe_session_id').eq('id', inst.id).single();
  assert.deepEqual(row, { status: 'paid', method: 'card', stripe_session_id: `cs_test_sp_${stamp}` });
});

test('cancelling a signed deal takes the sponsor off the page and voids what is unpaid', async () => {
  const closed = await call('POST', O(`/deals/${leadId}/close`), { outcome: 'cancelled', reason: 'Brand withdrew' }, tokens.owner);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.data.stage, 'cancelled');
  assert.equal(closed.body.data.published, false);
  const { data: shown } = await supabase.from('event_sponsors').select('name').eq('event_id', ids.event);
  assert.deepEqual(shown.map((s) => s.name), ['Card Co']);

  // A lost lead can be reopened; a cancelled deal cannot be "lost".
  const lost = await call('POST', O(`/deals/${leadId}/close`), { outcome: 'lost' }, tokens.owner);
  assert.equal(lost.body.error, 'SPONSORSHIP_WRONG_STAGE');
});

test('a package with deals is taken off sale, not deleted', async () => {
  const res = await call('DELETE', O(`/packages/${headline}`), null, tokens.owner);
  assert.deepEqual(res.body.data, { removed: false, deactivated: true });
  const page = await call('GET', `/public/events/${slug}/sponsorship`);
  assert.deepEqual(page.body.data.packages.map((p) => p.name), ['Gold']);
});
