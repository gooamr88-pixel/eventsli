const { supabase } = require('../../config/supabase');
const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const { writeAudit } = require('../../services/auditService');
const { hasRole } = require('../../services/rbacService');
const config = require('../../services/sms/config');
const campaigns = require('../../services/sms/campaigns');
const { compose } = require('../../services/sms/compose');
const { normalizeDefinition, describe } = require('../../services/sms/segmentDefinition');
const shape = require('./smsShape');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Audience segments and campaigns.
 *
 * THE CAMPAIGN LIFECYCLE
 *   draft ──submit──▶ pending_approval ──approve (ANOTHER admin)──▶ approved
 *     ▲                     │                                         │
 *     └──── edit ◀── reject ┘                     scheduled time ─────▼
 *                                                                  sending ─▶ completed
 *   cancel: any state before completed; queued messages are withdrawn.
 *
 * Four eyes is enforced three times: here (a clear message), in the database
 * (CHECK approved_by <> created_by), and by the category's `min_role`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const audit = (req, action, payload) => writeAudit(req, { action: `sms.${action}`, targetType: 'sms', payload });
const fail = (res, status, error, message) => sendFail(res, { status, error, message });
const SCOPE = /^(platform|[0-9a-f-]{36})$/;

// ─── Segments ──────────────────────────────────────────────────────────────

async function listSegments(req, res, next) {
  try {
    const { data, error } = await supabase.from('sms_segments').select('*').order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return sendOk(res, (data || []).map((s) => shape.segment(s, describe)));
  } catch (err) { return next(err); }
}

async function saveSegment(req, res, next) {
  try {
    const def = normalizeDefinition(req.body.definition || {});
    if (def.error) return fail(res, 400, 'VALIDATION_ERROR', def.error);
    const row = { name: req.body.name, description: req.body.description || null, definition: def.value, updated_at: new Date().toISOString() };
    const q = req.params.id
      ? supabase.from('sms_segments').update(row).eq('id', req.params.id)
      : supabase.from('sms_segments').insert({ ...row, created_by: req.user.id });
    const { data, error } = await q.select('*').maybeSingle();
    if (error) return fail(res, 400, 'VALIDATION_ERROR', 'The segment could not be saved.');
    if (!data) return fail(res, 404, 'NOT_FOUND', 'No such segment.');
    await audit(req, req.params.id ? 'segment.updated' : 'segment.created', { id: data.id, definition: def.value });
    return sendOk(res, shape.segment(data, describe), { status: req.params.id ? 200 : 201 });
  } catch (err) { return next(err); }
}

async function deleteSegment(req, res, next) {
  try {
    const { error } = await supabase.from('sms_segments').delete().eq('id', req.params.id);
    if (error) return fail(res, 409, 'CONFLICT', 'A campaign uses this segment. Cancel or finish it first.');
    await audit(req, 'segment.deleted', { id: req.params.id });
    return sendOk(res, { deleted: true });
  } catch (err) { return next(err); }
}

/** Counts a definition (saved or not) without queuing anything. */
async function previewSegment(req, res, next) {
  try {
    let definition = req.body.definition;
    if (req.params.id) {
      const { data } = await supabase.from('sms_segments').select('definition').eq('id', req.params.id).maybeSingle();
      if (!data) return fail(res, 404, 'NOT_FOUND', 'No such segment.');
      definition = data.definition;
    }
    const def = normalizeDefinition(definition || {});
    if (def.error) return fail(res, 400, 'VALIDATION_ERROR', def.error);
    const scope = SCOPE.test(req.body.consentScope || '') ? req.body.consentScope : 'platform';
    const preview = await campaigns.previewSegment(def.value, scope);
    if (req.params.id) {
      await supabase.from('sms_segments').update({ last_count: preview.eligible, last_counted_at: new Date().toISOString() }).eq('id', req.params.id);
    }
    return sendOk(res, { ...preview, summary: describe(def.value) });
  } catch (err) { return next(err); }
}

// ─── Campaigns ─────────────────────────────────────────────────────────────

async function stats(ids) {
  if (!ids.length) return {};
  const out = {};
  const { data } = await supabase.from('sms_messages').select('campaign_id, status').in('campaign_id', ids).limit(100000);
  for (const m of data || []) {
    out[m.campaign_id] ??= {};
    out[m.campaign_id][m.status] = (out[m.campaign_id][m.status] || 0) + 1;
  }
  return out;
}

async function listCampaigns(req, res, next) {
  try {
    let q = supabase.from('sms_campaigns').select('*').order('created_at', { ascending: false }).limit(100);
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const counts = await stats((data || []).filter((c) => ['sending', 'completed', 'cancelled'].includes(c.status)).map((c) => c.id));
    return sendOk(res, (data || []).map((c) => shape.campaign(c, { delivery: counts[c.id] || null, mine: c.created_by === req.user.id })));
  } catch (err) { return next(err); }
}

async function validateBody(category, body) {
  const cfg = await config.load();
  const cat = cfg.categories.get(category);
  if (!cat) return { error: 'Unknown category.' };
  const text = compose({ baseBody: body, category: cat, settings: cfg.settings });
  if (text.segments > cat.max_segments) {
    return { error: `This message is ${text.segments} segments with the brand and opt-out line; the limit for ${cat.label} is ${cat.max_segments}.` };
  }
  return { cat, text };
}

async function saveCampaign(req, res, next) {
  try {
    const category = req.body.category;
    const checked = await validateBody(category, req.body.body);
    if (checked.error) return fail(res, 400, 'VALIDATION_ERROR', checked.error);
    if (!hasRole(req.user.access, checked.cat.min_role)) return fail(res, 403, 'FORBIDDEN', 'Your role cannot create campaigns in this category.');
    const scope = req.body.consentScope || 'platform';
    if (!SCOPE.test(scope)) return fail(res, 400, 'VALIDATION_ERROR', 'Consent scope must be "platform" or an organizer id.');
    const row = {
      name: req.body.name, category, body: req.body.body, segment_id: req.body.segmentId || null, consent_scope: scope,
      scheduled_at: req.body.scheduledAt || null, updated_at: new Date().toISOString(),
    };
    let q;
    if (req.params.id) {
      q = supabase.from('sms_campaigns').update({ ...row, status: 'draft' }).eq('id', req.params.id).in('status', ['draft', 'rejected']);
    } else {
      q = supabase.from('sms_campaigns').insert({ ...row, created_by: req.user.id });
    }
    const { data, error } = await q.select('*').maybeSingle();
    if (error) return fail(res, 400, 'VALIDATION_ERROR', 'The campaign could not be saved.');
    if (!data) return fail(res, 409, 'CONFLICT', 'Only a draft or rejected campaign can be edited.');
    await audit(req, req.params.id ? 'campaign.updated' : 'campaign.created', { id: data.id, name: data.name });
    return sendOk(res, shape.campaign(data, { preview: { body: checked.text.body, segments: checked.text.segments, encoding: checked.text.encoding } }),
      { status: req.params.id ? 200 : 201 });
  } catch (err) { return next(err); }
}

async function load(id) {
  const { data } = await supabase.from('sms_campaigns').select('*').eq('id', id).maybeSingle();
  return data;
}

async function transition(req, res, from, patch, action) {
  const { data, error } = await supabase.from('sms_campaigns')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).in('status', from).select('*').maybeSingle();
  if (error) {
    if (/sms_campaign_four_eyes/.test(error.message)) return fail(res, 409, 'SELF_ACTION', 'Another admin must approve your campaign.');
    throw new Error(error.message);
  }
  if (!data) return fail(res, 409, 'CONFLICT', 'This campaign changed. Reload and try again.');
  await audit(req, `campaign.${action}`, { id: data.id, name: data.name, note: patch.decision_note || null });
  return sendOk(res, shape.campaign(data));
}

async function submitCampaign(req, res, next) {
  try {
    const c = await load(req.params.id);
    if (!c) return fail(res, 404, 'NOT_FOUND', 'No such campaign.');
    if (!c.segment_id) return fail(res, 400, 'VALIDATION_ERROR', 'Choose an audience segment first.');
    const checked = await validateBody(c.category, c.body);
    if (checked.error) return fail(res, 400, 'VALIDATION_ERROR', checked.error);
    if (c.scheduled_at && new Date(c.scheduled_at) < new Date(Date.now() - 60_000)) {
      return fail(res, 400, 'VALIDATION_ERROR', 'The scheduled time has passed. Pick a new time or clear it to send on approval.');
    }
    const status = checked.cat.requires_approval ? 'pending_approval' : 'approved';
    return transition(req, res, ['draft', 'rejected'], { status, submitted_at: new Date().toISOString(), decision_note: null }, 'submitted');
  } catch (err) { return next(err); }
}

async function approveCampaign(req, res, next) {
  try {
    const c = await load(req.params.id);
    if (!c) return fail(res, 404, 'NOT_FOUND', 'No such campaign.');
    if (c.created_by === req.user.id) return fail(res, 409, 'SELF_ACTION', 'Another admin must approve your campaign.');
    const cfg = await config.load();
    const cat = cfg.categories.get(c.category);
    if (!cat?.enabled) return fail(res, 409, 'CONFLICT', `${cat?.label || 'This category'} is turned off. Turn it on before approving.`);
    if (!hasRole(req.user.access, cat.min_role)) return fail(res, 403, 'FORBIDDEN', 'Your role cannot approve campaigns in this category.');
    return transition(req, res, ['pending_approval'], {
      status: 'approved', approved_by: req.user.id, approved_at: new Date().toISOString(), decision_note: req.body.note || null,
    }, 'approved');
  } catch (err) { return next(err); }
}

async function rejectCampaign(req, res, next) {
  try {
    return transition(req, res, ['pending_approval'], { status: 'rejected', decision_note: req.body.note }, 'rejected');
  } catch (err) { return next(err); }
}

async function cancelCampaign(req, res, next) {
  try {
    const result = await supabase.from('sms_campaigns')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.id).in('status', ['draft', 'pending_approval', 'approved', 'sending', 'rejected']).select('*').maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) return fail(res, 409, 'CONFLICT', 'This campaign has already finished.');
    const { data: withdrawn } = await supabase.from('sms_messages')
      .update({ status: 'cancelled', block_reason: 'manual_cancel', finished_at: new Date().toISOString() })
      .eq('campaign_id', req.params.id).eq('status', 'queued').select('id');
    await audit(req, 'campaign.cancelled', { id: req.params.id, withdrawn: (withdrawn || []).length });
    return sendOk(res, shape.campaign(result.data, { withdrawn: (withdrawn || []).length }));
  } catch (err) { return next(err); }
}

module.exports = {
  listSegments, saveSegment, deleteSegment, previewSegment,
  listCampaigns, saveCampaign, submitCampaign, approveCampaign, rejectCampaign, cancelCampaign,
};
