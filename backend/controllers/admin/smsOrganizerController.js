const { supabase } = require('../../config/supabase');
const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const { writeAudit } = require('../../services/auditService');
const { safeSearch } = require('../../utils/search');

/**
 * Which organizers may run text campaigns, and how many messages a month.
 * Reads for every admin; changes for super admins (routes/admin/smsRoutes.js).
 */

async function listOrganizers(req, res, next) {
  try {
    let q = supabase.from('organizers').select('id, display_name, country, is_banned, created_at').order('display_name').limit(100);
    const term = safeSearch(req.query.q);
    if (term) q = q.ilike('display_name', `%${term}%`);
    const { data: orgs, error } = await q;
    if (error) throw new Error(error.message);
    const ids = (orgs || []).map((o) => o.id);
    const { data: access } = ids.length
      ? await supabase.from('sms_organizer_access').select('*').in('organizer_id', ids)
      : { data: [] };
    const byId = new Map((access || []).map((a) => [a.organizer_id, a]));
    const enriched = await Promise.all((orgs || []).map(async (o) => {
      const a = byId.get(o.id);
      const [{ data: used }, { data: consent }] = a
        ? await Promise.all([
          supabase.rpc('sms_organizer_month_usage', { p_organizer: o.id }),
          supabase.rpc('sms_organizer_consent_summary', { p_organizer: o.id }),
        ])
        : [{ data: 0 }, { data: null }];
      return {
        id: o.id, name: o.display_name, country: o.country, banned: o.is_banned,
        access: {
          enabled: Boolean(a?.enabled), monthlyCap: a?.monthly_message_cap ?? 1000,
          categories: a?.categories || ['marketing', 'segmentation'], note: a?.note || null, updatedAt: a?.updated_at || null,
        },
        usedThisMonth: Number(used) || 0,
        consent: consent || null,
      };
    }));
    // Granted first: those are the ones being managed.
    enriched.sort((x, y) => Number(y.access.enabled) - Number(x.access.enabled));
    return sendOk(res, enriched);
  } catch (err) { return next(err); }
}

async function setAccess(req, res, next) {
  try {
    const { data: org } = await supabase.from('organizers').select('id, display_name, is_banned').eq('id', req.params.organizerId).maybeSingle();
    if (!org) return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'No such organizer.' });
    if (req.body.enabled === true && org.is_banned) {
      return sendFail(res, { status: 409, error: 'CONFLICT', message: 'This organizer is banned and cannot be given SMS access.' });
    }
    const row = { organizer_id: org.id, updated_by: req.user.id, updated_at: new Date().toISOString() };
    if (req.body.enabled !== undefined) row.enabled = req.body.enabled;
    if (req.body.monthlyCap !== undefined) row.monthly_message_cap = req.body.monthlyCap;
    if (req.body.categories !== undefined) row.categories = req.body.categories;
    if (req.body.note !== undefined) row.note = req.body.note || null;
    const { data, error } = await supabase.from('sms_organizer_access').upsert(row, { onConflict: 'organizer_id' }).select('*').single();
    if (error) return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'The access could not be saved.' });
    // Turning access off stops anything not yet sent.
    if (data.enabled === false) {
      const { data: live } = await supabase.from('sms_campaigns').select('id').eq('organizer_id', org.id).in('status', ['approved', 'sending', 'pending_approval']);
      const liveIds = (live || []).map((c) => c.id);
      if (liveIds.length) {
        await supabase.from('sms_campaigns').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), decision_note: 'SMS access was turned off' }).in('id', liveIds);
        await supabase.from('sms_messages').update({ status: 'cancelled', block_reason: 'manual_cancel', finished_at: new Date().toISOString() })
          .in('campaign_id', liveIds).eq('status', 'queued');
      }
    }
    await writeAudit(req, {
      action: 'sms.organizer.access', targetType: 'organizer', targetId: org.id,
      payload: { name: org.display_name, enabled: data.enabled, monthlyCap: data.monthly_message_cap, categories: data.categories },
    });
    return sendOk(res, { organizerId: org.id, enabled: data.enabled, monthlyCap: data.monthly_message_cap, categories: data.categories, note: data.note });
  } catch (err) { return next(err); }
}

module.exports = { listOrganizers, setAccess };
