'use client';

import { useState } from 'react';
import { post, patch } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useToast } from '../../../components/ui/Toast';
import Field, { SelectField, TextareaField } from '../../../components/forms/Field';
import { analyzeSegments } from '../../../lib/smsFormat';

/**
 * Drafting a campaign. The preview shows the text exactly as it will arrive —
 * the brand prefix and the opt-out line the server adds included — and counts
 * its segments live, because segments are what is billed.
 */

function preview(body, settings) {
  const brand = settings?.brandName || 'Eventsli';
  const text = String(body || '').trim();
  const branded = text.toLowerCase().startsWith(brand.toLowerCase()) ? text : `${brand}: ${text}`;
  return `${branded}\n${settings?.optOutText || 'Reply STOP to opt out'}`;
}

/** `endpoint`: the console's own by default; the organizer page passes /organizer/sms/campaigns. */
export default function CampaignForm({ campaign, segments, settings, categories, onSaved, onCancel, endpoint = '/admin/sms/campaigns', submitNote = 'Submit it when it is ready for a second admin.' }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({
    name: campaign?.name || '',
    category: campaign?.category || 'marketing',
    body: campaign?.body || '',
    segmentId: campaign?.segmentId || '',
    scheduledAt: campaign?.scheduledAt ? new Date(campaign.scheduledAt).toISOString().slice(0, 16) : '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const text = preview(f.body, settings);
  const seg = analyzeSegments(text);
  const cat = categories.find((c) => c.key === f.category);
  const tooLong = cat && seg.segments > cat.maxSegments;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(), category: f.category, body: f.body.trim(), segmentId: f.segmentId || null,
        scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null,
      };
      if (campaign?.id) await patch(`${endpoint}/${campaign.id}`, body, { noRedirect: true });
      else await post(endpoint, body, { noRedirect: true });
      toast.success(`Draft saved. ${submitNote}`);
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="es-smsgrid">
      <fieldset disabled={busy} className="fx-stack">
        <Field label="Campaign name" value={f.name} onChange={set('name')} required minLength={2} hint="Only admins see this" />
        <div className="es-smsform">
          <SelectField label="Category" value={f.category} onChange={set('category')}
            options={categories.filter((c) => !c.trafficClass || c.trafficClass === 'marketing').map((c) => [c.key, `${c.label}${c.enabled ? '' : ' (off)'}`])} />
          <SelectField label="Audience" value={f.segmentId} onChange={set('segmentId')} required
            options={[['', 'Choose an audience'], ...segments.map((s) => [s.id, s.name])]} hint="Build audiences first" />
        </div>
        <TextareaField label="Message" rows={5} value={f.body} onChange={set('body')} required maxLength={1000}
          hint="Write the offer. The brand name and opt-out line are added for you." />
        <Field label="Send at" type="datetime-local" value={f.scheduledAt} onChange={set('scheduledAt')} optional
          hint="Empty: as soon as it is approved. Quiet hours still apply per recipient." />
        <div className="fx-row gap-2">
          <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy || tooLong}>Save draft</button>
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={onCancel}>Cancel</button>
        </div>
      </fieldset>
      <div className="fx-stack fx-stack--sm">
        <p className="text-sm font-medium text-ink">As it will arrive</p>
        <div className="es-smsphone">{text}</div>
        <p className="es-smsmeta">
          <span>{seg.units} characters</span>
          <span>{seg.encoding}</span>
          <span data-tone={tooLong ? 'danger' : undefined} className={tooLong ? 'text-danger font-semibold' : ''}>
            {seg.segments} segment{seg.segments === 1 ? '' : 's'}{cat ? ` of ${cat.maxSegments} allowed` : ''}
          </span>
        </p>
        {seg.encoding === 'UCS-2' && <p className="text-xs text-muted">A character outside the GSM alphabet (an accent, a curly quote, an emoji, Arabic) makes every segment hold 67 characters instead of 153.</p>}
        <p className="text-xs text-muted">Where the sender is an alphanumeric ID, the opt-out line becomes a short unsubscribe link, since those cannot receive replies.</p>
      </div>
    </form>
  );
}
