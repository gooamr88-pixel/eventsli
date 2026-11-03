const { supabase } = require('../config/supabase');
const { SETTING_DEFAULTS } = require('../utils/settingsSchema');
const { revalidate, LANDING_TAG } = require('./revalidateService');
const { eventUrl } = require('./shareLinks');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PUBLISH FIRST, REVIEW AFTER (owner decision, 2026-11-03).
 *
 * An organizer's "Publish" puts the event live at once. Every admin is emailed
 * that a new event went up, with a link to review it, and the organizer is
 * emailed that it is live. If an admin then rejects, suspends or cancels it,
 * the organizer is emailed the admin's reason.
 *
 * ONE SWITCH BRINGS BACK REVIEW-FIRST: `event_publishing.require_approval` in
 * the admin console's settings (default off). On, submitting waits in the
 * approval queue exactly as before, and approving sends the "live" email.
 *
 * EMAILS NEVER DECIDE ANYTHING. The status change is committed first; every
 * notice is best effort and logged on failure, because an event that is live
 * must not be reported as failed because a mail server was slow.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Does publishing wait for an admin? Default: no. Read per request, so the switch takes effect at once. */
async function requiresApproval() {
  const { data, error } = await supabase
    .from('platform_settings').select('value').eq('key', 'event_publishing').maybeSingle();
  if (error) {
    logger.warn({ err: error.message }, 'publishing: could not read the approval setting; using the default');
    return SETTING_DEFAULTS.event_publishing.require_approval;
  }
  const value = data?.value?.require_approval;
  return typeof value === 'boolean' ? value : SETTING_DEFAULTS.event_publishing.require_approval;
}

/** Drop the cached public pages that show this event, so a change is seen now, not in a minute. */
function refreshPublicPages(slug) {
  return revalidate([`event:${slug}`, 'events:published', LANDING_TAG]).catch(() => {});
}

const EVENT_FIELDS = 'id, slug, title, listing_type, starts_at, ends_at, timezone, venue_name, city, organizer_id, '
  + 'organizers ( display_name, profiles!organizers_owner_user_id_fkey ( email ) )';

async function loadForEmail(eventId) {
  const { data, error } = await supabase.from('events').select(EVENT_FIELDS).eq('id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const org = Array.isArray(data.organizers) ? data.organizers[0] : data.organizers;
  const profile = Array.isArray(org?.profiles) ? org.profiles[0] : org?.profiles;
  return {
    event: {
      id: data.id, slug: data.slug, title: data.title, listingType: data.listing_type,
      startsAt: data.starts_at, timezone: data.timezone, venue: data.venue_name, city: data.city,
    },
    organizerName: org?.display_name || null,
    organizerEmail: profile?.email || null,
  };
}

/** Every admin who can act on it, plus anyone in EVENT_ALERT_EMAILS (comma-separated). */
async function adminRecipients() {
  const { data, error } = await supabase
    .from('profiles').select('email').in('role', ['admin', 'super_admin']).eq('is_blocked', false);
  if (error) throw new Error(error.message);
  const extra = String(process.env.EVENT_ALERT_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set([...(data || []).map((r) => r.email).filter(Boolean), ...extra].map((e) => e.toLowerCase()))];
}

function safely(label, eventId, promise) {
  return Promise.resolve(promise).catch((err) => logger.error({ err: err.message, eventId }, `${label} failed`));
}

/**
 * An event just went live. Admins hear about it (to review it now that it is
 * public); the organizer hears that it is live. `direct`: it went live on
 * the organizer's own Publish, without waiting for an admin.
 */
async function notifyPublished({ eventId, origin, direct }) {
  const email = require('./emailService');
  const info = await loadForEmail(eventId);
  if (!info) return;
  refreshPublicPages(info.event.slug);
  const publicUrl = eventUrl(info.event.slug);

  const jobs = [];
  if (info.organizerEmail) {
    jobs.push(safely('organizer live email', eventId, email.sendEventApproved({
      to: info.organizerEmail, organizerName: info.organizerName, event: info.event, url: publicUrl, direct,
    })));
  }
  if (direct) {
    const admins = await adminRecipients().catch((err) => {
      logger.error({ err: err.message }, 'publishing: could not list admins to notify');
      return [];
    });
    const adminUrl = `${origin}/admin/events/${eventId}`;
    for (const to of admins) {
      jobs.push(safely('admin new-event email', eventId, email.sendEventPublishedToAdmins({
        to, event: info.event, organizerName: info.organizerName, adminUrl, publicUrl,
      })));
    }
    logger.info({ eventId, admins: admins.length }, 'event published directly; admins notified');
  }
  await Promise.all(jobs);
}

/**
 * An admin acted on an event; the organizer is told, with the admin's reason.
 * `action`: 'rejected' | 'suspended' | 'cancelled' | 'restored'.
 */
async function notifyOrganizer({ eventId, action, reason = null, wasLive = false }) {
  const email = require('./emailService');
  const info = await loadForEmail(eventId);
  if (!info) return;
  refreshPublicPages(info.event.slug);
  if (!info.organizerEmail) {
    logger.warn({ eventId, action }, 'admin action: the organizer has no email to tell');
    return;
  }
  const base = { to: info.organizerEmail, organizerName: info.organizerName, event: info.event };
  const send = {
    rejected: () => email.sendEventRejected({ ...base, reason, wasLive }),
    suspended: () => email.sendEventSuspended({ ...base, reason }),
    cancelled: () => email.sendEventCancelledByAdmin({ ...base, reason }),
    restored: () => email.sendEventRestored({ ...base, url: eventUrl(info.event.slug) }),
  }[action];
  if (send) await safely(`organizer ${action} email`, eventId, send());
}

/** Fire and forget from a request handler: the response never waits on mail. */
function inBackground(label, promise) {
  Promise.resolve(promise).catch((err) => logger.error({ err: err.message }, `${label} failed`));
}

module.exports = {
  requiresApproval, notifyPublished, notifyOrganizer, refreshPublicPages, adminRecipients, inBackground,
};
