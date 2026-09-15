const { supabase } = require('../config/supabase');
const { parsePagination, applyPagination, buildMeta } = require('../middleware/pagination');
const { sendOk } = require('../utils/responseEnvelope');
const { safeSearch } = require('../utils/search');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What the organizer sold, and who is coming.
 *
 * `GET /events/:id/manual-sales` has always existed — and it filters
 * `channel = 'manual'`, so an organizer could see the cash they took at the
 * door and NOTHING about the tickets sold online. No order list, no door list,
 * no way to answer "did the Smiths' booking go through". For a platform whose
 * whole point is selling online, that was the gap an organizer hit first.
 *
 * Two views, because they answer two different questions:
 *
 *   /orders     one row per TRANSACTION — money. What was charged, to whom,
 *               through which channel, and what the organizer nets after our
 *               commission.
 *   /attendees  one row per TICKET — people. Who is arriving, where they sit,
 *               and whether they have walked in yet. This is the door list.
 *
 * An order of six tickets is one row in the first and six in the second. They
 * are not two shapes of the same list, and collapsing them into one endpoint
 * with a flag would make both worse.
 *
 * WHAT IS DELIBERATELY NOT HERE: the payment fee, and anything Stripe-side. The
 * fee may be borne by the buyer or by the organizer (BRD §06) and the organizer
 * does not need to reconcile our cost of collection — `organizer_net_cents` is
 * the number that is theirs, and it is snapshotted per order so a later rate
 * change never rewrites history.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// The FK is named explicitly because `orders` references `profiles` TWICE —
// `user_id` (who bought it) and `recorded_by` (which member of staff rang up a
// door sale). An unhinted embed is ambiguous and PostgREST refuses the whole
// query: "more than one relationship was found". Worse, if it ever resolved to
// `recorded_by` it would silently label every manual sale with the name of the
// person who took the cash instead of the person who paid it.
const ORDER_SELECT = `
  id, channel, status, currency, quantity,
  subtotal_cents, discount_cents, event_tax_cents,
  commission_cents, commission_tax_cents, buyer_total_cents, organizer_net_cents,
  guest_name, guest_email, manual_method, manual_note,
  created_at, paid_at,
  profiles!orders_user_id_fkey ( full_name, email )
`;

// ─── GET /events/:eventId/orders ────────────────────────────────────────────
/**
 * Every order on the event, both channels, newest first.
 *
 * `?channel=` and `?status=` narrow it; `?q=` matches the buyer. Defaults to
 * paid orders only — an abandoned checkout leaves a `pending` row behind, and a
 * sales list padded with carts nobody completed misstates the takings.
 */
async function orders(req, res, next) {
  try {
    const p = parsePagination(req, {
      sortable: ['created_at', 'paid_at', 'buyer_total_cents'], defaultSort: 'created_at',
    });

    let query = supabase
      .from('orders')
      .select(ORDER_SELECT, { count: 'exact' })
      .eq('event_id', req.params.eventId);

    // `status=all` is the explicit way to see the abandoned ones.
    const status = String(req.query.status || 'paid');
    if (status !== 'all') query = query.eq('status', status);
    if (req.query.channel) query = query.eq('channel', req.query.channel);

    if (p.q) {
      // Escaped: a comma or a parenthesis reaches PostgREST as `or()` syntax
      // rather than as text being searched for.
      const safe = safeSearch(p.q);
      if (safe) {
        // A signed-in buyer's row shows their ACCOUNT name and email, which the
        // guest columns do not hold — so searching only those found nothing for
        // a name that was right there on the screen. Matching accounts are
        // looked up first and included by id.
        const { data: people } = await supabase
          .from('profiles').select('id')
          .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`)
          .limit(200);
        const accountIds = (people || []).map((row) => row.id);
        const clauses = [`guest_name.ilike.%${safe}%`, `guest_email.ilike.%${safe}%`];
        if (accountIds.length) clauses.push(`user_id.in.(${accountIds.join(',')})`);
        query = query.or(clauses.join(','));
      }
    }

    const { data, error, count } = await applyPagination(query, p);
    if (error) throw new Error(error.message);

    const rows = (data || []).map(shapeOrder);

    return sendOk(res, rows, {
      pagination: buildMeta(p, count),
      // Totals for the WHOLE filtered set, not for this page. A footer that sums
      // the twenty-five rows on screen and calls it revenue is worse than no
      // footer, because it looks like an answer.
      meta: await totals(req.params.eventId, status, req.query.channel),
    });
  } catch (err) { return next(err); }
}

// ─── GET /events/:eventId/attendees ─────────────────────────────────────────
/**
 * The door list. One row per ticket, with its seat and whether it has scanned.
 *
 * The QR is NOT included. This endpoint exists so an organizer can see who is
 * coming; putting the admission credential for every ticket into a paginated
 * list an organizer can screenshot would make it a bearer token for the whole
 * event. Scanning is the gate's job and the gate has its own device auth.
 */
async function attendees(req, res, next) {
  try {
    const p = parsePagination(req, {
      sortable: ['created_at', 'attendee_name'], defaultSort: 'created_at',
    });

    let query = supabase
      .from('tickets')
      .select(`
        id, attendee_name, attendee_email, status, scanned_at, created_at,
        transfer_count, transferred_from,
        seats ( section_key, row_label, seat_number ),
        tables ( label ),
        ticket_tiers ( name ),
        orders!inner ( id, channel, status, guest_name, guest_email )
      `, { count: 'exact' })
      .eq('event_id', req.params.eventId)
      .eq('orders.status', 'paid');

    if (req.query.status) query = query.eq('status', req.query.status);
    // `?checkedIn=true|false` — the two questions actually asked at a door.
    if (req.query.checkedIn === 'true') query = query.not('scanned_at', 'is', null);
    if (req.query.checkedIn === 'false') query = query.is('scanned_at', null);

    if (p.q) {
      const safe = safeSearch(p.q);
      if (safe) query = query.or(`attendee_name.ilike.%${safe}%,attendee_email.ilike.%${safe}%`);
    }

    const { data, error, count } = await applyPagination(query, p);
    if (error) throw new Error(error.message);

    const [{ count: admitted }, { count: issued }] = await Promise.all([
      supabase.from('tickets').select('id', { count: 'exact', head: true })
        .eq('event_id', req.params.eventId).not('scanned_at', 'is', null),
      supabase.from('tickets').select('id', { count: 'exact', head: true })
        .eq('event_id', req.params.eventId).eq('status', 'valid'),
    ]);

    return sendOk(res, (data || []).map(shapeAttendee), {
      pagination: buildMeta(p, count),
      meta: { admitted: Number(admitted) || 0, valid: Number(issued) || 0 },
    });
  } catch (err) { return next(err); }
}

/**
 * Summed over every matching row, IN the database, not over the page.
 *
 * This used to select the amount columns of every matching order and add them
 * up here, with the query's error ignored — so past PostgREST's row cap the
 * totals were silently low, and a failed read showed zero sales. Grouped by
 * currency: summing across currencies would be a number that is simply wrong.
 * Net is what the organizer keeps, door sales included (see the migration).
 */
async function totals(eventId, status, channel) {
  const { data, error } = await supabase.rpc('event_order_totals', {
    p_event_id: eventId, p_status: status, p_channel: channel || null,
  });
  if (error) throw new Error(error.message);
  return data || { totals: {}, byChannel: { stripe: 0, manual: 0 } };
}

function shapeOrder(o) {
  const account = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
  return {
    id: o.id,
    channel: o.channel,
    status: o.status,
    currency: o.currency,
    tickets: Number(o.quantity),
    buyer: {
      // The account's details win when there is one: a signed-in buyer's
      // profile is current, while the guest fields are whatever was typed at
      // one checkout and are never updated afterwards.
      name: account?.full_name || o.guest_name || null,
      email: account?.email || o.guest_email || null,
      hasAccount: !!account,
    },
    subtotalCents: Number(o.subtotal_cents),
    discountCents: Number(o.discount_cents),
    taxCents: Number(o.event_tax_cents),
    buyerPaidCents: Number(o.buyer_total_cents),
    commissionCents: Number(o.commission_cents) + Number(o.commission_tax_cents),
    // What the organizer keeps. On the card path Stripe has already taken our
    // commission off. On the manual path they collected the whole amount and
    // owe us the commission, so it comes off here — the same figure the totals
    // and the dashboards use, rather than the gross the row used to show.
    organizerNetCents: Number(o.organizer_net_cents)
      - (o.channel === 'manual' ? Number(o.commission_cents) + Number(o.commission_tax_cents) : 0),
    manual: o.channel === 'manual' ? { method: o.manual_method, note: o.manual_note } : null,
    createdAt: o.created_at,
    paidAt: o.paid_at,
  };
}

function shapeAttendee(t) {
  const seat = Array.isArray(t.seats) ? t.seats[0] : t.seats;
  const table = Array.isArray(t.tables) ? t.tables[0] : t.tables;
  const tier = Array.isArray(t.ticket_tiers) ? t.ticket_tiers[0] : t.ticket_tiers;
  const order = Array.isArray(t.orders) ? t.orders[0] : t.orders;

  return {
    ticketId: t.id,
    orderId: order?.id || null,
    channel: order?.channel || null,
    // Falls back to the buyer: most tickets are bought for the buyer themselves
    // and carry no separate attendee name, and a door list of blanks is useless.
    name: t.attendee_name || order?.guest_name || null,
    email: t.attendee_email || order?.guest_email || null,
    seat: seat ? `${seat.section_key} ${seat.row_label}${seat.seat_number}` : null,
    table: table?.label || null,
    tier: tier?.name || null,
    status: t.status,
    checkedIn: !!t.scanned_at,
    checkedInAt: t.scanned_at,
    // BRD §10 — one transfer, ever. Shown so the door can see the name on the
    // ticket is not the name that bought it, before the guest has to explain.
    transferred: t.transfer_count > 0 ? { from: t.transferred_from } : null,
  };
}

module.exports = { orders, attendees };
