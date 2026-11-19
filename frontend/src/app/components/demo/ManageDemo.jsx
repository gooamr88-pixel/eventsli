'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import NavIcon from '../shell/NavIcon';
import { get, post, PUBLIC_API_URL } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { browserZone, googleCalendarUrl, spanLabel, zoneLabel } from '../../lib/demoTime';
import DemoBooker from './DemoBooker';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The booker's booking (2026-11-19): when it is, the call link once there is
 * one, add to calendar, move it (the same card, in reschedule mode) or cancel
 * it. A link with a wrong or missing token reads "not found" and nothing else.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const noSubscribe = () => () => {};

export default function ManageDemo({ id, token, settings, email, today, initialMonth, horizonDate }) {
  const detected = useSyncExternalStore(noSubscribe, () => browserZone(settings.timezone), () => settings.timezone);
  const [state, setState] = useState({ loading: true });
  const [moving, setMoving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get(`/public/demo/bookings/${id}?t=${encodeURIComponent(token)}`, { noRedirect: true, cache: 'no-store' });
        if (!cancelled) setState({ booking: data.booking });
      } catch (err) {
        if (!cancelled) setState({ failed: err?.code === 'NOT_FOUND' ? 'notfound' : describeError(err).recovery });
      }
    })();
    return () => { cancelled = true; };
  }, [id, token]);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const data = await post(`/public/demo/bookings/${id}/cancel`, { t: token, reason: reason.trim() || undefined }, { noRedirect: true });
      setState({ booking: data.booking });
      setCancelling(false);
      setFlash('Your demo is cancelled. We have emailed you a note of it.');
    } catch (err) {
      const d = describeError(err);
      setError(err?.message && err.code === 'CONFLICT' ? err.message : `${d.title}. ${d.recovery}`);
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return <p className="es-demo-card__sub" aria-busy="true">Loading your booking…</p>;
  if (state.failed) {
    return (
      <section className="es-demo-card">
        <h1 className="es-demo-card__title">{state.failed === 'notfound' ? 'We could not find this booking' : 'Something went wrong'}</h1>
        <p className="es-demo-card__sub">
          {state.failed === 'notfound'
            ? 'The link may be incomplete. Open it again from your confirmation email, or write to us at '
            : `${state.failed} You can also write to us at `}
          <a href={`mailto:${email}`}>{email}</a>.
        </p>
      </section>
    );
  }

  const b = state.booking;
  const zone = b.bookerTimezone || detected;

  if (moving) {
    return (
      <>
        <button type="button" className="es-btn es-btn--ghost es-btn--sm es-demo-manage__back" onClick={() => setMoving(false)}>
          <NavIcon name="chevronLeft" size={18} /> Keep the current time
        </button>
        <DemoBooker
          settings={settings} today={today} initialMonth={initialMonth} horizonDate={horizonDate}
          mode="reschedule" booking={b} token={token}
          onRescheduled={(next) => { setState({ booking: next }); setMoving(false); setFlash('Your demo is moved. We have emailed you the new time.'); }}
        />
      </>
    );
  }

  const live = b.status === 'confirmed';
  const label = { confirmed: 'Booked', completed: 'Done', no_show: 'Missed', cancelled: 'Cancelled' }[b.status];

  return (
    <section className="es-demo-card">
      <p className={`es-demo-manage__status es-demo-manage__status--${b.status}`}>{label}</p>
      <h1 className="es-demo-card__title">{b.title || settings.title}</h1>
      {flash && <p role="status" className="es-demo-card__notice es-demo-card__notice--ok">{flash}</p>}
      <ul className="es-demo-summary">
        <li><NavIcon name="calendar" size={18} />{spanLabel(b.startsAt, b.endsAt, zone)}</li>
        <li><NavIcon name="clock" size={18} />{b.durationMinutes} min</li>
        <li><NavIcon name="globe" size={18} />{zoneLabel(zone)}</li>
        <li><NavIcon name="mail" size={18} />{b.email}</li>
      </ul>

      {live && (b.meetingLink ? (
        <a className="es-btn es-btn--primary es-demo-manage__join" href={b.meetingLink} target="_blank" rel="noopener">
          <NavIcon name="external" size={18} /> Join the video call
        </a>
      ) : b.meetingNote ? <p className="es-demo-card__sub">{b.meetingNote}</p> : null)}

      {live && (
        <div className="es-demo-done__actions">
          <a className="es-btn es-btn--secondary" href={googleCalendarUrl({ start: b.startsAt, end: b.endsAt, title: `${b.title || settings.title} with Eventsli`, details: b.meetingLink || '' })} target="_blank" rel="noopener">
            <NavIcon name="calendarPlus" size={18} /> Google Calendar
          </a>
          <a className="es-btn es-btn--secondary" href={`${PUBLIC_API_URL}/public/demo/bookings/${b.id}/calendar.ics?t=${encodeURIComponent(token)}`}>
            <NavIcon name="download" size={18} /> Apple, Outlook (.ics)
          </a>
        </div>
      )}

      {b.canChange && !cancelling && (
        <div className="es-demo-manage__change">
          <button type="button" className="es-btn es-btn--primary" onClick={() => { setMoving(true); setFlash(null); }}>Choose another time</button>
          <button type="button" className="es-btn es-btn--ghost" onClick={() => setCancelling(true)}>Cancel the demo</button>
        </div>
      )}

      {cancelling && (
        <div className="es-demo-manage__cancel">
          <label htmlFor="demo-cancel-reason">Anything we should know? <span>(optional)</span></label>
          <textarea id="demo-cancel-reason" className="es-input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && <p role="alert" className="es-demo-form__error">{error}</p>}
          <div className="es-demo-manage__change">
            <button type="button" className="es-btn es-btn--danger" onClick={cancel} disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Cancelling…' : 'Yes, cancel it'}
            </button>
            <button type="button" className="es-btn es-btn--ghost" onClick={() => setCancelling(false)} disabled={busy}>Keep it</button>
          </div>
        </div>
      )}

      {!live && (
        <p className="es-demo-card__sub">
          Want to talk another time? <Link href="/demo">Book a new demo</Link>.
        </p>
      )}
    </section>
  );
}
