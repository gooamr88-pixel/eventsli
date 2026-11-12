'use client';

import { useState } from 'react';
import { post, patch, del } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useApi } from '../../../hooks/useApi';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { Panel } from '../../../components/ui/Page';
import Field from '../../../components/forms/Field';
import NavIcon from '../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../components/Feedback';
import { formatCount, EXCLUSION_LABEL } from '../../../lib/smsFormat';
import { SmsPage } from '../smsUi';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Audience segments: who a targeted message goes to, built from what people
 * did on Eventsli (which events they bought for, from which organizers, how
 * recently, whether they came) and where their number is.
 *
 * "Count" runs the segment against today's data and shows how many people are
 * actually reachable — and why the rest are not — before anyone writes a word.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const EMPTY = { name: '', description: '', eventIds: '', organizerIds: '', eventCountries: '', recipientCountries: '', purchasedWithinDays: '', minOrders: '', attendedOnly: false };
const list = (s) => String(s || '').split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);

function toDefinition(f) {
  const def = {};
  if (list(f.eventIds).length) def.eventIds = list(f.eventIds);
  if (list(f.organizerIds).length) def.organizerIds = list(f.organizerIds);
  if (list(f.eventCountries).length) def.eventCountries = list(f.eventCountries).map((c) => c.toUpperCase());
  if (list(f.recipientCountries).length) def.recipientCountries = list(f.recipientCountries).map((c) => c.toUpperCase());
  if (f.purchasedWithinDays) def.purchasedWithinDays = Number(f.purchasedWithinDays);
  if (f.minOrders) def.minOrders = Number(f.minOrders);
  if (f.attendedOnly) def.attendedOnly = true;
  return def;
}

function fromSegment(s) {
  const d = s.definition || {};
  return {
    name: s.name, description: s.description || '', eventIds: (d.eventIds || []).join(', '), organizerIds: (d.organizerIds || []).join(', '),
    eventCountries: (d.eventCountries || []).join(', '), recipientCountries: (d.recipientCountries || []).join(', '),
    purchasedWithinDays: d.purchasedWithinDays ? String(d.purchasedWithinDays) : '', minOrders: d.minOrders ? String(d.minOrders) : '',
    attendedOnly: Boolean(d.attendedOnly),
  };
}

function PreviewResult({ p }) {
  if (!p) return null;
  return (
    <div className="fx-stack fx-stack--sm rounded-(--es-radius-md) bg-bg-sunken p-4">
      <p className="text-ink"><strong>{formatCount(p.eligible)}</strong> reachable of {formatCount(p.audience)} buyers with a phone number{p.truncated ? ' (first 20,000 counted)' : ''}.</p>
      {Object.keys(p.excluded || {}).length > 0 && (
        <p className="es-smsmeta">{Object.entries(p.excluded).map(([k, v]) => <span key={k}>{EXCLUSION_LABEL[k] || k}: {formatCount(v)}</span>)}</p>
      )}
      {Object.keys(p.byCountry || {}).length > 0 && (
        <p className="es-smsmeta">{Object.entries(p.byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => <span key={k}>{k}: {formatCount(v)}</span>)}</p>
      )}
    </div>
  );
}

function SegmentForm({ segment, onSaved, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState(segment ? fromSegment(segment) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function count() {
    setBusy(true);
    try {
      setResult(await post('/admin/sms/segments/preview', { definition: toDefinition(f) }, { noRedirect: true }));
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: f.name.trim(), description: f.description.trim() || null, definition: toDefinition(f) };
      if (segment?.id) await patch(`/admin/sms/segments/${segment.id}`, body, { noRedirect: true });
      else await post('/admin/sms/segments', body, { noRedirect: true });
      toast.success('Segment saved.');
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="fx-stack">
      <fieldset disabled={busy} className="es-smsform">
        <Field label="Name" value={f.name} onChange={set('name')} required minLength={2} />
        <Field label="Description" value={f.description} onChange={set('description')} optional />
        <Field label="Event IDs" value={f.eventIds} onChange={set('eventIds')} optional hint="Buyers of these events (IDs from the event page URL)" />
        <Field label="Organizer IDs" value={f.organizerIds} onChange={set('organizerIds')} optional hint="Buyers from these organizers' events" />
        <Field label="Event countries" value={f.eventCountries} onChange={set('eventCountries')} optional hint="Events held in, e.g. CA, US" />
        <Field label="Recipient countries" value={f.recipientCountries} onChange={set('recipientCountries')} optional hint="Phone numbers from, e.g. EG" />
        <Field label="Bought within (days)" type="number" min={1} max={3650} value={f.purchasedWithinDays} onChange={set('purchasedWithinDays')} optional />
        <Field label="At least this many orders" type="number" min={1} max={100} value={f.minOrders} onChange={set('minOrders')} optional />
        <label className="es-smscheck"><input type="checkbox" checked={f.attendedOnly} onChange={set('attendedOnly')} /><span>Only people who checked in</span></label>
      </fieldset>
      <PreviewResult p={result} />
      <div className="fx-row gap-2">
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busy} onClick={count}><NavIcon name="users" size={16} />Count audience</button>
        <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy}>Save segment</button>
        <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function Audiences() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi('/admin/sms/segments');
  const [editing, setEditing] = useState(null);
  const [counts, setCounts] = useState({});

  async function count(s) {
    try {
      const p = await post(`/admin/sms/segments/${s.id}/preview`, {}, { noRedirect: true });
      setCounts((c) => ({ ...c, [s.id]: p }));
    } catch (err) {
      toast.error(messageFor(err));
    }
  }

  async function remove(s) {
    const ok = await confirm({ title: `Delete “${s.name}”?`, confirmLabel: 'Delete', tone: 'danger', body: <p>Campaigns that already used it keep their history.</p> });
    if (!ok) return;
    try {
      await del(`/admin/sms/segments/${s.id}`, { noRedirect: true });
      toast.success('Segment deleted.');
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <SmsPage icon="target" title="Audience segmentation"
      lede="Groups of buyers to target. Only people with marketing consent, in an enabled country, are ever reached."
      actions={!editing && <button type="button" className="es-btn es-btn--primary" onClick={() => setEditing({})}><NavIcon name="plus" size={18} />New segment</button>}>
      {editing && (
        <Panel icon="filter" title={editing.id ? `Edit “${editing.name}”` : 'New segment'} description="Leave a filter empty to not filter on it.">
          <SegmentForm segment={editing.id ? editing : null} onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
        </Panel>
      )}
      {error ? <ErrorNotice error={error} onRetry={reload} /> : loading && !data ? <Loading variant="list" rows={3} label="Loading segments" />
        : (data || []).length === 0 ? <p className="py-10 text-center text-sm text-muted">No segments yet.</p> : (
          <ul className="fx-stack fx-stack--sm">
            {data.map((s) => (
              <li key={s.id} className="es-card fx-stack fx-stack--sm p-5">
                <div className="fx-row fx-row--between items-start gap-3">
                  <div className="fx-min0">
                    <p className="text-lg font-medium text-ink">{s.name}</p>
                    <p className="text-sm text-muted">{s.summary}</p>
                    {s.lastCountedAt && <p className="text-xs text-subtle">{formatCount(s.lastCount)} reachable when counted {new Date(s.lastCountedAt).toLocaleString()}</p>}
                  </div>
                  <div className="fx-row gap-2">
                    <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => count(s)}>Count</button>
                    <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setEditing(s)}>Edit</button>
                    <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => remove(s)}>Delete</button>
                  </div>
                </div>
                <PreviewResult p={counts[s.id]} />
              </li>
            ))}
          </ul>
        )}
    </SmsPage>
  );
}
