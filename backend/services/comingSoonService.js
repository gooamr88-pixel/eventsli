const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "COMING SOON" — the notify-me list, and the email when sales open.
 *
 * A teaser page has a "Notify me" box instead of a Buy button. Each address
 * left there is one row in `event_notify_signups` (20261124090000). When the
 * organizer opens sales — at once, or when an admin approves it — everybody on
 * the list gets ONE email saying tickets are on sale, and that is all the list
 * is ever used for.
 *
 * SENT BY A JOB, NOT BY THE REQUEST. The request that opens sales only kicks
 * the job; the job reads "events on sale with people not yet told", sends, and
 * stamps each row `notified_at`. A crash halfway, a restart or a mail outage
 * leaves the rest unstamped and the next run picks them up — and nobody is
 * emailed twice, because a stamped row is never read again.
 *
 * The organizer sees how many people are waiting, never who. The addresses
 * are the buyers' and were given for this one notice.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One run sends at most this many, so a big list cannot hold the lease for long. */
const BATCH = 200;

/** A failure worth retrying later, from emailService.send's `reason`. */
function isTransient(reason) {
  const r = String(reason || '');
  return r === 'not_configured' || r === 'network' || r === 'http_429' || /^http_5\d\d$/.test(r);
}

/**
 * Adds an address to a live teaser's list. Saying "you're on the list" for an
 * address already on it is the right answer — and it does not tell anyone
 * whether a given address had signed up.
 *
 * @returns {Promise<{ ok: true } | { ok: false, code: 'EVENT_NOT_FOUND' | 'INVALID_EMAIL' | 'NOT_COMING_SOON' }>}
 */
async function signup({ slug, email, userId = null }) {
  const address = String(email || '').trim().toLowerCase();
  if (address.length > 254 || !EMAIL.test(address)) return { ok: false, code: 'INVALID_EMAIL' };

  const { data: event, error } = await supabase
    .from('events').select('id, status, coming_soon')
    .eq('slug', slug).eq('status', 'published').maybeSingle();
  if (error) throw new Error(error.message);
  if (!event) return { ok: false, code: 'EVENT_NOT_FOUND' };
  // Sales already opened: the page shows a Buy button now, and that is the answer.
  if (!event.coming_soon) return { ok: false, code: 'NOT_COMING_SOON' };

  const { error: insertError } = await supabase
    .from('event_notify_signups')
    .upsert({ event_id: event.id, email: address, user_id: userId }, {
      onConflict: 'event_id,email', ignoreDuplicates: true,
    });
  if (insertError) throw new Error(insertError.message);
  return { ok: true };
}

/** How many people are waiting on this event — for the organizer's page. */
async function waitingCount(eventId) {
  const { count, error } = await supabase
    .from('event_notify_signups')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId);
  if (error) {
    logger.warn({ err: error.message, eventId }, 'coming soon: could not count the notify list');
    return null;
  }
  return count || 0;
}

/**
 * Emails everybody not yet told, on every event whose sales have opened.
 * Returns how many emails were handed to the mail provider.
 */
async function sendOnSaleNotices() {
  const email = require('./emailService');

  const { data: rows, error } = await supabase
    .from('event_notify_signups')
    .select(`id, email, event_id,
             events!inner ( id, slug, title, status, coming_soon, sales_opened_at,
                            starts_at, ends_at, timezone, venue_name, city,
                            organizers ( display_name ) )`)
    .is('notified_at', null)
    .eq('events.status', 'published')
    .eq('events.coming_soon', false)
    .not('events.sales_opened_at', 'is', null)
    .order('created_at')
    .limit(BATCH);
  if (error) {
    logger.error({ err: error.message }, 'coming soon: could not read the notify list');
    return 0;
  }

  let sent = 0;
  for (const row of rows || []) {
    const e = Array.isArray(row.events) ? row.events[0] : row.events;
    const org = Array.isArray(e?.organizers) ? e.organizers[0] : e?.organizers;
    // eslint-disable-next-line no-await-in-loop -- one at a time keeps the provider's rate limit
    const result = await email.sendComingSoonOnSale({
      to: row.email,
      event: {
        id: e.id, slug: e.slug, title: e.title, startsAt: e.starts_at, timezone: e.timezone,
        venue: e.venue_name, city: e.city, organizerName: org?.display_name || null,
      },
    });
    // Not configured, a network failure, rate limiting or a provider outage:
    // stop and leave this row and the rest for a later run, rather than marking
    // a notice delivered that never left. A refused ADDRESS (any other 4xx)
    // would fail forever, so that one is marked and moved past.
    if (!result?.sent && isTransient(result?.reason)) break;
    // eslint-disable-next-line no-await-in-loop
    const { error: markError } = await supabase
      .from('event_notify_signups')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('notified_at', null);
    if (markError) logger.error({ err: markError.message, id: row.id }, 'coming soon: could not mark a notice sent');
    if (result?.sent) sent += 1;
  }
  if (sent > 0) logger.info({ sent }, 'coming soon: on-sale notices sent');
  return sent;
}

module.exports = { signup, waitingCount, sendOnSaleNotices, isTransient, EMAIL };
