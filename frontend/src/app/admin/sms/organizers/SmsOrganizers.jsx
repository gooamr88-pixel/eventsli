'use client';

import { useState } from 'react';
import { put } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useApi } from '../../../hooks/useApi';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { Panel } from '../../../components/ui/Page';
import { SearchBox } from '../../../components/ui/Filters';
import { Loading, ErrorNotice, Notice } from '../../../components/Feedback';
import { formatCount } from '../../../lib/smsFormat';
import { SmsPage, Toggle } from '../smsUi';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Which organizers may send text campaigns to their own opted-in buyers, and
 * how many messages a month. Off by default. Turning access off cancels the
 * organizer's campaigns that have not finished and withdraws their unsent texts.
 *
 * Organizer campaigns are approved on the Campaigns page, like Eventsli's own.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function Row({ o, canEdit, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [cap, setCap] = useState(String(o.access.monthlyCap));
  const [busy, setBusy] = useState(false);

  async function save(body, done) {
    setBusy(true);
    try {
      await put(`/admin/sms/organizers/${o.id}`, body, { noRedirect: true });
      toast.success(done);
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(on) {
    if (!on && !(await confirm({
      title: `Turn off texts for ${o.name}?`,
      body: <p>Their campaigns that have not finished are cancelled and unsent texts are withdrawn.</p>,
      confirmLabel: 'Turn off', tone: 'danger',
    }))) return;
    save({ enabled: on, monthlyCap: Number(cap) || 0 }, on ? `${o.name} can now send text campaigns.` : `${o.name} can no longer send texts.`);
  }

  return (
    <li className="fx-row fx-row--between items-center gap-3 border-b border-(--es-border) py-3 last:border-0">
      <div className="fx-min0 flex-1">
        <p className="font-medium text-ink">{o.name} <span className="text-sm font-normal text-subtle">· {o.country}{o.banned ? ' · banned' : ''}</span></p>
        <p className="text-xs text-subtle">
          {o.consent ? `${formatCount(o.consent.optedIn)} opted in · ${formatCount(o.consent.optedOut)} opted out · ` : ''}
          {formatCount(o.usedThisMonth)} sent this month
        </p>
      </div>
      <form className="fx-row items-center gap-2" onSubmit={(e) => { e.preventDefault(); save({ monthlyCap: Number(cap) || 0 }, 'Monthly allowance saved.'); }}>
        <label className="text-xs text-muted" htmlFor={`cap-${o.id}`}>Per month</label>
        <input id={`cap-${o.id}`} className="es-input w-28" type="number" min={0} max={10000000} value={cap}
          disabled={!canEdit || busy} onChange={(e) => setCap(e.target.value)} />
        {canEdit && <button type="submit" className="es-btn es-btn--ghost es-btn--sm" disabled={busy || String(o.access.monthlyCap) === cap}>Save</button>}
      </form>
      <Toggle label={`Text campaigns for ${o.name}`} checked={o.access.enabled} disabled={!canEdit || busy || (o.banned && !o.access.enabled)} onChange={toggle} />
    </li>
  );
}

export default function SmsOrganizers() {
  const { user } = useAuth();
  const canEdit = Boolean(user?.isSuperAdmin);
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useApi(`/admin/sms/organizers${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  return (
    <SmsPage icon="briefcase" title="Organizer access"
      lede="Organizers may text their own buyers who opted in to them — only once granted here, within a monthly allowance, and only after an admin approves each campaign.">
      {!canEdit && <Notice tone="info" title="Read only."><p>Granting access needs a super admin.</p></Notice>}
      <div className="es-smsfilter"><SearchBox label="Find an organizer" placeholder="Organizer name" value={q} onSearch={setQ} /></div>
      <Panel>
        {error ? <ErrorNotice error={error} onRetry={reload} /> : loading && !data ? <Loading variant="list" rows={4} label="Loading organizers" />
          : (data || []).length === 0 ? <p className="py-6 text-center text-sm text-muted">No organizers found.</p> : (
            <ul>{data.map((o) => <Row key={`${o.id}:${o.access.updatedAt}:${o.access.monthlyCap}`} o={o} canEdit={canEdit} onSaved={reload} />)}</ul>
          )}
      </Panel>
    </SmsPage>
  );
}
