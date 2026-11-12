'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useApi } from '../../../hooks/useApi';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../components/ui/Toast';
import { Panel } from '../../../components/ui/Page';
import { KpiRow, Kpi } from '../../../components/ui/Kpi';
import Field from '../../../components/forms/Field';
import { Notice } from '../../../components/Feedback';
import { formatCount } from '../../../lib/smsFormat';
import { SmsPage } from '../smsUi';
import CountryTable from '../CountryTable';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Every country and territory, from `sms_countries`. A country that is not in
 * the list can be added here — no code change — with its calling code and,
 * for a shared code, the prefixes that tell it apart.
 *
 * Seeded "unverified" and closed. Opening one means recording, on its page,
 * what the provider's country guidelines say and who checked.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function AddCountry({ onAdded }) {
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ iso2: '', name: '', dialCode: '', prefixes: '', timezone: 'UTC', region: 'Other' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const prefixes = form.prefixes.split(/[\s,]+/).map((p) => p.replace(/[^0-9]/g, '')).filter(Boolean);
      await post('/admin/sms/countries', {
        iso2: form.iso2.trim().toUpperCase(), name: form.name.trim(), dialCode: form.dialCode.replace(/[^0-9]/g, ''),
        prefixes, dialPrimary: prefixes.length === 0, timezone: form.timezone.trim(), region: form.region.trim(),
      }, { noRedirect: true });
      toast.success(`${form.name} added. It starts unverified and closed.`);
      onAdded?.();
      router.push(`/admin/sms/countries/${form.iso2.trim().toUpperCase()}`);
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="fx-stack fx-stack--sm">
      <div className="es-smsform">
        <Field label="ISO code" value={form.iso2} onChange={set('iso2')} maxLength={2} required hint="Two letters, ISO 3166-1" />
        <Field label="Name" value={form.name} onChange={set('name')} required />
        <Field label="Calling code" value={form.dialCode} onChange={set('dialCode')} required hint="Digits only, without +" />
        <Field label="Distinguishing prefixes" value={form.prefixes} onChange={set('prefixes')} optional
          hint="Only for a shared calling code: full prefixes such as 1242" />
        <Field label="Time zone" value={form.timezone} onChange={set('timezone')} required hint="IANA name, e.g. Africa/Cairo" />
        <Field label="Region" value={form.region} onChange={set('region')} required />
      </div>
      <div><button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy}>Add country</button></div>
    </form>
  );
}

export default function Countries() {
  const { user } = useAuth();
  const canEdit = Boolean(user?.isSuperAdmin);
  const { data, reload } = useApi('/admin/sms/countries?limit=1', { raw: true });
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  const stats = data?.meta?.stats;

  return (
    <SmsPage icon="globe" title="Country management"
      lede="Where Eventsli may text. Every country starts closed; one opens only after its provider route, sender rules and restrictions are verified."
      actions={canEdit && (
        <button type="button" className="es-btn es-btn--secondary" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Close' : 'Add a country'}
        </button>
      )}>
      {stats && (
        <KpiRow label="Countries by status">
          <Kpi icon="globe" label="Countries" value={formatCount(stats.total)} />
          <Kpi icon="check" label="Enabled" value={formatCount(stats.enabled)} tone="success" />
          <Kpi icon="clock" label="Unverified" value={formatCount(stats.unverified)} />
          <Kpi icon="ban" label="Disabled or blocked" value={formatCount(stats.disabled + stats.blocked)} />
        </KpiRow>
      )}
      {!canEdit && (
        <Notice tone="info" title="Read only.">
          <p>Turning countries on or off and recording verification needs a super admin.</p>
        </Notice>
      )}
      {adding && (
        <Panel icon="plus" title="Add a country or territory" description="For a place not already listed. It is created unverified.">
          <AddCountry onAdded={() => { reload(); setVersion((v) => v + 1); }} />
        </Panel>
      )}
      <Panel>
        <CountryTable key={version} canEdit={canEdit} />
      </Panel>
    </SmsPage>
  );
}
