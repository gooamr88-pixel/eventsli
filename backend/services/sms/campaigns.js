const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const config = require('./config');
const phone = require('./phone');
const queue = require('./queue');
const { exclusion } = require('./eligibility');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Campaigns and segment audiences.
 *
 * A campaign is a draft → submitted → APPROVED BY A SECOND ADMIN → sending →
 * completed. Expansion (audience → queued messages) runs in the background a
 * page at a time and is resumable: the cursor is stored, and every message key
 * is `campaign:<id>:<phone>`, so a restart re-queues nothing.
 *
 * Recipients are filtered at expansion (so the numbers are honest) AND again
 * at dispatch by the policy (so a STOP sent in between still wins).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PAGE = 1000;

async function complianceMaps(e164s, scope) {
  const sup = new Map();
  const con = new Map();
  for (let i = 0; i < e164s.length; i += 200) {
    const chunk = e164s.slice(i, i + 200);
    // eslint-disable-next-line no-await-in-loop
    const [s, c] = await Promise.all([
      supabase.from('sms_suppressions').select('phone_e164, scope').in('phone_e164', chunk),
      // MARKETING consent to this sender. Transactional consent never makes
      // anyone reachable by a campaign.
      supabase.from('sms_consents').select('phone_e164, status').eq('scope', scope).eq('kind', 'marketing').in('phone_e164', chunk),
    ]);
    if (s.error || c.error) throw new Error((s.error || c.error).message);
    for (const r of s.data || []) sup.set(r.phone_e164, r);
    for (const r of c.data || []) con.set(r.phone_e164, r);
  }
  return { sup, con };
}

/** One page of a segment's audience, normalised and classified. */
async function audiencePage(def, scope, after, cfg) {
  const { data, error } = await supabase.rpc('sms_segment_audience', { p_definition: def, p_after: after || '', p_limit: PAGE });
  if (error) throw new Error(`segment audience failed: ${error.message}`);
  const rows = data || [];
  const parsed = rows.map((r) => ({ row: r, parsed: phone.normalize(r.phone, { defaultCountry: r.default_country, matcher: cfg.matcher }) }));
  const e164s = [...new Set(parsed.filter((p) => p.parsed).map((p) => p.parsed.e164))];
  const { sup, con } = await complianceMaps(e164s, scope);
  const members = parsed.map(({ row, parsed: p }) => ({
    row, parsed: p,
    reason: exclusion({ parsed: p, cfg, def, suppression: p && sup.get(p.e164), consent: p && con.get(p.e164) }),
  }));
  return { members, last: rows.length ? rows[rows.length - 1].phone : null, done: rows.length < PAGE };
}

/** Counts for the console: who would receive this, and why the rest would not. */
async function previewSegment(def, scope = 'platform', { cap = 20000 } = {}) {
  const cfg = await config.load();
  const excluded = {};
  const byCountry = {};
  const seen = new Set();
  let audience = 0;
  let eligible = 0;
  let after = '';
  let truncated = false;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const page = await audiencePage(def, scope, after, cfg);
    for (const m of page.members) {
      if (m.parsed && seen.has(m.parsed.e164)) continue;
      if (m.parsed) seen.add(m.parsed.e164);
      audience += 1;
      if (m.reason) excluded[m.reason] = (excluded[m.reason] || 0) + 1;
      else {
        eligible += 1;
        byCountry[m.parsed.country] = (byCountry[m.parsed.country] || 0) + 1;
      }
    }
    if (page.done) break;
    after = page.last;
    if (audience >= cap) { truncated = true; break; }
  }
  return { audience, eligible, excluded, byCountry, truncated };
}

/** Messages this campaign already queued count toward the month's usage; do not count them twice. */
const queuedTotalOf = (campaign) => Number(campaign.recipients_queued) || 0;

async function expandOne(campaign, cfg, deadline) {
  const { data: segment } = await supabase.from('sms_segments').select('definition').eq('id', campaign.segment_id).maybeSingle();
  if (!segment) {
    await supabase.from('sms_campaigns').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), decision_note: 'Segment no longer exists' }).eq('id', campaign.id);
    return;
  }
  let cap = cfg.settings?.max_campaign_recipients || 50000;
  const skipped = { ...(campaign.skipped_reasons || {}) };
  // An organizer's campaign: their name opens the text, and their access and
  // remaining monthly allowance bound how many it may queue.
  let brand = null;
  let capReason = 'recipient_cap';
  if (campaign.organizer_id) {
    const [{ data: org }, { data: access }, { data: used }] = await Promise.all([
      supabase.from('organizers').select('display_name, is_banned').eq('id', campaign.organizer_id).maybeSingle(),
      supabase.from('sms_organizer_access').select('enabled, monthly_message_cap').eq('organizer_id', campaign.organizer_id).maybeSingle(),
      supabase.rpc('sms_organizer_month_usage', { p_organizer: campaign.organizer_id }),
    ]);
    if (!org || org.is_banned || !access?.enabled) {
      await supabase.from('sms_campaigns').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), decision_note: 'Organizer SMS access is not enabled' }).eq('id', campaign.id);
      return;
    }
    brand = org.display_name;
    const remaining = Math.max(0, access.monthly_message_cap - (Number(used) || 0) + (queuedTotalOf(campaign)));
    if (remaining < cap) { cap = remaining; capReason = 'organizer_cap'; }
  }
  let { recipients_queued: queuedTotal, recipients_skipped: skippedTotal } = campaign;
  let after = campaign.expansion_cursor || '';
  let done = false;
  const startAt = campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date() ? campaign.scheduled_at : null;
  const expiresAt = new Date(Date.now() + 48 * 3_600_000).toISOString();

  while (!done && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const page = await audiencePage(segment.definition || {}, campaign.consent_scope, after, cfg);
    const inputs = [];
    for (const m of page.members) {
      if (m.reason) { skipped[m.reason] = (skipped[m.reason] || 0) + 1; skippedTotal += 1; continue; }
      if (queuedTotal + inputs.length >= cap) { skipped[capReason] = (skipped[capReason] || 0) + 1; skippedTotal += 1; continue; }
      inputs.push({
        category: campaign.category, e164: m.parsed.e164, country: m.parsed.country, body: campaign.body,
        idempotencyKey: `campaign:${campaign.id}:${m.parsed.e164}`, campaignId: campaign.id,
        consentScope: campaign.consent_scope, userId: m.row.user_id || null, createdBy: campaign.created_by,
        notBefore: startAt, brand, metadata: { expiresAt },
      });
    }
    // eslint-disable-next-line no-await-in-loop
    const result = inputs.length ? await queue.enqueueMany(inputs) : { queued: 0, skipped: {} };
    queuedTotal += result.queued;
    for (const [k, v] of Object.entries(result.skipped)) { skipped[k] = (skipped[k] || 0) + v; skippedTotal += v; }
    after = page.last || after;
    done = page.done;
    // eslint-disable-next-line no-await-in-loop
    await supabase.from('sms_campaigns').update({
      expansion_cursor: after, expansion_done: done, recipients_queued: queuedTotal,
      recipients_skipped: skippedTotal, skipped_reasons: skipped, updated_at: new Date().toISOString(),
    }).eq('id', campaign.id);
  }
}

/** The background job: start due campaigns, expand them, close finished ones. */
async function runCampaigns({ budgetMs = 20_000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const now = new Date().toISOString();
  // Claim due approved campaigns (conditional update: one worker wins each).
  const { data: due } = await supabase.from('sms_campaigns').select('id')
    .eq('status', 'approved').or(`scheduled_at.is.null,scheduled_at.lte.${now}`).limit(20);
  for (const c of due || []) {
    // eslint-disable-next-line no-await-in-loop
    await supabase.from('sms_campaigns').update({ status: 'sending', started_at: now, updated_at: now })
      .eq('id', c.id).eq('status', 'approved');
  }

  const cfg = await config.load();
  const { data: sending } = await supabase.from('sms_campaigns').select('*').eq('status', 'sending').limit(20);
  for (const campaign of sending || []) {
    if (Date.now() >= deadline) break;
    try {
      // eslint-disable-next-line no-await-in-loop
      if (!campaign.expansion_done) await expandOne(campaign, cfg, deadline);
      else {
        // eslint-disable-next-line no-await-in-loop
        const { count } = await supabase.from('sms_messages').select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaign.id).in('status', ['queued', 'sending']);
        if (count === 0) {
          // eslint-disable-next-line no-await-in-loop
          await supabase.from('sms_campaigns').update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', campaign.id).eq('status', 'sending');
        }
      }
    } catch (err) {
      logger.error({ err: err.message, campaign: campaign.id }, 'SMS campaign run failed');
    }
  }
}

module.exports = { previewSegment, runCampaigns, audiencePage };
