'use client';

import { useState } from 'react';
import { patch } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useApi } from '../../../hooks/useApi';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { Panel } from '../../../components/ui/Page';
import Field from '../../../components/forms/Field';
import { Loading, ErrorNotice, Notice } from '../../../components/Feedback';
import { microsToInput, parseMicros } from '../../../lib/smsFormat';
import { SmsPage, Toggle } from '../smsUi';
import Suppressions from './Suppressions';
import ConsentTools from './ConsentTools';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Compliance: the global switch, the opt-out wording, quiet hours, fraud and
 * spend limits; the suppression list; consent records.
 *
 * Transactional and marketing traffic are kept apart everywhere else (separate
 * categories, separate senders, consent only for marketing); this page holds
 * the rules both obey.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function SettingsForm({ s, canEdit, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState(() => ({
    brandName: s.brandName, optOutText: s.optOutText, helpText: s.helpText, replyToHelp: s.replyToHelp,
    defaultQuietStart: String(s.defaultQuietStart), defaultQuietEnd: String(s.defaultQuietEnd),
    countryHourlyLimit: String(s.countryHourlyLimit), cap: microsToInput(s.dailyMarketingCapMicros),
    spendCurrency: s.spendCurrency, reminderHoursBefore: String(s.reminderHoursBefore), maxCampaignRecipients: String(s.maxCampaignRecipients),
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function send(body, done) {
    setBusy(true);
    try {
      await patch('/admin/sms/settings', body, { noRedirect: true });
      toast.success(done);
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  async function toggleSending(on) {
    const ok = await confirm({
      title: on ? 'Start sending SMS?' : 'Stop all SMS?',
      body: on
        ? <p>Queued messages start going out to every enabled country. Messages past their expiry are dropped, not sent late.</p>
        : <p>Nothing more is sent until this is turned back on. Messages keep queueing.</p>,
      confirmLabel: on ? 'Start sending' : 'Stop sending', tone: on ? undefined : 'danger',
    });
    if (ok) send({ sendingEnabled: on }, on ? 'Sending is on.' : 'Sending is stopped.');
  }

  function save(e) {
    e.preventDefault();
    const cap = f.cap.trim() === '' ? null : parseMicros(f.cap);
    if (f.cap.trim() !== '' && cap == null) { toast.error('The budget must be a number.'); return; }
    send({
      brandName: f.brandName.trim(), optOutText: f.optOutText.trim(), helpText: f.helpText.trim(), replyToHelp: f.replyToHelp,
      defaultQuietStart: Number(f.defaultQuietStart), defaultQuietEnd: Number(f.defaultQuietEnd),
      countryHourlyLimit: Number(f.countryHourlyLimit), dailyMarketingCapMicros: cap, spendCurrency: f.spendCurrency.trim(),
      reminderHoursBefore: Number(f.reminderHoursBefore), maxCampaignRecipients: Number(f.maxCampaignRecipients),
    }, 'Compliance settings saved.');
  }

  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--between items-center gap-3 rounded-(--es-radius-md) bg-bg-sunken p-4">
        <div>
          <p className="font-semibold text-ink">Sending is {s.sendingEnabled ? 'ON' : 'OFF'}</p>
          <p className="text-sm text-muted">The platform-wide kill switch. Off: messages queue, nothing leaves.</p>
        </div>
        <Toggle label="Sending enabled" checked={s.sendingEnabled} disabled={!canEdit || busy} onChange={toggleSending} />
      </div>
      <form onSubmit={save} className="fx-stack">
        <fieldset disabled={!canEdit || busy} className="es-smsform">
          <Field label="Brand name" value={f.brandName} onChange={set('brandName')} maxLength={30} hint="Starts every marketing text" />
          <Field label="Opt-out line" value={f.optOutText} onChange={set('optOutText')} maxLength={60} hint="Added to every marketing text; must contain STOP" />
          <div className="es-smsform__wide">
            <Field label="HELP reply" value={f.helpText} onChange={set('helpText')} maxLength={160} />
            <label className="es-smscheck mt-2"><input type="checkbox" checked={f.replyToHelp} onChange={set('replyToHelp')} />
              <span>Answer HELP with this text (leave off if the provider already answers it, e.g. Twilio Advanced Opt-Out)</span></label>
          </div>
          <Field label="Default quiet hours start" type="number" min={0} max={23} value={f.defaultQuietStart} onChange={set('defaultQuietStart')} hint="Recipient's local hour" />
          <Field label="Default quiet hours end" type="number" min={0} max={23} value={f.defaultQuietEnd} onChange={set('defaultQuietEnd')} />
          <Field label="Pause a country above (messages / hour)" type="number" min={1} value={f.countryHourlyLimit} onChange={set('countryHourlyLimit')}
            hint="Non-campaign traffic. Guards against SMS pumping fraud." />
          <Field label="Daily marketing budget" inputMode="decimal" value={f.cap} onChange={set('cap')} optional hint="Empty: no cap. Transactional texts are never capped." />
          <Field label="Budget currency" value={f.spendCurrency} onChange={set('spendCurrency')} maxLength={3} />
          <Field label="Event reminder (hours before)" type="number" min={1} max={168} value={f.reminderHoursBefore} onChange={set('reminderHoursBefore')} />
          <Field label="Most recipients per campaign" type="number" min={1} value={f.maxCampaignRecipients} onChange={set('maxCampaignRecipients')} />
        </fieldset>
        {canEdit && <div><button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy}>Save settings</button></div>}
      </form>
    </div>
  );
}

export default function Compliance() {
  const { user } = useAuth();
  const canEdit = Boolean(user?.isSuperAdmin);
  const { data, error, loading, reload } = useApi('/admin/sms/settings');

  return (
    <SmsPage icon="shield" title="Compliance settings"
      lede="Consent, opt-outs, suppression, quiet hours and the limits that keep traffic honest.">
      <Notice tone="info" title="How Eventsli keeps the two kinds of traffic apart">
        <p>Transactional texts (tickets, reminders, changes) go only to the buyer of an order. Marketing texts need recorded consent, carry the brand and an opt-out, respect quiet hours, need a second admin, and use marketing senders. A STOP reply stops both.</p>
      </Notice>
      <Panel icon="settings" title="Platform rules">
        {error ? <ErrorNotice error={error} onRetry={reload} /> : loading || !data ? <Loading variant="list" rows={4} label="Loading settings" />
          : <SettingsForm key={data.updatedAt} s={data} canEdit={canEdit} onSaved={reload} />}
      </Panel>
      <div className="es-smsgrid es-smsgrid--even">
        <Panel icon="ban" title="Suppression list" description="Numbers that receive nothing (or no marketing).">
          <Suppressions canSuper={canEdit} />
        </Panel>
        <Panel icon="users" title="Consent records" description="Look up a number, or import consent collected elsewhere.">
          <ConsentTools canSuper={canEdit} />
        </Panel>
      </div>
    </SmsPage>
  );
}
