'use client';

import { useState } from 'react';
import { useApi } from '../../../hooks/useApi';
import { put, get } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useToast } from '../../ui/Toast';
import { Panel } from '../../ui/Page';
import { Loading, ErrorNotice, Notice } from '../../Feedback';
import Field, { TextareaField } from '../../forms/Field';
import NavIcon from '../../shell/NavIcon';
import SocialIcon from '../../vendors/booking/SocialIcon';
import { displayPhone } from '../vipStatus';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services settings (2026-11-28): first the WhatsApp connection — what
 * is set on the server, a live check against Meta, and the exact values to
 * paste into Meta's dashboard — then what organizers see and who is emailed.
 * Every admin reads it; a super admin changes it (the API enforces that).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const TEMPLATE_BODY = 'Hi {{1}}, there is an update on your Eventsli VIP request {{2}}:\n\n{{3}}\n\nReply here to continue with our team, or open the request in your Eventsli dashboard.';

export default function VipSettingsForm({ canEdit }) {
  const { data, error, loading, reload } = useApi('/admin/vip/settings');
  if (loading) return <Loading variant="card" label="Loading the settings" />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  return (
    <div className="fx-stack">
      {canEdit && <Connection />}
      <Form key={JSON.stringify(data.settings)} initial={data.settings} canEdit={canEdit} onSaved={reload} />
    </div>
  );
}

function Copy({ value, label }) {
  const toast = useToast();
  return (
    <button type="button" className="es-vipcopy" onClick={() => navigator.clipboard?.writeText(value).then(() => toast.success(`${label} copied.`))}>
      <code className="fx-break">{value}</code>
      <NavIcon name="copy" size={14} />
    </button>
  );
}

function Connection() {
  const { data, error, loading, reload } = useApi('/admin/vip/connection');
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState(null);

  async function test() {
    setChecking(true);
    try {
      const res = await get('/admin/vip/connection', { cache: 'no-store' });
      setCheck(res.check || { ok: false, error: 'Sending is not set up yet.' });
    } catch (err) {
      setCheck({ ok: false, error: messageFor(err) });
    } finally {
      setChecking(false);
    }
  }

  if (loading) return <Loading variant="card" label="Checking WhatsApp" />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  const live = data.sending && data.receiving;
  const result = check || data.check;

  return (
    <Panel
      title="WhatsApp Business connection"
      description="Meta's WhatsApp Cloud API. Without it, organizers still reach the team through WhatsApp links and email; with it, every message is kept here and replies go out from the console."
      icon="link"
      iconTile
    >
      <div className="es-vipconn">
        <p className={`es-vipconn__state${live ? ' is-live' : ''}`}>
          <SocialIcon name="whatsapp" size={18} />
          {live ? (data.dryRun ? 'Connected — DRY RUN, nothing is sent' : 'Connected: sending and receiving')
            : data.sending ? 'Sending only: incoming messages are refused until the webhook secret is set'
              : 'Not connected yet'}
        </p>
        {data.missing.length > 0 && (
          <p className="text-sm text-subtle">Missing on the server: {data.missing.map((m) => <code key={m} className="es-vipconn__env">{m}</code>)}</p>
        )}
        {data.sending && (
          <div className="fx-row fx-row--gap">
            <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={test} disabled={checking}>
              <NavIcon name="refresh" size={16} /> {checking ? 'Checking…' : 'Test the connection'}
            </button>
            {result && (result.ok
              ? <span className="text-sm">Meta says: <b>{result.name || 'No display name yet'}</b> · {result.number}{result.quality ? ` · quality ${result.quality}` : ''}{result.nameStatus ? ` · name ${result.nameStatus.toLowerCase().replace(/_/g, ' ')}` : ''}</span>
              : <span className="text-sm text-danger">{result.error}</span>)}
          </div>
        )}

        <dl className="es-vipconn__steps">
          <div>
            <dt>Webhook URL <small>(Meta app › WhatsApp › Configuration)</small></dt>
            <dd>{data.webhookUrl ? <Copy value={data.webhookUrl} label="The webhook URL" /> : <span className="text-sm text-subtle">Set BACKEND_URL on the server to see it.</span>}</dd>
          </div>
          <div>
            <dt>Verify token</dt>
            <dd className="text-sm">The value of <code>WHATSAPP_VERIFY_TOKEN</code> on the server, typed into the same form.</dd>
          </div>
          <div>
            <dt>Webhook fields to subscribe</dt>
            <dd className="text-sm"><code>messages</code>, and <code>smb_message_echoes</code> if the team also uses the WhatsApp Business app on the phone.</dd>
          </div>
          <div>
            <dt>Message template <small>(WhatsApp Manager › Message templates)</small></dt>
            <dd className="fx-stack fx-stack--sm">
              <span className="text-sm">Name <Copy value={data.updateTemplate} label="The template name" /> · Category <b>Utility</b> · Language <b>{data.templateLanguage}</b></span>
              <Copy value={TEMPLATE_BODY} label="The template text" />
              <span className="text-sm text-subtle">Sample values for Meta&rsquo;s review: Sara · VIP-7KQ2MX · Our team is reviewing your request now.</span>
            </dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}

function Form({ initial, canEdit, onSaved }) {
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [emails, setEmails] = useState((initial.notifyEmails || []).join(', '));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setS((cur) => ({ ...cur, [k]: v }));
  const setService = (key, patch) => setS((cur) => ({ ...cur, services: cur.services.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await put('/admin/vip/settings', {
        settings: { ...s, notifyEmails: emails.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) },
      });
      toast.success('Saved.');
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="fx-stack" onSubmit={save}>
      {!canEdit && <Notice tone="info" title="Only a super admin changes these.">You can read them.</Notice>}
      <fieldset disabled={!canEdit} className="fx-stack">
        <Panel title="What organizers see" icon="crown" iconTile>
          <div className="fx-stack">
            <label className="es-demo-admin__check">
              <input type="checkbox" checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Taking new requests
            </label>
            <div className="es-vipform__grid">
              <Field label="WhatsApp number" value={s.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value)} maxLength={20}
                hint={`With the country code. Shown as ${displayPhone(s.whatsappNumber) || '…'}. The WhatsApp Business number the team answers.`} />
              <Field label="Email" type="email" value={s.email} onChange={(e) => set('email', e.target.value)} maxLength={254} hint="Shown to organizers, and the reply-to on our emails." />
            </div>
            <Field label="Reply-time promise" value={s.responseTime} onChange={(e) => set('responseTime', e.target.value)} maxLength={160} optional />
          </div>
        </Panel>

        <Panel title="Services" description="Switch a service off to stop offering it. Words are what organizers read." icon="sparkle" iconTile>
          <ul className="es-vipsettings__services">
            {s.services.map((x) => (
              <li key={x.key}>
                <label className="es-demo-admin__check">
                  <input type="checkbox" checked={x.enabled} onChange={(e) => setService(x.key, { enabled: e.target.checked })} />
                  <NavIcon name={x.icon} size={18} /> Offered
                </label>
                <Field label="Name" value={x.title} onChange={(e) => setService(x.key, { title: e.target.value })} maxLength={60} />
                <TextareaField label="One line about it" rows={2} value={x.blurb} onChange={(e) => setService(x.key, { blurb: e.target.value })} maxLength={200} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Who is emailed" description="About each new request, a message written on the dashboard, and the first WhatsApp message after a quiet half hour." icon="mail" iconTile>
          <div className="fx-stack">
            <label className="es-demo-admin__check">
              <input type="checkbox" checked={s.notifyAdmins} onChange={(e) => set('notifyAdmins', e.target.checked)} /> Every admin
            </label>
            <Field label="Also these addresses" value={emails} onChange={(e) => setEmails(e.target.value)} hint="Separated by commas. Up to 10." />
          </div>
        </Panel>
        {canEdit && (
          <div>
            <button type="submit" className="es-btn es-btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
