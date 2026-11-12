'use client';

import { useState } from 'react';
import { patch, post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useApi } from '../../../hooks/useApi';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../components/ui/Toast';
import { Panel } from '../../../components/ui/Page';
import Field from '../../../components/forms/Field';
import NavIcon from '../../../components/shell/NavIcon';
import { Loading, ErrorNotice, Notice } from '../../../components/Feedback';
import { formatCount } from '../../../lib/smsFormat';
import { SmsPage, Toggle } from '../smsUi';
import ProviderCredentials from './ProviderCredentials';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Twilio, Vonage, and whatever is added later (services/sms/providers/index.js
 * says how). Credentials are environment variables on the server: this page
 * shows only whether they are present and which are missing, by NAME.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function ProviderCard({ p, canEdit, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [priority, setPriority] = useState(String(p.priority));
  const [maxTps, setMaxTps] = useState(String(p.maxTps));
  const sync = p.pricingSync || {};

  async function run(fn, done) {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  const classes = new Set(p.trafficClasses);
  const toggleClass = (cls) => {
    const next = new Set(classes);
    if (next.has(cls)) next.delete(cls); else next.add(cls);
    if (next.size === 0) { toast.error('A provider must carry at least one kind of traffic.'); return; }
    run(() => patch(`/admin/sms/providers/${p.id}`, { trafficClasses: [...next] }, { noRedirect: true }), 'Saved.');
  };

  return (
    <Panel icon="send" title={p.displayName}
      description={p.credentials.configured ? 'Credentials set' : `Missing: ${p.credentials.missing.join(', ')}`}
      action={<Toggle label={`${p.displayName} enabled`} checked={p.enabled} disabled={!canEdit || busy}
        onChange={(on) => run(() => patch(`/admin/sms/providers/${p.id}`, { enabled: on }, { noRedirect: true }), on ? `${p.displayName} is on.` : `${p.displayName} is off.`)} />}>
      <div className="fx-stack">
        {p.circuitOpenUntil && (
          <Notice tone="warning" title="Paused after repeated failures."
            action={canEdit && <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busy}
              onClick={() => run(() => post(`/admin/sms/providers/${p.id}/reset`, {}, { noRedirect: true }), 'Resumed.')}>Resume</button>}>
            <p>Until {new Date(p.circuitOpenUntil).toLocaleTimeString()}. Last error: {p.lastError || 'unknown'}. Traffic falls back to other providers meanwhile.</p>
          </Notice>
        )}
        <dl className="es-smsdl">
          <dt>Routes</dt><dd>{formatCount(p.routes.verified)} verified of {formatCount(p.routes.routes)} · {formatCount(p.routes.available)} countries priced</dd>
          <dt>Senders</dt><dd>{formatCount(p.senders)}</dd>
          <dt>Last success</dt><dd>{p.lastSuccessAt ? new Date(p.lastSuccessAt).toLocaleString() : 'Never'}</dd>
          <dt>Last failure</dt><dd>{p.lastFailureAt ? `${new Date(p.lastFailureAt).toLocaleString()} · ${p.lastError || ''}` : 'None'}</dd>
          <dt>Status webhook</dt><dd>{p.webhooks.status || 'Set SMS_WEBHOOK_BASE_URL or BACKEND_URL on the server'}</dd>
          <dt>Inbound webhook</dt>
          <dd>{p.webhooks.inbound ? `${p.webhooks.inbound}${p.webhooks.inboundNeedsToken ? '?t=… (run scripts/sms-webhook-urls.js on the server for the token)' : ''}` : '—'}</dd>
        </dl>
        <div className="fx-row gap-2">
          {['transactional', 'marketing'].map((cls) => (
            <label key={cls} className="es-smscheck">
              <input type="checkbox" checked={classes.has(cls)} disabled={!canEdit || busy} onChange={() => toggleClass(cls)} />
              <span className="capitalize">{cls}</span>
            </label>
          ))}
        </div>
        {canEdit && (
          <form className="fx-row items-end gap-3" onSubmit={(e) => { e.preventDefault(); run(() => patch(`/admin/sms/providers/${p.id}`, { priority: Number(priority), maxTps: Number(maxTps) }, { noRedirect: true }), 'Saved.'); }}>
            <div className="w-32"><Field label="Priority" type="number" min={0} max={1000} value={priority} onChange={(e) => setPriority(e.target.value)} /></div>
            <div className="w-32"><Field label="Messages / sec" type="number" min={1} max={1000} value={maxTps} onChange={(e) => setMaxTps(e.target.value)} /></div>
            <button type="submit" className="es-btn es-btn--secondary es-btn--sm" disabled={busy}>Save</button>
          </form>
        )}
        {canEdit && <ProviderCredentials provider={p} onChanged={onChanged} />}
        {canEdit && p.credentials.configured && (
          <div className="fx-row items-center gap-3">
            <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy || sync.running}
              onClick={() => run(() => post(`/admin/sms/providers/${p.id}/sync-pricing`, {}, { noRedirect: true }), 'Price sync started for every country.')}>
              <NavIcon name="refresh" size={16} />Sync prices for all countries
            </button>
            {sync.total && (
              <span className="text-xs text-subtle">
                {sync.running ? `Running: ${sync.done}/${sync.total}` : `Last sync ${sync.finishedAt ? new Date(sync.finishedAt).toLocaleString() : ''}: ${sync.available} priced, ${sync.failed} failed`}
              </span>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function Providers() {
  const { user } = useAuth();
  const canEdit = Boolean(user?.isSuperAdmin);
  const { data, error, loading, reload } = useApi('/admin/sms/providers', { raw: true });
  const list = data?.data || [];
  const meta = data?.meta || {};

  return (
    <SmsPage icon="send" title="Provider management"
      lede="Which providers carry Eventsli's texts, in what order, and how fast. Credentials stay on the server.">
      {meta.dryRun && (
        <Notice tone="warning" title="Dry run is on.">
          <p>SMS_DRY_RUN is set: every send is logged instead of delivered. It cannot be on in production.</p>
        </Notice>
      )}
      {meta.webhookBaseConfigured === false && (
        <Notice tone="warning" title="Delivery receipts cannot reach this server.">
          <p>Set SMS_WEBHOOK_BASE_URL (or BACKEND_URL) to the public API address. Without it, messages show as sent but never as delivered.</p>
        </Notice>
      )}
      {error ? <ErrorNotice error={error} onRetry={reload} /> : loading && !data ? <Loading variant="list" rows={2} label="Loading providers" /> : (
        <div className="es-smsgrid es-smsgrid--even">
          {list.map((p) => <ProviderCard key={`${p.id}:${p.priority}:${p.maxTps}`} p={p} canEdit={canEdit} onChanged={reload} />)}
        </div>
      )}
    </SmsPage>
  );
}
