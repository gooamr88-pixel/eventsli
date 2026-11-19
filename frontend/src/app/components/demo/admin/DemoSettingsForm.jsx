'use client';

import { useState } from 'react';
import { useApi } from '../../../hooks/useApi';
import { put } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useToast } from '../../ui/Toast';
import { Panel } from '../../ui/Page';
import { Loading, ErrorNotice } from '../../Feedback';
import Field, { TextareaField } from '../../forms/Field';
import { zoneLabel } from '../../../lib/demoTime';
import { useZones } from '../TimezoneSelect';
import { WeeklyHoursEditor, BlockedDatesEditor, TextListEditor } from './DemoHoursEditor';
import DemoFormEditor from './DemoFormEditor';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything the public Book a demo page does (2026-11-19). One Save for the
 * lot; the API cleans what it gets (clamps numbers, merges hours, drops a
 * list question with no answers) and sends back what it stored, which
 * replaces the form — so what you see after saving is what is live.
 *
 * Every admin can read it; only a super admin can change it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function DemoSettingsForm({ canEdit }) {
  const { data, error, loading, reload } = useApi('/admin/demo/settings');
  if (loading) return <Loading rows={5} label="Loading the settings" />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  return <Form key={JSON.stringify(data.settings)} initial={data.settings} canEdit={canEdit} onSaved={reload} />;
}

function NumberField({ label, hint, value, onChange, min, max }) {
  return (
    <Field label={label} hint={hint} type="number" inputMode="numeric" min={min} max={max} step={1}
      value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
  );
}

function Form({ initial, canEdit, onSaved }) {
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const zones = useZones(s.timezone);
  const set = (key) => (value) => setS((cur) => ({ ...cur, [key]: value }));
  const text = (key) => (e) => set(key)(e.target.value);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  async function save() {
    setBusy(true);
    try {
      await put('/admin/demo/settings', { settings: s });
      toast.success('Saved. The public page shows the change now.');
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="fx-stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {!canEdit && <p className="es-demo-card__notice">Only a super admin can change these settings. You can read them.</p>}
      <fieldset disabled={!canEdit || busy} className="fx-stack es-demo-admin__fieldset">
        <Panel title="The page" description="What people read on /demo and in their confirmation." icon="monitor">
          <div className="fx-stack">
            <label className="es-demo-admin__check es-demo-admin__switch">
              <input type="checkbox" checked={s.enabled} onChange={(e) => set('enabled')(e.target.checked)} />
              <span><b>Take bookings</b> — when off, the page asks people to email you instead.</span>
            </label>
            <Field label="Heading" maxLength={80} value={s.title} onChange={text('title')} />
            <TextareaField label="Introduction" rows={3} maxLength={1000} value={s.intro} onChange={text('intro')} />
            <TextareaField label="Message after booking" hint="Shown on the page and at the top of their confirmation email." rows={2} maxLength={600}
              value={s.confirmationMessage} onChange={text('confirmationMessage')} />
            <div className="es-demo-admin__two">
              <Field label="Contact phone" optional type="tel" maxLength={30} value={s.contactPhone} onChange={text('contactPhone')} />
              <Field label="Contact email" type="email" maxLength={254} value={s.contactEmail} onChange={text('contactEmail')} hint="Shown on the page; replies to booking emails go here." />
            </div>
          </div>
        </Panel>

        <Panel title="Demos" description="How long they are, and the rules for booking one." icon="clock">
          <div className="fx-stack">
            <div className="es-demo-admin__three">
              <NumberField label="Length (minutes)" min={10} max={180} value={s.durationMinutes} onChange={set('durationMinutes')} />
              <NumberField label="Start one every (minutes)" hint="Usually the same as the length." min={5} max={180} value={s.intervalMinutes} onChange={set('intervalMinutes')} />
              <NumberField label="Break between demos (minutes)" min={0} max={120} value={s.bufferMinutes} onChange={set('bufferMinutes')} />
              <NumberField label="Book at least (hours ahead)" min={0} max={720} value={s.minNoticeHours} onChange={set('minNoticeHours')} />
              <NumberField label="Book up to (days ahead)" min={1} max={365} value={s.maxDaysAhead} onChange={set('maxDaysAhead')} />
              <NumberField label="Demos at the same time" hint="More than one if several of you run demos." min={1} max={20} value={s.capacity} onChange={set('capacity')} />
              <NumberField label="Most demos in a day" hint="0 for no limit." min={0} max={100} value={s.dailyLimit} onChange={set('dailyLimit')} />
            </div>
            <div className="fx-stack fx-stack--sm gap-1.5">
              <label htmlFor="demo-zone" className="es-demo-admin__label">Your time zone <span>(the hours below are in it)</span></label>
              <select id="demo-zone" className="es-input" value={s.timezone} onChange={text('timezone')}>
                {zones.map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}
              </select>
            </div>
            <div className="es-demo-admin__two">
              <Field label="Video call link for every demo" optional type="url" placeholder="https://meet.google.com/…" maxLength={1000}
                value={s.meetingLink} onChange={text('meetingLink')} hint="Leave empty to add a link to each booking yourself." />
              <Field label="Note when there is no link yet" optional maxLength={300} value={s.meetingNote} onChange={text('meetingNote')} />
            </div>
          </div>
        </Panel>

        <Panel title="Opening hours" description={`When people can book, in ${zoneLabel(s.timezone)}.`} icon="calendar">
          <WeeklyHoursEditor value={s.weeklyHours} onChange={set('weeklyHours')} />
          <p className="es-demo-admin__label es-demo-admin__gap">Days off</p>
          <BlockedDatesEditor value={s.blockedDates} onChange={set('blockedDates')} />
        </Panel>

        <Panel title="The form" description="What people fill in after choosing a time." icon="list">
          <DemoFormEditor settings={s} onChange={setS} />
        </Panel>

        <Panel title="Emails" description="Who hears about bookings, and the reminder before a demo." icon="mail">
          <div className="fx-stack">
            <label className="es-demo-admin__check">
              <input type="checkbox" checked={s.notifyAdmins} onChange={(e) => set('notifyAdmins')(e.target.checked)} />
              Email every admin about each new, moved or cancelled demo
            </label>
            <div>
              <p className="es-demo-admin__label">Also email</p>
              <TextListEditor type="email" value={s.notifyEmails} onChange={set('notifyEmails')} placeholder="sales@yourcompany.com" addLabel="Add" max={10} />
            </div>
            <NumberField label="Reminder email (hours before)" hint="0 to send none." min={0} max={168} value={s.reminderHours} onChange={set('reminderHours')} />
          </div>
        </Panel>
      </fieldset>

      {canEdit && (
        <div className="es-demo-admin__savebar">
          <button type="submit" className="es-btn es-btn--primary" disabled={!dirty || busy} aria-busy={busy || undefined}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
          {dirty && <button type="button" className="es-btn es-btn--ghost" onClick={() => setS(initial)} disabled={busy}>Undo changes</button>}
        </div>
      )}
    </form>
  );
}
