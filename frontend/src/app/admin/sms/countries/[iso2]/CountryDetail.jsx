'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post, patch } from '../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../utils/errors';
import { useApi } from '../../../../hooks/useApi';
import { useAuth } from '../../../../hooks/useAuth';
import { useToast } from '../../../../components/ui/Toast';
import { useConfirm } from '../../../../components/ui/Confirm';
import { Panel } from '../../../../components/ui/Page';
import Field, { SelectField, TextareaField } from '../../../../components/forms/Field';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice, Notice } from '../../../../components/Feedback';
import { SENDER_SUPPORT, MISSING_LABEL, describeActivity, relativeTime } from '../../../../lib/smsFormat';
import { SmsPage, StatusPill } from '../../smsUi';
import RouteEditor from './RouteEditor';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One country: its rules, its routes, and the record of who verified it.
 *
 * The order on the page is the order of the work: read the provider's
 * guidelines (linked), record the sender rules and restrictions, verify a
 * route per provider, then record the verification — and only then can the
 * switch at the top turn it on.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SUPPORT_OPTIONS = Object.entries(SENDER_SUPPORT);
const HOURS = [['', 'Platform default'], ...Array.from({ length: 24 }, (_, h) => [String(h), `${String(h).padStart(2, '0')}:00`])];

function RulesForm({ country, canEdit, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({
    senderIdSupport: country.senderIdSupport,
    requiresSenderRegistration: country.requiresSenderRegistration,
    marketingAllowed: country.marketingAllowed,
    doubleOptInRequired: country.doubleOptInRequired,
    quietHoursStart: country.quietHoursStart == null ? '' : String(country.quietHoursStart),
    quietHoursEnd: country.quietHoursEnd == null ? '' : String(country.quietHoursEnd),
    restrictions: country.restrictions || '',
    maxDailyMessages: country.maxDailyMessages == null ? '' : String(country.maxDailyMessages),
    timezone: country.timezone,
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    if ((f.quietHoursStart === '') !== (f.quietHoursEnd === '')) {
      toast.error('Set both ends of the quiet window, or neither.');
      return;
    }
    setBusy(true);
    try {
      await patch(`/admin/sms/countries/${country.iso2}`, {
        ...f,
        quietHoursStart: f.quietHoursStart === '' ? null : Number(f.quietHoursStart),
        quietHoursEnd: f.quietHoursEnd === '' ? null : Number(f.quietHoursEnd),
        maxDailyMessages: f.maxDailyMessages === '' ? null : Number(f.maxDailyMessages),
        restrictions: f.restrictions.trim() || null,
      }, { noRedirect: true });
      toast.success('Rules saved.');
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="fx-stack">
      <fieldset disabled={!canEdit || busy} className="es-smsform">
        <SelectField label="Sender ID rules" value={f.senderIdSupport} onChange={set('senderIdSupport')}
          options={SUPPORT_OPTIONS} hint="From the provider's country guidelines" />
        <Field label="Time zone (for quiet hours)" value={f.timezone} onChange={set('timezone')} hint="IANA name" />
        <SelectField label="Quiet hours start" value={f.quietHoursStart} onChange={set('quietHoursStart')} options={HOURS} />
        <SelectField label="Quiet hours end" value={f.quietHoursEnd} onChange={set('quietHoursEnd')} options={HOURS} />
        <Field label="Daily message cap" type="number" min={1} value={f.maxDailyMessages} onChange={set('maxDailyMessages')} optional
          hint="Fraud ceiling; messages past it wait until tomorrow" />
        <div className="fx-stack fx-stack--sm">
          <label className="es-smscheck"><input type="checkbox" checked={f.requiresSenderRegistration} onChange={set('requiresSenderRegistration')} />
            <span>Every sender must be registered for this country</span></label>
          <label className="es-smscheck"><input type="checkbox" checked={f.marketingAllowed} onChange={set('marketingAllowed')} />
            <span>Marketing texts are allowed here</span></label>
          <label className="es-smscheck"><input type="checkbox" checked={f.doubleOptInRequired} onChange={set('doubleOptInRequired')} />
            <span>Marketing consent needs double opt-in (reply YES)</span></label>
        </div>
        <div className="es-smsform__wide">
          <TextareaField label="Restrictions" rows={3} value={f.restrictions} onChange={set('restrictions')} optional
            hint="Content rules, banned keywords, template pre-registration, sending windows…" />
        </div>
      </fieldset>
      {canEdit && <div><button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy}>Save rules</button></div>}
    </form>
  );
}

function VerifyForm({ country, onDone }) {
  const toast = useToast();
  const [source, setSource] = useState(country.verificationSource || '');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/admin/sms/countries/${country.iso2}/verify`, { source }, { noRedirect: true });
      toast.success(`${country.name} is verified. You can turn it on now.`);
      onDone();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="fx-stack fx-stack--sm">
      <Field label="What did you check?" value={source} onChange={(e) => setSource(e.target.value)} required minLength={5}
        hint="The guideline page you read, a provider ticket number, or the registration confirmation." />
      <div><button type="submit" className="es-btn es-btn--secondary es-btn--sm" disabled={busy}>Record verification</button></div>
    </form>
  );
}

export default function CountryDetail({ iso2 }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = Boolean(user?.isSuperAdmin);
  const { data: c, error, loading, reload } = useApi(`/admin/sms/countries/${iso2}`);
  const { data: providers } = useApi('/admin/sms/providers');
  const { data: senders } = useApi('/admin/sms/senders');
  const history = useApi(`/admin/sms/countries/${iso2}/history`);
  const [busy, setBusy] = useState(false);

  async function setStatus(status) {
    if (status !== 'enabled') {
      const ok = await confirm({ title: `${status === 'blocked' ? 'Block' : 'Turn off'} SMS to ${c.name}?`, body: <p>Queued messages for {c.name} will not be sent.</p>, confirmLabel: 'Confirm', tone: 'danger' });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await post(`/admin/sms/countries/${iso2}/status`, { status }, { noRedirect: true });
      toast.success(`SMS is ${status} for ${c.name}.`);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  async function unverify() {
    const answer = await confirm({
      title: `Withdraw the verification of ${c.name}?`,
      body: <p>It goes back to unverified and cannot be turned on until someone checks it again. Use this when the provider’s rules changed or a registration lapsed.</p>,
      reason: { label: 'Why?', minLength: 5, maxLength: 500 },
      confirmLabel: 'Withdraw verification', tone: 'danger',
    });
    if (!answer) return;
    try {
      await post(`/admin/sms/countries/${iso2}/unverify`, { reason: answer.reason }, { noRedirect: true });
      toast.success('Verification withdrawn.');
      reload();
      history.reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function resume() {
    try {
      await post(`/admin/sms/countries/${iso2}/resume`, {}, { noRedirect: true });
      toast.success('Sending resumed.');
      reload();
    } catch (err) {
      toast.error(messageFor(err));
    }
  }

  if (error) return <SmsPage icon="globe" title="Country"><ErrorNotice error={error} onRetry={reload} /></SmsPage>;
  if (loading || !c) return <SmsPage icon="globe" title="Country"><Loading variant="list" rows={6} label="Loading country" /></SmsPage>;

  const steps = [
    { ok: c.senderIdSupport !== 'unknown', key: 'sender_rules' },
    { ok: !c.missing.includes('verified_route'), key: 'verified_route' },
    { ok: Boolean(c.verifiedAt), key: 'verification' },
  ];

  return (
    <SmsPage icon="globe" title={`${c.name} (+${c.dialCode})`}
      lede={<>{c.region} · {c.timezone} · <Link href="/admin/sms/countries" className="text-accent">All countries</Link></>}
      actions={canEdit && (
        c.status === 'enabled'
          ? <button type="button" className="es-btn es-btn--secondary" disabled={busy} onClick={() => setStatus('disabled')}>Turn off SMS</button>
          : <button type="button" className="es-btn es-btn--primary" disabled={busy || !c.readyToEnable || c.status === 'blocked'} onClick={() => setStatus('enabled')}>Turn on SMS</button>
      )}>
      <div className="fx-row items-center gap-3">
        <StatusPill status={c.status} map="country" />
        {c.verifiedAt && <span className="text-sm text-muted">Verified {new Date(c.verifiedAt).toLocaleDateString()} · {c.verificationSource}</span>}
      </div>

      {c.pausedUntil && (
        <Notice tone="warning" title="Sending is paused automatically." action={canEdit && <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={resume}>Resume now</button>}>
          <p>Unusual traffic ({c.pausedReason?.replace(/_/g, ' ')}) until {new Date(c.pausedUntil).toLocaleTimeString()}. Check the delivery log before resuming.</p>
        </Notice>
      )}

      <div className="es-smsgrid">
        <div className="fx-stack">
          <Panel icon="shield" title="Rules for this country" description="Record what the provider guidelines say. Nothing here is pre-filled.">
            <RulesForm key={c.updatedAt} country={c} canEdit={canEdit} onSaved={reload} />
          </Panel>
          <Panel icon="send" title="Provider routes" description="A route is used only once it is verified and active.">
            <RouteEditor country={c} providers={providers || []} senders={senders || []} canEdit={canEdit} onSaved={reload} />
          </Panel>
        </div>
        <div className="fx-stack">
          <Panel icon="check" title="Before it can be turned on">
            <ul className="es-smssteps">
              {steps.map((s) => (
                <li key={s.key} data-ok={s.ok ? '' : undefined}><NavIcon name={s.ok ? 'tick' : 'clock'} size={16} />{MISSING_LABEL[s.key]}</li>
              ))}
            </ul>
            {canEdit && !c.verifiedAt && c.senderIdSupport !== 'unknown' && !c.missing.includes('verified_route') && (
              <div className="mt-4"><VerifyForm country={c} onDone={() => { reload(); history.reload(); }} /></div>
            )}
            {c.reviewDue && <p className="mt-3 text-sm text-warning">Verified over a year ago. Re-read the provider guidelines and verify again.</p>}
            {canEdit && c.verifiedAt && c.status !== 'enabled' && (
              <button type="button" className="es-btn es-btn--ghost es-btn--sm mt-3" onClick={unverify}>Withdraw verification</button>
            )}
          </Panel>
          <Panel icon="clock" title="History" description="Rules, routes, verification and switches, newest first.">
            {(history.data || []).length === 0 ? <p className="text-sm text-muted">No changes recorded yet.</p> : (
              <ol className="es-smsfeed">
                {history.data.slice(0, 12).map((h) => (
                  <li key={h.id}>
                    <span className="es-smsfeed__text">{describeActivity(h.action, h.payload)}{h.actor ? ` · ${h.actor}` : ''}</span>
                    <time className="es-smsfeed__time" dateTime={h.at}>{relativeTime(h.at)}</time>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <Panel icon="external" title="Provider guidelines" description="Read these before recording anything.">
            <ul className="fx-stack fx-stack--sm">
              {(c.guidelines || []).map((g) => (
                <li key={g.providerId}>
                  <a href={g.url} target="_blank" rel="noopener noreferrer" className="text-accent capitalize">{g.providerId} guidelines for {c.name}</a>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </SmsPage>
  );
}
