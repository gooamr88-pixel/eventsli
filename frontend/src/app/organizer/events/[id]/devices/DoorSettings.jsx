'use client';

import { useEffect, useState } from 'react';
import { get, patch } from '../../../../utils/apiClient';
import { messageFor } from '../../../../utils/errors';
import { useToast } from '../../../../components/ui/Toast';
import { Panel } from '../../../../components/ui/Page';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What the door may see and do in the Eventsli Check-in app.
 *
 * The defaults keep the door team where it has always been — scan, undo, gate
 * status, no guest list — so installing the app widens nobody's access until
 * the organizer chooses to. The organizer's own phone always sees everything.
 *
 * Each switch saves on its own. A door setting is changed a minute before the
 * doors open, from a phone; a form with a Save button at the bottom is a
 * setting somebody believes they changed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SWITCHES = [
  {
    key: 'doorTeamCanViewGuests',
    label: 'Door team can search the guest list',
    hint: 'Lets door-team members and shared tablets look guests up by name and check them in by hand. Off: they scan, and see first names only.',
  },
  {
    key: 'offlineAdmission',
    label: 'Admit guests with no signal',
    hint: 'Devices keep an encrypted copy of this event’s tickets and decide on the spot when the venue’s connection drops. Scans upload when it returns.',
  },
  {
    key: 'offlineShowNames',
    label: 'Include names in that offline copy',
    hint: 'Off: offline answers show the ticket type and seat, not the guest’s name. Your own phone always has names.',
    requires: 'offlineAdmission',
  },
];

export default function DoorSettings({ eventId }) {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    get(`/events/${eventId}/gate-settings`, { cache: 'no-store' })
      .then((s) => { if (!cancelled) setSettings(s); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [eventId]);

  async function save(key, value) {
    const before = settings;
    setSettings({ ...settings, [key]: value });   // optimistic: a switch must move when pressed
    setSaving(key);
    try {
      setSettings(await patch(`/events/${eventId}/gate-settings`, { [key]: value }, { noRedirect: true }));
      toast.success('Door settings saved.');
    } catch (err) {
      setSettings(before);
      toast.error(messageFor(err));
    } finally {
      setSaving(null);
    }
  }

  // The rest of the page works without this card; a failure to load it is
  // said in one line rather than taking the devices list down with it.
  if (failed) {
    return <p className="text-sm text-muted">Door settings could not be loaded. Reload the page to try again.</p>;
  }
  if (!settings) return null;

  return (
    <Panel
      icon="shield"
      title="Check-in app"
      description="What the door can see and do in the Eventsli Check-in app."
    >
      <ul className="fx-stack fx-stack--sm">
        {SWITCHES.map((s) => {
          const off = s.requires && !settings[s.requires];
          const id = `door-${s.key}`;
          return (
            <li key={s.key} className={`fx-row items-start gap-3 ${off ? 'opacity-50' : ''}`}>
              <input
                id={id}
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-(--es-accent)"
                checked={Boolean(settings[s.key]) && !off}
                disabled={Boolean(off) || saving === s.key}
                onChange={(e) => save(s.key, e.target.checked)}
              />
              <label htmlFor={id} className="fx-min0 fx-stack gap-0.5">
                <span className="text-ink">{s.label}</span>
                <span className="text-sm text-muted">{s.hint}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {settings.offlineAdmission && (
        <fieldset className="fx-stack fx-stack--sm border-t border-border-base pt-3">
          <legend className="text-sm text-ink">Tickets emailed before signed codes</legend>
          <p className="text-sm text-muted">
            Older ticket codes cannot be checked for forgery without a connection. A device can
            still match them against its ticket list.
          </p>
          {[
            ['allow', 'Admit them if they match the ticket list'],
            ['hold', 'Hold them until the connection returns'],
          ].map(([value, label]) => (
            <label key={value} className="fx-row items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="legacyQrOffline"
                value={value}
                checked={settings.legacyQrOffline === value}
                disabled={saving === 'legacyQrOffline'}
                onChange={() => save('legacyQrOffline', value)}
                className="accent-(--es-accent)"
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}
    </Panel>
  );
}
