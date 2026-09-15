const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Sets DISABLE_RATE_LIMIT before the app builds its limiters. Must come first.
require('../helpers/testEnv');

const { supabase } = require('../../config/supabase');
const promo = require('../../services/promoService');
const pricing = require('../../services/pricingService');

/**
 * Promo codes.
 *
 * `promo_codes` shipped in the baseline with a `used_count` column and nothing
 * to increment it. The interesting property is not that a discount applies —
 * it is that a code with ten uses cannot be used eleven times, including when
 * eleven people are at the checkout screen at once.
 */

const stamp = Date.now();
const ids = {};
let seatIds = [];

before(async () => {
  const { data: profile } = await supabase.from('profiles').insert({
    email: `promo-${stamp}@eventsli-test.invalid`, full_name: 'Promo Test', role: 'organizer',
  }).select('id').single();
  ids.profile = profile.id;

  const { data: org } = await supabase.from('organizers').insert({
    owner_user_id: profile.id, display_name: 'Promo Co', country: 'CA',
  }).select('id').single();
  ids.organizer = org.id;

  const { data: terms } = await supabase.from('terms_versions')
    .select('id').eq('audience', 'organizer').eq('is_current', true).single();
  await supabase.from('terms_acceptances').insert({ user_id: profile.id, terms_id: terms.id });

  const { data: ev, error } = await supabase.from('events').insert({
    organizer_id: org.id, slug: `promo-${stamp}`, title: 'Promo Test',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 25 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 25 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'published', terms_accepted_id: terms.id,
    purchase_mode: 'seat_only', commission_pct: 1.5, event_tax_pct: 13,
    max_tickets_per_order: 10,
  }).select('id').single();
  if (error) throw new Error(`seed: ${error.message}`);
  ids.event = ev.id;

  const { data: map } = await supabase.from('venue_maps')
    .insert({ event_id: ev.id, layout_json: {} }).select('id').single();
  ids.map = map.id;
  const { data: tier } = await supabase.from('ticket_tiers')
    .insert({ event_id: ev.id, name: 'GA', price_cents: 10000 }).select('id').single();

  const { data: s } = await supabase.from('seats').insert(
    Array.from({ length: 20 }, (_, i) => ({
      venue_map_id: map.id, tier_id: tier.id,
      section_key: 'Floor', row_label: 'A', seat_number: String(i + 1),
    })),
  ).select('id');
  seatIds = s.map((r) => r.id);
});

after(async () => {
  if (ids.event) {
    const { data: rs } = await supabase.from('reservations').select('id').eq('event_id', ids.event);
    for (const r of rs || []) {
      await supabase.from('promo_redemptions').delete().eq('reservation_id', r.id);
    }
    const { data: orders } = await supabase.from('orders').select('id').eq('event_id', ids.event);
    for (const o of orders || []) {
      await supabase.from('tickets').delete().eq('order_id', o.id);
      await supabase.from('order_items').delete().eq('order_id', o.id);
    }
    await supabase.from('orders').delete().eq('event_id', ids.event);
    for (const r of rs || []) {
      await supabase.from('reservation_items').delete().eq('reservation_id', r.id);
    }
    await supabase.from('reservations').delete().eq('event_id', ids.event);
    await supabase.from('promo_codes').delete().eq('event_id', ids.event);
    await supabase.from('seats').delete().eq('venue_map_id', ids.map);
    await supabase.from('venue_maps').delete().eq('event_id', ids.event);
    await supabase.from('ticket_tiers').delete().eq('event_id', ids.event);
    await supabase.from('events').delete().eq('id', ids.event);
  }
  if (ids.organizer) await supabase.from('organizers').delete().eq('id', ids.organizer);
  if (ids.profile) {
    await supabase.from('terms_acceptances').delete().eq('user_id', ids.profile);
    await supabase.from('profiles').delete().eq('id', ids.profile);
  }
});

const hold = async (seats) => {
  const { data } = await supabase.rpc('hold_seats', {
    p_event_id: ids.event, p_user_id: null, p_seat_ids: seats, p_ttl_minutes: 35,
  });
  return data;
};

// ── The discount ────────────────────────────────────────────────────────────

test('a percentage code reduces the subtotal, and the tax with it', async () => {
  await promo.create({
    eventId: ids.event, code: 'half', discountType: 'percentage', discountValue: 50,
  });

  const h = await hold([seatIds[0], seatIds[1]]);
  const before = await pricing.quoteReservation(h.reservation_id);
  assert.equal(before.breakdown.subtotalCents, 20000);
  assert.equal(before.breakdown.eventTaxCents, 2600);

  await promo.claim({
    code: 'HALF', eventId: ids.event, reservationId: h.reservation_id, subtotalCents: 20000,
  });

  const after_ = await pricing.quoteReservation(h.reservation_id);
  assert.equal(after_.breakdown.discountCents, 10000);
  assert.equal(after_.breakdown.subtotalCents, 10000);
  // Tax follows the discounted amount — a buyer does not owe tax on money they
  // did not pay, and neither does the organizer.
  assert.equal(after_.breakdown.eventTaxCents, 1300);
  assert.equal(after_.breakdown.commissionCents, 150, 'commission drops with it too');

  await promo.release(h.reservation_id);
  await supabase.rpc('release_reservation', { p_reservation_id: h.reservation_id });
});

test('a code is matched case-insensitively', async () => {
  const h = await hold([seatIds[2]]);
  // Stored upper-case, compared upper-case. A buyer typing `half` and one
  // typing `HALF` are using the same code.
  const claimed = await promo.claim({
    code: '  hAlF  ', eventId: ids.event, reservationId: h.reservation_id, subtotalCents: 10000,
  });
  assert.equal(claimed.code, 'HALF');

  await promo.release(h.reservation_id);
  await supabase.rpc('release_reservation', { p_reservation_id: h.reservation_id });
});

test('a fixed discount never exceeds the order', async () => {
  await promo.create({
    eventId: ids.event, code: 'BIG', discountType: 'fixed', discountValue: 500,
  });

  const h = await hold([seatIds[3]]);   // a $100 seat
  const claimed = await promo.claim({
    code: 'BIG', eventId: ids.event, reservationId: h.reservation_id, subtotalCents: 10000,
  });

  // A $500 discount on a $100 order must not produce a negative total — a
  // negative charge is a refund nobody authorised.
  assert.equal(claimed.discount_cents, 10000);

  const q = await pricing.quoteReservation(h.reservation_id);
  assert.equal(q.breakdown.subtotalCents, 0);
  assert.equal(q.breakdown.buyerTotalCents, 0);
  // Free means free: no commission, no fee, and it never reaches Stripe.
  assert.equal(q.breakdown.applicationFeeCents, 0);

  await promo.release(h.reservation_id);
  await supabase.rpc('release_reservation', { p_reservation_id: h.reservation_id });
});

// ── The limit ───────────────────────────────────────────────────────────────

test('a code with two uses cannot be used three times', async () => {
  await promo.create({
    eventId: ids.event, code: 'TWICE', discountType: 'percentage', discountValue: 10, maxUses: 2,
  });

  const holds = [await hold([seatIds[4]]), await hold([seatIds[5]]), await hold([seatIds[6]])];

  await promo.claim({ code: 'TWICE', eventId: ids.event, reservationId: holds[0].reservation_id, subtotalCents: 10000 });
  await promo.claim({ code: 'TWICE', eventId: ids.event, reservationId: holds[1].reservation_id, subtotalCents: 10000 });

  await assert.rejects(
    () => promo.claim({ code: 'TWICE', eventId: ids.event, reservationId: holds[2].reservation_id, subtotalCents: 10000 }),
    (e) => e.code === 'CONFLICT',
  );

  for (const h of holds) {
    await promo.release(h.reservation_id);
    await supabase.rpc('release_reservation', { p_reservation_id: h.reservation_id });
  }
});

test('five buyers racing the last use — exactly one wins', async () => {
  // The property the whole design exists for. `used_count = used_count + 1`
  // from application code lets two checkouts both read 0 of 1 and both write 1.
  await promo.create({
    eventId: ids.event, code: 'ONLYONE', discountType: 'percentage', discountValue: 20, maxUses: 1,
  });

  const holds = await Promise.all(
    [7, 8, 9, 10, 11].map((i) => hold([seatIds[i]])),
  );

  const results = await Promise.allSettled(holds.map((h) => promo.claim({
    code: 'ONLYONE', eventId: ids.event, reservationId: h.reservation_id, subtotalCents: 10000,
  })));

  const won = results.filter((r) => r.status === 'fulfilled');
  assert.equal(won.length, 1, `expected exactly 1 claim, got ${won.length}`);

  const { count } = await supabase
    .from('promo_redemptions').select('id', { count: 'exact', head: true })
    .eq('promo_id', won[0].value.promo_id);
  assert.equal(count, 1);

  for (const h of holds) {
    await promo.release(h.reservation_id);
    await supabase.rpc('release_reservation', { p_reservation_id: h.reservation_id });
  }
});

test('releasing a hold gives the use back', async () => {
  await promo.create({
    eventId: ids.event, code: 'RECYCLE', discountType: 'percentage', discountValue: 10, maxUses: 1,
  });

  const first = await hold([seatIds[12]]);
  await promo.claim({ code: 'RECYCLE', eventId: ids.event, reservationId: first.reservation_id, subtotalCents: 10000 });

  // Abandoned. Without releasing the claim a limited code leaks one use per
  // abandoned checkout, and the leak is invisible until it runs out early.
  await promo.release(first.reservation_id);
  await supabase.rpc('release_reservation', { p_reservation_id: first.reservation_id });

  const second = await hold([seatIds[13]]);
  const claimed = await promo.claim({
    code: 'RECYCLE', eventId: ids.event, reservationId: second.reservation_id, subtotalCents: 10000,
  });
  assert.ok(claimed.ok);

  await promo.release(second.reservation_id);
  await supabase.rpc('release_reservation', { p_reservation_id: second.reservation_id });
});

test('re-applying to the same hold does not consume a second use', async () => {
  await promo.create({
    eventId: ids.event, code: 'REFRESH', discountType: 'percentage', discountValue: 10, maxUses: 1,
  });

  const h = await hold([seatIds[14]]);
  await promo.claim({ code: 'REFRESH', eventId: ids.event, reservationId: h.reservation_id, subtotalCents: 10000 });
  // A buyer refreshing the checkout page must not burn the code.
  await promo.claim({ code: 'REFRESH', eventId: ids.event, reservationId: h.reservation_id, subtotalCents: 10000 });

  const { count } = await supabase
    .from('promo_redemptions').select('id', { count: 'exact', head: true })
    .eq('reservation_id', h.reservation_id);
  assert.equal(count, 1);

  await promo.release(h.reservation_id);
  await supabase.rpc('release_reservation', { p_reservation_id: h.reservation_id });
});

// ── What must not apply ─────────────────────────────────────────────────────

test('an unknown and a disabled code are refused identically', async () => {
  const created = await promo.create({
    eventId: ids.event, code: 'OFF', discountType: 'percentage', discountValue: 10,
  });
  await promo.setActive({ promoId: created.id, eventId: ids.event, isActive: false });

  const h = await hold([seatIds[15]]);

  const disabled = await promo.claim({
    code: 'OFF', eventId: ids.event, reservationId: h.reservation_id, subtotalCents: 10000,
  }).catch((e) => e);
  const missing = await promo.claim({
    code: 'NOSUCHCODE', eventId: ids.event, reservationId: h.reservation_id, subtotalCents: 10000,
  }).catch((e) => e);

  // Telling them apart lets someone map which codes exist by trying strings.
  assert.equal(disabled.message, missing.message);

  await supabase.rpc('release_reservation', { p_reservation_id: h.reservation_id });
});

test('an expired code is refused', async () => {
  const created = await promo.create({
    eventId: ids.event, code: 'PAST', discountType: 'percentage', discountValue: 10,
  });
  await supabase.from('promo_codes')
    .update({ valid_until: new Date(Date.now() - 86400e3).toISOString() })
    .eq('id', created.id);

  const h = await hold([seatIds[16]]);
  await assert.rejects(
    () => promo.claim({ code: 'PAST', eventId: ids.event, reservationId: h.reservation_id, subtotalCents: 10000 }),
    (e) => e.code === 'NOT_FOUND',
  );
  await supabase.rpc('release_reservation', { p_reservation_id: h.reservation_id });
});

test('a code for another event does not apply here', async () => {
  const { data: other } = await supabase.from('events').insert({
    organizer_id: ids.organizer, slug: `promo-other-${stamp}`, title: 'Other',
    country: 'CA', timezone: 'America/Toronto',
    starts_at: new Date(Date.now() + 50 * 86400e3).toISOString(),
    ends_at: new Date(Date.now() + 50 * 86400e3 + 3600e3).toISOString(),
    currency: 'CAD', status: 'draft',
  }).select('id').single();

  await supabase.from('promo_codes').insert({
    event_id: other.id, code: 'ELSEWHERE', discount_type: 'percentage', discount_value: 50,
  });

  const h = await hold([seatIds[17]]);
  await assert.rejects(
    () => promo.claim({ code: 'ELSEWHERE', eventId: ids.event, reservationId: h.reservation_id, subtotalCents: 10000 }),
    (e) => e.code === 'NOT_FOUND',
  );

  await supabase.rpc('release_reservation', { p_reservation_id: h.reservation_id });
  await supabase.from('promo_codes').delete().eq('event_id', other.id);
  await supabase.from('events').delete().eq('id', other.id);
});

test('a percentage over 100 is refused at creation', async () => {
  await assert.rejects(
    () => promo.create({ eventId: ids.event, code: 'ABSURD', discountType: 'percentage', discountValue: 150 }),
    (e) => e.code === 'VALIDATION_ERROR',
  );
});

test('a duplicate code for one event is refused', async () => {
  await promo.create({ eventId: ids.event, code: 'UNIQUE1', discountType: 'fixed', discountValue: 5 });
  await assert.rejects(
    () => promo.create({ eventId: ids.event, code: 'unique1', discountType: 'fixed', discountValue: 5 }),
    (e) => e.code === 'CONFLICT',
  );
});

// ── A use follows its hold ──────────────────────────────────────────────────

test('a hold that lapses gives its use back when the sweeper runs', async () => {
  // The sweeper was written before codes existed and never released a claim,
  // so a limited code wore out on checkouts nobody paid for.
  await promo.create({
    eventId: ids.event, code: 'LAPSED', discountType: 'percentage', discountValue: 10, maxUses: 1,
  });
  const first = await hold([seatIds[18]]);
  await promo.claim({ code: 'LAPSED', eventId: ids.event, reservationId: first.reservation_id, subtotalCents: 10000 });

  await supabase.from('reservations')
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', first.reservation_id);
  await supabase.rpc('expire_stale_reservations');

  const { count } = await supabase.from('promo_redemptions')
    .select('id', { count: 'exact', head: true }).eq('reservation_id', first.reservation_id);
  assert.equal(count, 0, 'the lapsed claim is gone');

  const second = await hold([seatIds[19]]);
  const claimed = await promo.claim({
    code: 'LAPSED', eventId: ids.event, reservationId: second.reservation_id, subtotalCents: 10000,
  });
  assert.ok(claimed.ok, 'and the single use is available again');

  await promo.release(second.reservation_id);
  await supabase.rpc('release_reservation', { p_reservation_id: second.reservation_id });
});

test('a hold past its expiry does not keep a use while it waits for the sweeper', async () => {
  await promo.create({
    eventId: ids.event, code: 'WAITING', discountType: 'percentage', discountValue: 10, maxUses: 1,
  });
  const lapsed = await hold([seatIds[18]]);
  await promo.claim({ code: 'WAITING', eventId: ids.event, reservationId: lapsed.reservation_id, subtotalCents: 10000 });
  await supabase.from('reservations')
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', lapsed.reservation_id);

  const live = await hold([seatIds[19]]);
  const claimed = await promo.claim({
    code: 'WAITING', eventId: ids.event, reservationId: live.reservation_id, subtotalCents: 10000,
  });
  assert.ok(claimed.ok, 'an expired hold is not somebody using the code');

  for (const h of [lapsed, live]) {
    await promo.release(h.reservation_id);
    await supabase.rpc('release_reservation', { p_reservation_id: h.reservation_id });
  }
});

test('a code paid with is recorded on the order and cannot be freed again', async () => {
  await promo.create({
    eventId: ids.event, code: 'PAIDFOR', discountType: 'percentage', discountValue: 10, maxUses: 1,
  });
  const h = await hold([seatIds[18]]);
  await promo.claim({ code: 'PAIDFOR', eventId: ids.event, reservationId: h.reservation_id, subtotalCents: 10000 });
  const q = await pricing.quoteReservation(h.reservation_id);

  const paid = await supabase.rpc('fulfill_checkout', {
    p_reservation_id: h.reservation_id, p_channel: 'stripe', p_breakdown: q.breakdown,
    p_buyer: { user_id: null, name: 'Code Buyer', email: 'code-buyer@eventsli-test.invalid' },
    p_stripe: { session_id: `cs_promo_${stamp}` },
  });
  assert.equal(paid.data?.ok, true, JSON.stringify(paid.data || paid.error));

  const { data: order } = await supabase.from('orders')
    .select('promo_code').eq('id', paid.data.order_id).single();
  assert.equal(order.promo_code, 'PAIDFOR', 'the receipt can say which code it was bought with');

  const { data: freed } = await supabase.rpc('release_promo_claim', { p_reservation_id: h.reservation_id });
  assert.equal(freed, false, 'a paid claim is part of what was bought');

  const other = await hold([seatIds[19]]);
  await assert.rejects(
    () => promo.claim({ code: 'PAIDFOR', eventId: ids.event, reservationId: other.reservation_id, subtotalCents: 10000 }),
    (e) => e.code === 'CONFLICT',
    'so the single use stays spent',
  );
  await supabase.rpc('release_reservation', { p_reservation_id: other.reservation_id });
});

test('the counter matches the redemptions it is derived from', async () => {
  const list = await promo.list(ids.event);
  for (const p of list) {
    const { count } = await supabase
      .from('promo_redemptions').select('id', { count: 'exact', head: true }).eq('promo_id', p.id);
    assert.equal(p.usedCount, count, `${p.code}: counter says ${p.usedCount}, rows say ${count}`);
  }
});
