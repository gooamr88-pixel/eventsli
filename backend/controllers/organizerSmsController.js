const { supabase } = require('../config/supabase');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const config = require('../services/sms/config');
const campaigns = require('../services/sms/campaigns');
const { compose } = require('../services/sms/compose');
const { normalizeDefinition, describe } = require('../services/sms/segmentDefinition');
const shape = require('./admin/smsShape');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Organizer SMS campaigns — /api/v1/organizer/sms.
 *
 * WHAT AN ORGANIZER CAN DO, AND THE THREE THINGS THAT BOUND IT
 *   1. Eventsli grants access (`sms_organizer_access.enabled`) and a monthly
 *      message cap. Without access the organizer can read this page and
 *      nothing more.
 *   2. Audiences are ONLY their own buyers: every segment is pinned to
 *      `organizerIds: [their id]`, and any event they name must be theirs.
 *   3. Campaigns reach ONLY people who opted in to marketing from THIS
 *      organizer (consent scope = organizer id, a database CHECK). Eventsli's
 *      own marketing consent, or a buyer's transactional consent, never counts.
 *
 * Every campaign is approved by an Eventsli admin before anything is queued,
 * whatever the category says — the organizer is the author, the admin the
 * second pair of eyes. Texts open with the organizer's name and carry the
 * opt-out line.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fail = (res, status, error, message) => sendFail(res, { status, error, message });
const ORGANIZER_FILTERS = new Set(['eventIds', 'purchasedWithinDays', 'minOrders', 'attendedOnly', 'recipientCountries']);

async function contextFor(req) {
  const organizerId = req.user.access.organizerId;
  const [{ data: org }, { data: access }, { data: used }, { data: consent }] = await Promise.all([
    supabase.from('organizers').select('id, display_name, is_banned').eq('id', organizerId).single(),
    supabase.from('sms_organizer_access').select('*').eq('organizer_id', organizerId).maybeSingle(),
    supabase.rpc('sms_organizer_month_usage', { p_organizer: organizerId }),
    supabase.rpc('sms_organizer_consent_summary', { p_organizer: organizerId }),
  ]);
  return {
    organizerId, org,
    access: {
      enabled: Boolean(access?.enabled) && !org?.is_banned,
      monthlyCap: access?.monthly_message_cap ?? 0,
      categories: access?.categories || [],
      usedThisMonth: Number(used) || 0,
      note: access?.note || null,
    },
    consent: consent || { optedIn: 0, pending: 0, optedOut: 0 },
  };
}

/** A definition, pinned to this organizer, naming only their events. */
async function ownDefinition(organizerId, input) {
  const unknown = Object.keys(input || {}).filter((k) => !ORGANIZER_FILTERS.has(k));
  if (unknown.length) return { error: `Unknown filter: ${unknown[0]}.` };
  const def = normalizeDefinition({ ...(input || {}), organizerIds: [organizerId] });
  if (def.error) return def;
  if (def.value.eventIds?.length) {
    const { data } = await supabase.from('events').select('id').eq('organizer_id', organizerId).in('id', def.value.eventIds);
    if ((data || []).length !== def.value.eventIds.length) return { error: 'You can only target buyers of your own events.' };
  }
  return def;
}

async function overview(req, res, next) {
  try {
    const ctx = await contextFor(req);
    const cfg = await config.load();
    const { data: events } = await supabase.from('events').select('id, title, starts_at, timezone, status')
      .eq('organizer_id', ctx.organizerId).order('starts_at', { ascending: false }).limit(200);
    return sendOk(res, {
      access: ctx.access,
      consent: ctx.consent,
      brandName: ctx.org?.display_name,
      optOutText: cfg.settings?.opt_out_text,
      categories: ['marketing', 'segmentation'].map((k) => {
        const c = cfg.categories.get(k);
        return { key: k, label: c?.label, enabled: Boolean(c?.enabled) && ctx.access.categories.includes(k), maxSegments: c?.max_segments };
      }),
      events: (events || []).map((e) => ({ id: e.id, title: e.title, startsAt: e.starts_at, timezone: e.timezone, status: e.status })),
    });
  } catch (err) { return next(err); }
}

// ─── Segments ──────────────────────────────────────────────────────────────

async function listSegments(req, res, next) {
  try {
    const { data, error } = await supabase.from('sms_segments').select('*')
      .eq('organizer_id', req.user.access.organizerId).order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return sendOk(res, (data || []).map((s) => shape.segment(s, describe)));
  } catch (err) { return next(err); }
}

async function saveSegment(req, res, next) {
  try {
    const organizerId = req.user.access.organizerId;
    const def = await ownDefinition(organizerId, req.body.definition || {});
    if (def.error) return fail(res, 400, 'VALIDATION_ERROR', def.error);
    const row = { name: req.body.name, description: req.body.description || null, definition: def.value, updated_at: new Date().toISOString() };
    const q = req.params.id
      ? supabase.from('sms_segments').update(row).eq('id', req.params.id).eq('organizer_id', organizerId)
      : supabase.from('sms_segments').insert({ ...row, organizer_id: organizerId, created_by: req.user.id });
    const { data, error } = await q.select('*').maybeSingle();
    if (error) return fail(res, 400, 'VALIDATION_ERROR', 'The audience could not be saved.');
    if (!data) return fail(res, 404, 'NOT_FOUND', 'No such audience.');
    return sendOk(res, shape.segment(data, describe), { status: req.params.id ? 200 : 201 });
  } catch (err) { return next(err); }
}

async function deleteSegment(req, res, next) {
  try {
    const { error } = await supabase.from('sms_segments').delete()
      .eq('id', req.params.id).eq('organizer_id', req.user.access.organizerId);
    if (error) return fail(res, 409, 'CONFLICT', 'A campaign uses this audience.');
    return sendOk(res, { deleted: true });
  } catch (err) { return next(err); }
}

async function previewSegment(req, res, next) {
  try {
    const organizerId = req.user.access.organizerId;
    let input = req.body.definition;
    if (req.params.id) {
      const { data } = await supabase.from('sms_segments').select('definition').eq('id', req.params.id).eq('organizer_id', organizerId).maybeSingle();
      if (!data) return fail(res, 404, 'NOT_FOUND', 'No such audience.');
      const { organizerIds: _pinned, ...rest } = data.definition || {};
      input = rest;
    }
    const def = await ownDefinition(organizerId, input || {});
    if (def.error) return fail(res, 400, 'VALIDATION_ERROR', def.error);
    const preview = await campaigns.previewSegment(def.value, organizerId);
    return sendOk(res, { ...preview, summary: describe(def.value) });
  } catch (err) { return next(err); }
}

// ─── Campaigns ─────────────────────────────────────────────────────────────

async function listCampaigns(req, res, next) {
  try {
    const { data, error } = await supabase.from('sms_campaigns').select('*')
      .eq('organizer_id', req.user.access.organizerId).order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    const ids = (data || []).filter((c) => ['sending', 'completed', 'cancelled'].includes(c.status)).map((c) => c.id);
    const delivery = {};
    if (ids.length) {
      const { data: msgs } = await supabase.from('sms_messages').select('campaign_id, status').in('campaign_id', ids).limit(100000);
      for (const m of msgs || []) {
        delivery[m.campaign_id] ??= {};
        delivery[m.campaign_id][m.status] = (delivery[m.campaign_id][m.status] || 0) + 1;
      }
    }
    return sendOk(res, (data || []).map((c) => shape.campaign(c, { delivery: delivery[c.id] || null })));
  } catch (err) { return next(err); }
}

async function saveCampaign(req, res, next) {
  try {
    const ctx = await contextFor(req);
    if (!ctx.access.enabled) return fail(res, 403, 'FORBIDDEN', 'Text message campaigns are not enabled for your organization yet. Contact Eventsli to request access.');
    if (!ctx.access.categories.includes(req.body.category)) return fail(res, 403, 'FORBIDDEN', 'That kind of campaign is not enabled for your organization.');
    if (req.body.segmentId) {
      const { data: seg } = await supabase.from('sms_segments').select('id').eq('id', req.body.segmentId).eq('organizer_id', ctx.organizerId).maybeSingle();
      if (!seg) return fail(res, 400, 'VALIDATION_ERROR', 'Choose one of your own audiences.');
    }
    const cfg = await config.load();
    const cat = cfg.categories.get(req.body.category);
    const text = compose({ baseBody: req.body.body, category: cat, settings: cfg.settings, brand: ctx.org.display_name });
    if (text.segments > cat.max_segments) {
      return fail(res, 400, 'VALIDATION_ERROR', `This message is ${text.segments} segments with your name and the opt-out line; the limit is ${cat.max_segments}.`);
    }
    const row = {
      name: req.body.name, category: req.body.category, body: req.body.body, segment_id: req.body.segmentId || null,
      scheduled_at: req.body.scheduledAt || null, consent_scope: ctx.organizerId, organizer_id: ctx.organizerId,
      updated_at: new Date().toISOString(),
    };
    const q = req.params.id
      ? supabase.from('sms_campaigns').update({ ...row, status: 'draft' }).eq('id', req.params.id).eq('organizer_id', ctx.organizerId).in('status', ['draft', 'rejected'])
      : supabase.from('sms_campaigns').insert({ ...row, created_by: req.user.id });
    const { data, error } = await q.select('*').maybeSingle();
    if (error) return fail(res, 400, 'VALIDATION_ERROR', 'The campaign could not be saved.');
    if (!data) return fail(res, 409, 'CONFLICT', 'Only a draft or a campaign that was sent back can be edited.');
    return sendOk(res, shape.campaign(data, { preview: { body: text.body, segments: text.segments, encoding: text.encoding } }), { status: req.params.id ? 200 : 201 });
  } catch (err) { return next(err); }
}

async function submitCampaign(req, res, next) {
  try {
    const ctx = await contextFor(req);
    if (!ctx.access.enabled) return fail(res, 403, 'FORBIDDEN', 'Text message campaigns are not enabled for your organization.');
    const { data: c } = await supabase.from('sms_campaigns').select('*').eq('id', req.params.id).eq('organizer_id', ctx.organizerId).maybeSingle();
    if (!c) return fail(res, 404, 'NOT_FOUND', 'No such campaign.');
    if (!c.segment_id) return fail(res, 400, 'VALIDATION_ERROR', 'Choose an audience first.');
    if (c.scheduled_at && new Date(c.scheduled_at) < new Date(Date.now() - 60_000)) {
      return fail(res, 400, 'VALIDATION_ERROR', 'The scheduled time has passed. Pick a new time or clear it.');
    }
    // Always reviewed by Eventsli, whatever the category's own approval setting.
    const { data, error } = await supabase.from('sms_campaigns')
      .update({ status: 'pending_approval', submitted_at: new Date().toISOString(), decision_note: null, updated_at: new Date().toISOString() })
      .eq('id', c.id).in('status', ['draft', 'rejected']).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return fail(res, 409, 'CONFLICT', 'This campaign changed. Reload and try again.');
    logger.info({ campaign: c.id, organizer: ctx.organizerId }, 'organizer SMS campaign submitted for review');
    return sendOk(res, shape.campaign(data));
  } catch (err) { return next(err); }
}

async function cancelCampaign(req, res, next) {
  try {
    const organizerId = req.user.access.organizerId;
    const { data, error } = await supabase.from('sms_campaigns')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('organizer_id', organizerId)
      .in('status', ['draft', 'pending_approval', 'approved', 'sending', 'rejected']).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return fail(res, 409, 'CONFLICT', 'This campaign has already finished.');
    await supabase.from('sms_messages').update({ status: 'cancelled', block_reason: 'manual_cancel', finished_at: new Date().toISOString() })
      .eq('campaign_id', data.id).eq('status', 'queued');
    return sendOk(res, shape.campaign(data));
  } catch (err) { return next(err); }
}

module.exports = {
  overview, listSegments, saveSegment, deleteSegment, previewSegment,
  listCampaigns, saveCampaign, submitCampaign, cancelCampaign, ownDefinition,
};
