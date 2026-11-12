'use client';

import { useState } from 'react';
import { post, patch, del } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useApi } from '../../../hooks/useApi';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { Panel } from '../../../components/ui/Page';
import DataTable from '../../../components/ui/DataTable';
import Field, { SelectField } from '../../../components/forms/Field';
import { Loading, ErrorNotice } from '../../../components/Feedback';
import { SmsPage, Toggle } from '../smsUi';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Sender IDs: the numbers, short codes, messaging services and alphanumeric
 * names messages go out from, with their registration state per country.
 *
 * A country that requires registration only accepts a sender listed for it
 * and APPROVED. Pending and rejected registrations are never used.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KINDS = [
  ['long_code', 'Phone number (long code)'], ['toll_free', 'Toll-free number'], ['short_code', 'Short code'],
  ['alphanumeric', 'Alphanumeric sender ID'], ['messaging_service', 'Messaging service (Twilio)'],
];
const REG = [['not_required', 'Not required'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['expired', 'Expired']];
const REG_TONE = { not_required: 'muted', pending: 'warning', approved: 'success', rejected: 'danger', expired: 'danger' };
const EMPTY = { providerId: 'twilio', kind: 'long_code', value: '', label: '', countries: '', registrationStatus: 'not_required', registrationReference: '', transactional: true, marketing: true };

function SenderForm({ onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const trafficClasses = [f.transactional && 'transactional', f.marketing && 'marketing'].filter(Boolean);
    if (!trafficClasses.length) { toast.error('Choose at least one kind of traffic.'); return; }
    setBusy(true);
    try {
      await post('/admin/sms/senders', {
        providerId: f.providerId, kind: f.kind, value: f.value.trim(), label: f.label.trim() || null,
        countries: f.countries.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean),
        registrationStatus: f.registrationStatus, registrationReference: f.registrationReference.trim() || null, trafficClasses,
      }, { noRedirect: true });
      toast.success('Sender added.');
      setF(EMPTY);
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="fx-stack">
      <fieldset disabled={busy} className="es-smsform">
        <SelectField label="Provider" value={f.providerId} onChange={set('providerId')} options={[['twilio', 'Twilio'], ['vonage', 'Vonage']]} />
        <SelectField label="Kind" value={f.kind} onChange={set('kind')} options={KINDS} />
        <Field label="Sender" value={f.value} onChange={set('value')} required
          hint={f.kind === 'alphanumeric' ? 'Up to 11 letters and digits' : f.kind === 'messaging_service' ? 'MG… service SID' : f.kind === 'short_code' ? 'Digits only' : '+ and country code'} />
        <Field label="Label" value={f.label} onChange={set('label')} optional />
        <Field label="Countries" value={f.countries} onChange={set('countries')} optional hint="ISO codes, comma separated. Empty: any country that does not require registration" />
        <SelectField label="Registration" value={f.registrationStatus} onChange={set('registrationStatus')} options={REG} />
        <Field label="Registration reference" value={f.registrationReference} onChange={set('registrationReference')} optional hint="10DLC campaign ID, toll-free verification, sender ID ticket…" />
        <div className="fx-row gap-4">
          <label className="es-smscheck"><input type="checkbox" checked={f.transactional} onChange={set('transactional')} /><span>Transactional</span></label>
          <label className="es-smscheck"><input type="checkbox" checked={f.marketing} onChange={set('marketing')} /><span>Marketing</span></label>
        </div>
      </fieldset>
      <div><button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy}>Add sender</button></div>
    </form>
  );
}

export default function Senders() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = Boolean(user?.isSuperAdmin);
  const { data, error, loading, reload } = useApi('/admin/sms/senders');

  async function update(s, body, done) {
    try {
      await patch(`/admin/sms/senders/${s.id}`, body, { noRedirect: true });
      toast.success(done);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function remove(s) {
    const ok = await confirm({ title: `Remove ${s.value}?`, body: <p>Routes pinned to this sender fall back to automatic choice.</p>, confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    try {
      await del(`/admin/sms/senders/${s.id}`, { noRedirect: true });
      toast.success('Sender removed.');
      reload();
    } catch (err) {
      toast.error(messageFor(err));
    }
  }

  const columns = [
    { key: 'value', label: 'Sender', primary: true, render: (s) => <span><span className="font-medium text-ink">{s.value}</span>{s.label && <span className="block text-xs text-subtle">{s.label}</span>}</span> },
    { key: 'provider', label: 'Provider', render: (s) => <span className="capitalize">{s.providerId}</span> },
    { key: 'kind', label: 'Kind', render: (s) => KINDS.find(([k]) => k === s.kind)?.[1] || s.kind },
    { key: 'countries', label: 'Countries', render: (s) => (s.countries.length ? s.countries.join(', ') : 'Any (unregistered)') },
    { key: 'reg', label: 'Registration', render: (s) => (
      canEdit ? (
        <select className="es-input" aria-label={`Registration of ${s.value}`} value={s.registrationStatus}
          onChange={(e) => update(s, { registrationStatus: e.target.value }, 'Registration updated.')}>
          {REG.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : <span className="es-smspill" data-tone={REG_TONE[s.registrationStatus]}>{REG.find(([v]) => v === s.registrationStatus)?.[1]}</span>
    ) },
    { key: 'traffic', label: 'Traffic', render: (s) => s.trafficClasses.join(', ') },
    { key: 'active', label: 'Active', align: 'end', render: (s) => (
      <span className="fx-row items-center justify-end gap-2">
        <Toggle label={`${s.value} active`} checked={s.active} disabled={!canEdit} onChange={(on) => update(s, { active: on }, on ? 'Sender on.' : 'Sender off.')} />
        {canEdit && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => remove(s)}>Remove</button>}
      </span>
    ) },
  ];

  return (
    <SmsPage icon="tag" title="Sender ID management"
      lede="The numbers and names texts come from, and their registration for each country.">
      {canEdit && (
        <Panel icon="plus" title="Add a sender" description="Register it with the provider first; record the reference here.">
          <SenderForm onSaved={reload} />
        </Panel>
      )}
      <Panel icon="list" title="Senders">
        {error ? <ErrorNotice error={error} onRetry={reload} /> : loading && !data ? <Loading variant="list" rows={3} label="Loading senders" />
          : (data || []).length === 0 ? <p className="py-8 text-center text-sm text-muted">No senders yet. Nothing can be sent until one exists.</p>
            : <DataTable columns={columns} rows={data} caption="SMS senders" />}
      </Panel>
    </SmsPage>
  );
}
