const { supabase } = require('../config/supabase');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const eventAccess = require('../services/eventAccess');
const publishing = require('../services/eventPublishing');
const { writeAudit } = require('../services/auditService');

/**
 * PUT /events/:eventId/privacy   { isPrivate, password?, passwordMin?, passwordMax? }
 *
 * Private events, behind a password (owner, 2026-11-22) — see
 * services/eventAccess.js for what "private" does on the public side.
 *
 * Its own endpoint rather than a field on PATCH /events/:id because the
 * password is a secret: it is hashed here and never travels back, and it has no
 * place in the event form's "what changed" bookkeeping or an admin's
 * before/after audit.
 *
 * THE LENGTH RULE IS THE ORGANIZER'S: `passwordMin`/`passwordMax`, anywhere in
 * 1–100. The password must fit it. The stored password is a hash, so whether
 * the CURRENT one fits a NEW rule cannot be checked — changing the rule
 * therefore asks for the password again.
 *
 * Not a reviewed change. Making an event private only takes it out of view;
 * making it public again shows what was already approved. Allowed in every
 * state but cancelled and completed, which are records, not drafts.
 *
 * Turning it off keeps the password and the rule, so turning it back on later
 * needs neither again. Setting a new password ends every earlier unlock (the
 * token carries `access_password_set_at`).
 */
async function update(req, res, next) {
  try {
    const { data: event, error } = await supabase
      .from('events')
      .select('id, slug, status, is_private, access_password_set_at, access_password_min, access_password_max')
      .eq('id', req.params.eventId)
      .single();
    if (error) throw new Error(error.message);

    const refuse = (message, status = 400) => sendFail(res, {
      status, error: status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', message,
    });

    if (['cancelled', 'completed'].includes(event.status)) {
      return refuse(`A ${event.status} event cannot be changed.`, 409);
    }

    const wantPrivate = req.body.isPrivate === true;
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const hasPassword = Boolean(event.access_password_set_at);

    // The rule asked for, each end falling back to what is stored.
    const stored = eventAccess.ruleOf(event);
    const rule = {
      min: req.body.passwordMin ?? stored.min,
      max: req.body.passwordMax ?? stored.max,
    };
    if (!eventAccess.validRule(rule)) {
      return refuse('The shortest length must be 1 to 100 and no more than the longest.');
    }
    const ruleChanged = rule.min !== stored.min || rule.max !== stored.max;

    const patch = { is_private: wantPrivate };
    if (ruleChanged) {
      if (hasPassword && !password) {
        return refuse('Enter the password again, so it can be checked against the new length.');
      }
      patch.access_password_min = rule.min;
      patch.access_password_max = rule.max;
    }

    if (password) {
      try {
        patch.access_password_hash = await eventAccess.hashNew(password, rule);
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR') return refuse(err.message);
        throw err;
      }
      // `updated_at` is left alone: it versions the event's CONTENT (the share
      // card, the sitemap, and the details form, which re-seeds from it and
      // would drop the organizer's unsaved edits beside this card).
      patch.access_password_set_at = new Date().toISOString();
    } else if (wantPrivate && !hasPassword) {
      return refuse('Choose a password for your guests to enter.');
    }

    const { data: saved, error: saveError } = await supabase
      .from('events').update(patch).eq('id', event.id)
      .select('id, slug, status, is_private, access_password_set_at, access_password_min, access_password_max')
      .single();
    if (saveError) throw new Error(saveError.message);

    // A published event's cached pages and listings change now, not in a minute:
    // it leaves (or rejoins) /events and the homepage, and its page locks.
    if (saved.status === 'published') publishing.refreshPublicPages(saved.slug);

    if (req.user?.access?.isAdmin) {
      await writeAudit(req, {
        action: 'event.privacy_changed', targetType: 'event', targetId: event.id,
        // Whether the password changed, never what it is.
        payload: {
          before: { isPrivate: event.is_private === true, rule: stored },
          after: { isPrivate: saved.is_private === true, rule: eventAccess.ruleOf(saved) },
          passwordChanged: Boolean(password),
        },
      });
    }

    return sendOk(res, {
      isPrivate: saved.is_private === true,
      hasPassword: Boolean(saved.access_password_set_at),
      passwordSetAt: saved.access_password_set_at || null,
      passwordMin: saved.access_password_min ?? null,
      passwordMax: saved.access_password_max ?? null,
    });
  } catch (err) { return next(err); }
}

module.exports = { update };
