'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get, post, patch } from '../../../../utils/apiClient';
import { messageFor } from '../../../../utils/errors';
import { formatEventTime } from '../../../../lib/eventTime';
import { useToast } from '../../../../components/ui/Toast';
import { useConfirm } from '../../../../components/ui/Confirm';
import { SectionHeader, Panel } from '../../../../components/ui/Page';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, Empty, ErrorNotice, Notice } from '../../../../components/Feedback';
import { useEventContext } from '../EventContext';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Scanning devices. DEVICES, NOT PEOPLE.
 *
 * Door staff share a tablet and change between shifts, so a device is
 * registered once, given a PIN, and is its own principal. A lost tablet is
 * revoked without touching anyone's account — and revoking is a FLAG, not a
 * delete, because the scans it recorded have to keep pointing somewhere.
 *
 * THE PIN IS SHOWN EXACTLY ONCE; it is stored hashed. THE DEVICE ID IS NOT
 * SECRET and is always listed, with a copy button: the gate sign-in needs it,
 * and it used to vanish with the "registered" banner, leaving an organizer no
 * way to sign a tablet in short of registering a new one.
 *
 * Revoking stops that door at once, so it asks first.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Devices({ eventId }) {
  const timezone = useEventContext()?.event?.timezone;
  const [devices, setDevices] = useState(null);
  const [gate, setGate] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [created, setCreated] = useState(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, status] = await Promise.all([
          get(`/events/${eventId}/scan-devices`, { cache: 'no-store' }),
          get(`/events/${eventId}/gate`, { cache: 'no-store' }).catch(() => null),
        ]);
        if (!cancelled) {
          setDevices(Array.isArray(list) ? list : []);
          setGate(status);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reload]);

  const refresh = () => setReload((n) => n + 1);

  if (error) return <ErrorNotice error={error} />;
  if (!devices) return <Loading variant="list" label="Loading devices" />;

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Scanning devices"
        lede="Each shared tablet or phone that scans at the door. Staff sign it in with the device ID and its PIN, so a shift change needs nothing."
        actions={!adding && (
          <button type="button" className="es-btn es-btn--primary" onClick={() => setAdding(true)}>
            Register a device
          </button>
        )}
      />
      <p className="text-sm text-muted">
        For named people who scan with their own account, use the{' '}
        <Link href={`/organizer/events/${eventId}/staff`} className="text-accent underline">door team</Link>.
      </p>

      <GateBanner gate={gate} eventId={eventId} />

      {created && (
        <Notice tone="info" title={`“${created.label}” is registered`}>
          <dl className="fx-stack fx-stack--sm text-sm">
            <div>
              <dt className="text-muted">PIN — shown this once</dt>
              <dd className="font-mono text-2xl text-ink">{created.pin}</dd>
            </div>
          </dl>
          <p>Write the PIN down now. It is stored hashed and cannot be shown again. The device ID stays in the list below.</p>
          <div>
            <button type="button" onClick={() => setCreated(null)} className="es-btn es-btn--secondary es-btn--sm">
              I have written it down
            </button>
          </div>
        </Notice>
      )}

      {adding && (
        <NewDevice
          eventId={eventId}
          onCancel={() => setAdding(false)}
          onCreated={(device) => { setCreated(device); setAdding(false); refresh(); }}
        />
      )}

      {devices.length === 0 ? (
        <Empty title="No devices yet." hint="Register the tablets that will scan tickets at the door." />
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {devices.map((d) => (
            <DeviceRow key={d.id} eventId={eventId} device={d} timezone={timezone} onChanged={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * BRD §18 — the gate is derived LIVE from overdue invoices, not cached as a
 * flag, because an invoice can fall due between one scan and the next. Which is
 * why this says what to do about it rather than only that it happened.
 */
function GateBanner({ gate, eventId }) {
  const state = gate?.gate;
  const stats = gate?.stats;
  const stat = stats && (
    <p className="es-nums text-sm text-muted">
      <span className="text-ink">{stats.admitted}</span> in · {stats.pending} to come
    </p>
  );

  if (state?.locked && !state?.override) {
    return (
      <Notice tone="danger" title="Scanning is switched off">
        <p>
          An unpaid commission invoice locked it.{' '}
          <Link href={`/organizer/events/${eventId}/commission`} className="text-accent underline">Settle it</Link>
          {' '}and it reopens on its own — there is no separate unlock.
        </p>
        {stat}
      </Notice>
    );
  }
  return (
    <Panel title={state?.override ? 'Scanning temporarily allowed' : 'Scanning works'} action={stat} />
  );
}

function DeviceRow({ eventId, device, timezone, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(device.id);
      toast.success('Device ID copied.');
    } catch {
      toast.error('Copying was blocked by the browser. Select the ID and copy it by hand.');
    }
  }

  async function setActive(isActive) {
    if (!isActive) {
      const ok = await confirm({
        title: `Revoke “${device.label}”?`,
        tone: 'danger',
        body: <p>It stops scanning immediately, even mid-shift. You can switch it back on later; its past scans are kept.</p>,
        confirmLabel: 'Revoke device',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await patch(`/events/${eventId}/scan-devices/${device.id}`, { isActive }, { noRedirect: true });
      toast.success(isActive ? `“${device.label}” can scan again.` : `“${device.label}” is revoked.`);
      onChanged();
    } catch (err) {
      toast.error(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  const lastUsed = device.lastSeenAt ? formatWhen(device.lastSeenAt, timezone) : null;

  return (
    <li className="es-card fx-stack fx-stack--sm p-4">
      <div className="fx-row fx-row--between">
        <div className="fx-min0 fx-stack fx-stack--sm gap-0.5">
          <p className="fx-break text-ink">
            {device.label}
            {!device.isActive && <span className="es-pill es-pill--danger ml-2">Revoked</span>}
          </p>
          <p className="text-xs text-subtle">{lastUsed ? `Last used ${lastUsed}` : 'Never used'}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setActive(!device.isActive)}
          className={`es-btn es-btn--sm ${device.isActive ? 'es-btn--ghost' : 'es-btn--secondary'}`}
        >
          {busy ? 'Working…' : device.isActive ? 'Revoke' : 'Switch back on'}
        </button>
      </div>
      <div className="fx-row">
        <span className="text-xs text-muted">Device ID</span>
        <code className="fx-break font-mono text-xs text-ink">{device.id}</code>
        <button type="button" onClick={copyId} className="es-btn es-btn--ghost es-btn--sm">Copy</button>
      </div>
    </li>
  );
}

function NewDevice({ eventId, onCreated, onCancel }) {
  const [form, setForm] = useState({ label: '', pin: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const device = await post(`/events/${eventId}/scan-devices`, form, { noRedirect: true });
      onCreated(device);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel title="Register a device">
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field
            label="What is it" name="label" required minLength={1} maxLength={60} autoFocus
            hint="e.g. Main door, Side entrance"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
          <Field
            label="PIN" name="pin" required inputMode="numeric" pattern="[0-9]{6,12}" minLength={6} maxLength={12}
            hint="6 to 12 digits, shown only once. After 10 wrong tries a device waits 15 minutes."
            value={form.pin}
            onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))}
          />
        </div>
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy} busyLabel="Registering…">Register</SubmitButton>
          <button type="button" onClick={onCancel} className="es-btn es-btn--ghost">Cancel</button>
        </div>
      </form>
    </Panel>
  );
}

/** In the event's time zone, named — a door log is read against the event's own clock. */
function formatWhen(iso, timeZone) {
  return formatEventTime(iso, timeZone);
}
