'use client';

import { useState } from 'react';
import { patch } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useApi } from '../../../hooks/useApi';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../components/ui/Toast';
import { Panel } from '../../../components/ui/Page';
import Field, { SelectField } from '../../../components/forms/Field';
import { Loading, ErrorNotice } from '../../../components/Feedback';
import { CATEGORY_ICON } from '../../../lib/smsFormat';
import { SmsPage, Toggle } from '../smsUi';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The four kinds of text, each configured on its own: on/off, who may send,
 * whether a second admin must approve, a per-person daily limit, quiet hours,
 * and the length cap.
 *
 * What cannot be configured is shown as fixed, not hidden: marketing ALWAYS
 * needs consent and an opt-out line (the database refuses otherwise).
 * ─────────────────────────────────────────────────────────────────────────────
 */

function CategoryCard({ c, canEdit, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    minRole: c.minRole, requiresApproval: c.requiresApproval, perRecipientDailyLimit: String(c.perRecipientDailyLimit),
    respectQuietHours: c.respectQuietHours, maxSegments: String(c.maxSegments),
    requiresConsent: c.requiresConsent,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const marketing = c.trafficClass === 'marketing';

  async function save(body, done = 'Saved.') {
    setBusy(true);
    try {
      await patch(`/admin/sms/categories/${c.key}`, body, { noRedirect: true });
      toast.success(done);
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon={CATEGORY_ICON[c.key]} iconTile title={c.label} description={c.description}
      action={<Toggle label={`${c.label} enabled`} checked={c.enabled} disabled={!canEdit || busy}
        onChange={(on) => save({ enabled: on }, `${c.label} ${on ? 'on' : 'off'}.`)} />}>
      <form className="fx-stack" onSubmit={(e) => {
        e.preventDefault();
        save({ ...f, perRecipientDailyLimit: Number(f.perRecipientDailyLimit), maxSegments: Number(f.maxSegments) });
      }}>
        <p className="text-sm text-muted">
          {marketing
            ? 'Marketing traffic: consent is always required, the opt-out line is always added, and it uses marketing senders only.'
            : 'Transactional traffic: about a person’s own order or event. No marketing consent needed; suppression still applies.'}
        </p>
        <fieldset disabled={!canEdit || busy} className="es-smsform">
          <SelectField label="Who may send manually" value={f.minRole} onChange={set('minRole')} options={[['admin', 'Any admin'], ['super_admin', 'Super admins only']]} />
          <Field label="Per person, per day" type="number" min={1} max={100} value={f.perRecipientDailyLimit} onChange={set('perRecipientDailyLimit')} />
          <Field label="Longest message (segments)" type="number" min={1} max={10} value={f.maxSegments} onChange={set('maxSegments')} />
          <div className="fx-stack fx-stack--sm">
            <label className="es-smscheck"><input type="checkbox" checked={f.respectQuietHours} onChange={set('respectQuietHours')} /><span>Hold during the recipient’s quiet hours</span></label>
            {marketing && (
              <label className="es-smscheck"><input type="checkbox" checked={f.requiresApproval} onChange={set('requiresApproval')} /><span>Campaigns need a second admin’s approval</span></label>
            )}
            {!marketing && (
              <label className="es-smscheck"><input type="checkbox" checked={f.requiresConsent} onChange={set('requiresConsent')} />
                <span>Only text people who agreed to texts about their tickets (recommended; untick only where every enabled country’s law allows it)</span></label>
            )}
          </div>
        </fieldset>
        {canEdit && <div><button type="submit" className="es-btn es-btn--secondary es-btn--sm" disabled={busy}>Save</button></div>}
      </form>
    </Panel>
  );
}

export default function Categories() {
  const { user } = useAuth();
  const canEdit = Boolean(user?.isSuperAdmin);
  const { data, error, loading, reload } = useApi('/admin/sms/categories');
  return (
    <SmsPage icon="layers" title="Message categories"
      lede="Four independent capabilities, each with its own switch, permissions and compliance controls.">
      {error ? <ErrorNotice error={error} onRetry={reload} /> : loading && !data ? <Loading variant="list" rows={4} label="Loading categories" /> : (
        <div className="es-smsgrid es-smsgrid--even">
          {data.map((c) => <CategoryCard key={`${c.key}:${c.updatedAt}`} c={c} canEdit={canEdit} onSaved={reload} />)}
        </div>
      )}
    </SmsPage>
  );
}
