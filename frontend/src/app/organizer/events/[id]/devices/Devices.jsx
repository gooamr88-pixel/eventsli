'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get, post, patch } from '../../../../utils/apiClient';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, ErrorNotice } from '../../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Scanning devices. DEVICES, NOT PEOPLE.
 *
 * Door staff share a tablet and change between shifts, so a device is
 * registered once, given a PIN, and is its own principal. A lost tablet is
 * revoked without touching anyone's account — and revoking is a FLAG, not a
 * delete, because the scans it recorded have to keep pointing somewhere.
 *
 * THE PIN IS SHOWN EXACTLY ONCE. The API returns it on creation and never
 * again; it is stored hashed. So the panel makes that plain rather than letting
 * an organizer close the page and discover it later at a door.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Devices({ eventId }) {
  const [devices, setDevices] = useState(null);
  const [gate, setGate] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [created, setCreated] = useState(null);

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
  if (!devices) return <Loading variant="list" />;

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Scanning</h2>
        <p className="max-w-[62ch] text-muted">
          Register each shared tablet or phone that will scan at the door. Staff sign the
          device in with its PIN, so a shift change needs nothing. For named people who
          scan with their own account, use the{' '}
          <Link href={`/organizer/events/${eventId}/staff`} className="text-accent">door team</Link>.
        </p>
      </div>

      <GateBanner gate={gate} eventId={eventId} />

      {created && (
        <div className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-accent bg-accent-wash p-5">
          <p className="text-ink">“{created.label}” is registered</p>
          <dl className="fx-stack fx-stack--sm text-sm">
            <div>
              <dt className="text-muted">Device ID</dt>
              <dd className="font-mono text-ink fx-break">{created.id}</dd>
            </div>
            <div>
              <dt className="text-muted">PIN</dt>
              <dd className="font-mono text-2xl text-ink">{created.pin}</dd>
            </div>
          </dl>
          {/* The one thing that must not be missed. */}
          <p className="text-sm text-danger">
            Write the PIN down now. It is stored hashed and cannot be shown again — a
            device that loses it has to be registered anew.
          </p>
          <button type="button" onClick={() => setCreated(null)} className="self-start text-sm text-accent">
            Got it
          </button>
        </div>
      )}

      {devices.length === 0 ? (
        <div className="es-empty">
          <p className="text-muted">No devices yet.</p>
        </div>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {devices.map((d) => (
            <DeviceRow key={d.id} eventId={eventId} device={d} onChanged={refresh} />
          ))}
        </ul>
      )}

      <NewDevice
        eventId={eventId}
        onCreated={(device) => { setCreated(device); refresh(); }}
      />
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

  return (
    <div className={`fx-row fx-row--between rounded-[--es-radius-lg] border p-4 ${
      state?.locked ? 'border-danger/40 bg-danger/5' : 'border-border-base bg-surface'
    }`}
    >
      <div className="fx-min0">
        <p className="text-ink">
          {state?.override
            ? 'Scanning temporarily allowed'
            : state?.locked ? 'Scanning is switched off' : 'Scanning works'}
        </p>
        {state?.locked && (
          <p className="text-sm text-muted">
            An unpaid commission invoice locked it.{' '}
            <Link href={`/organizer/events/${eventId}/commission`} className="text-accent">
              Settle it
            </Link>{' '}
            and it reopens on its own — there is no separate unlock.
          </p>
        )}
      </div>
      {stats && (
        <p className="es-nums whitespace-nowrap text-sm text-muted">
          <span className="text-ink">{stats.admitted}</span> in · {stats.pending} to come
        </p>
      )}
    </div>
  );
}

function DeviceRow({ eventId, device, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await patch(`/events/${eventId}/scan-devices/${device.id}`, {
        isActive: !device.isActive,
      }, { noRedirect: true });
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="fx-stack fx-stack--sm es-card p-4">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          <p className="fx-break text-ink">{device.label}</p>
          <p className="text-xs text-subtle">
            {device.lastSeenAt
              ? `Last used ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(device.lastSeenAt))}`
              : 'Never used'}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={`whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors disabled:opacity-40 ${
            device.isActive
              ? 'bg-success/15 text-success hover:bg-danger/15 hover:text-danger'
              : 'bg-bg-sunken text-muted hover:text-ink'
          }`}
        >
          {busy ? '…' : device.isActive ? 'Active' : 'Revoked'}
        </button>
      </div>
      <FormError error={error} />
    </li>
  );
}

function NewDevice({ eventId, onCreated }) {
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      setForm({ label: '', pin: '' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-[--es-radius-md] border border-border-strong px-4 py-2 text-sm text-ink transition-colors hover:bg-bg-sunken"
      >
        Register a device
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="fx-stack fx-stack--sm es-card p-4">
      <Field
        label="What is it" name="label" required minLength={1} maxLength={60} autoFocus
        hint="e.g. Main door, Side entrance"
        value={form.label}
        onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
      />
      <Field
        label="PIN" name="pin" required minLength={4} maxLength={32}
        hint="At least 4 characters. Staff type this to sign the device in — and it is shown only once."
        value={form.pin}
        onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))}
      />
      <FormError error={error} />
      <div className="fx-row fx-row--between">
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-ink">
          Cancel
        </button>
        <SubmitButton busy={busy} busyLabel="Registering…">Register</SubmitButton>
      </div>
    </form>
  );
}
