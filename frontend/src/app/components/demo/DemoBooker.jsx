'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import NavIcon from '../shell/NavIcon';
import { get, post, PUBLIC_API_URL } from '../../utils/apiClient';
import { smsPayload } from '../forms/SmsConsentFields';
import { describeError } from '../../utils/errors';
import {
  browserZone, dayHeading, googleCalendarUrl, groupByDate, monthRange, shiftMonth, spanLabel, zoneLabel,
} from '../../lib/demoTime';
import DemoCalendar from './DemoCalendar';
import DemoTimes from './DemoTimes';
import DemoForm from './DemoForm';
import TimezoneSelect from './TimezoneSelect';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The "Book a demo" card (owner's reference, 2026-11-19), in four steps:
 * a month → a day's times → the details → booked. Back arrows step back.
 *
 * `mode="reschedule"` (the booker's own link) skips the form: choosing a
 * time and confirming moves the existing booking.
 *
 * The visitor's zone starts as their browser's (read through
 * useSyncExternalStore, so the server's render and the first client render
 * agree), and they can change it; the API's open times are shown in it.
 * `today` and `initialMonth` come from the server render, so nothing here
 * reads the clock during render.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const noSubscribe = () => () => {};
const monthKey = (v) => `${v.year}-${String(v.month).padStart(2, '0')}`;
const EMPTY = { name: '', email: '', phone: '', company: '', topic: '', message: '', answers: {}, website: '', sms: {} };

export default function DemoBooker({ settings, today, initialMonth, horizonDate, mode = 'book', booking = null, token = null, onRescheduled }) {
  const detected = useSyncExternalStore(noSubscribe, () => browserZone(settings.timezone), () => settings.timezone);
  const [picked, setPicked] = useState(null);
  const zone = picked || (mode === 'reschedule' && booking?.bookerTimezone) || detected;

  const [view, setView] = useState(initialMonth);
  const [cache, setCache] = useState({});
  const [refresh, setRefresh] = useState(0);
  const [step, setStep] = useState('date');
  const [date, setDate] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [values, setValues] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [done, setDone] = useState(null);

  const key = monthKey(view);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { from, to } = monthRange(view.year, view.month);
      try {
        const data = await get(`/public/demo/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { noRedirect: true, cache: 'no-store' });
        if (!cancelled) setCache((c) => ({ ...c, [key]: { slots: data.slots || [] } }));
      } catch (err) {
        if (!cancelled) setCache((c) => ({ ...c, [key]: { slots: [], failed: describeError(err).recovery } }));
      }
    })();
    return () => { cancelled = true; };
  }, [key, view.year, view.month, refresh]);

  const month = cache[key];
  const byDate = useMemo(() => groupByDate(month?.slots || [], zone), [month, zone]);
  const openDays = useMemo(() => Object.fromEntries(
    Object.entries(byDate).filter(([d]) => d.startsWith(key)).map(([d, list]) => [d, list.length]),
  ), [byDate, key]);
  const daySlots = (date && byDate[date]) || [];

  const canBack = monthKey(view) > today.slice(0, 7);
  const canForward = monthKey(shiftMonth(view, 1)) <= horizonDate.slice(0, 7);

  function changeMonth(delta) {
    setView((v) => shiftMonth(v, delta));
    setNotice(null);
  }
  function pickDate(d) {
    setDate(d);
    setChosen(null);
    setStep('time');
    setNotice(null);
  }
  function changeZone(z) {
    setPicked(z);
    // The same instant may now sit on another day: start the day choice again.
    if (step !== 'date') { setStep('date'); setDate(null); setChosen(null); }
  }
  function slotTaken(message) {
    setCache((c) => { const next = { ...c }; delete next[key]; return next; });
    setRefresh((n) => n + 1);
    setChosen(null);
    setStep('time');
    setNotice(message);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'reschedule') {
        const data = await post(`/public/demo/bookings/${booking.id}/reschedule`, { t: token, startsAt: chosen }, { noRedirect: true });
        onRescheduled?.(data.booking);
        return;
      }
      const { sms, ...details } = values;
      const data = await post('/public/demo/bookings', { ...details, ...smsPayload(sms, values.phone), startsAt: chosen, timezone: zone }, { noRedirect: true });
      setDone(data);
      setStep('done');
    } catch (err) {
      const d = describeError(err);
      if (err?.code === 'DEMO_SLOT_TAKEN') slotTaken(`${d.title}. ${d.recovery}`);
      else setError(err?.message && err.code === 'VALIDATION_ERROR' ? err.message : `${d.title}. ${d.recovery}`);
    } finally {
      setBusy(false);
    }
  }

  const endOf = (iso) => new Date(Date.parse(iso) + settings.durationMinutes * 60_000).toISOString();

  // ── Booked ─────────────────────────────────────────────────────────────
  if (step === 'done' && done) {
    const b = done.booking;
    const manage = b && done.token ? `/demo/booking/${b.id}?t=${encodeURIComponent(done.token)}` : null;
    return (
      <section className="es-demo-card es-demo-done" aria-live="polite">
        <span className="es-demo-done__mark" aria-hidden><NavIcon name="check" size={28} /></span>
        <h2 className="es-demo-card__title">You&rsquo;re booked</h2>
        {b && <p className="es-demo-done__when">{spanLabel(b.startsAt, b.endsAt, zone)}</p>}
        <p className="es-demo-done__zone">{zoneLabel(zone)}</p>
        <p className="es-demo-done__msg">{settings.confirmationMessage}</p>
        {settings.meetingNote && <p className="es-demo-done__note">{settings.meetingNote}</p>}
        {b && (
          <div className="es-demo-done__actions">
            <a className="es-btn es-btn--primary" href={googleCalendarUrl({ start: b.startsAt, end: b.endsAt, title: `${settings.title} with Eventsli` })} target="_blank" rel="noopener">
              <NavIcon name="calendarPlus" size={18} /> Add to Google Calendar
            </a>
            <a className="es-btn es-btn--secondary" href={`${PUBLIC_API_URL}/public/demo/bookings/${b.id}/calendar.ics?t=${encodeURIComponent(done.token)}`}>
              <NavIcon name="download" size={18} /> Apple, Outlook (.ics)
            </a>
          </div>
        )}
        {manage && <Link href={manage} className="es-demo-done__manage">Change or cancel this booking</Link>}
      </section>
    );
  }

  const heading = mode === 'reschedule' ? 'Choose a new time' : settings.title;
  const summaryWhen = chosen ? spanLabel(chosen, endOf(chosen), zone) : date ? dayHeading(date).short : null;

  return (
    <section className="es-demo-card" aria-labelledby="demo-card-title">
      {step !== 'date' && (
        <button type="button" className="es-demo-card__back" onClick={() => { setStep(step === 'form' ? 'time' : 'date'); setError(null); }} aria-label="Back">
          <NavIcon name="chevronLeft" size={22} />
        </button>
      )}
      <h2 id="demo-card-title" className="es-demo-card__title">{step === 'time' && date ? dayHeading(date).weekday : heading}</h2>
      {step === 'time' && date && <p className="es-demo-card__sub">{dayHeading(date).full}</p>}

      {step !== 'time' && (
        <ul className="es-demo-summary">
          <li><NavIcon name="clock" size={18} />{settings.durationMinutes} min</li>
          {summaryWhen && <li><NavIcon name="calendar" size={18} />{summaryWhen}</li>}
          <li><NavIcon name="globe" size={18} />{zoneLabel(zone)}</li>
        </ul>
      )}

      {notice && <p role="alert" className="es-demo-card__notice">{notice}</p>}

      {step === 'date' && (
        <>
          {month?.failed && <p role="alert" className="es-demo-card__notice">{month.failed}</p>}
          <DemoCalendar
            view={view} onMonth={changeMonth} canBack={canBack} canForward={canForward}
            openDays={openDays} today={today} selected={date} onPick={pickDate} loading={!month}
          />
          <TimezoneSelect value={zone} onChange={changeZone} />
        </>
      )}

      {step === 'time' && (
        <>
          <TimezoneSelect value={zone} onChange={changeZone} />
          {daySlots.length > 0 ? (
            <DemoTimes
              slots={daySlots} zone={zone} chosen={chosen} durationMinutes={settings.durationMinutes}
              onChoose={setChosen} onConfirm={(iso) => { setChosen(iso); setStep('form'); }}
            />
          ) : (
            <p className="es-demo-cal__none">No open times left on this day. Go back and pick another.</p>
          )}
        </>
      )}

      {step === 'form' && chosen && mode === 'book' && (
        <DemoForm settings={settings} values={values} onChange={setValues} onSubmit={submit} busy={busy} error={error} />
      )}

      {step === 'form' && chosen && mode === 'reschedule' && (
        <div className="es-demo-form">
          {booking && (
            <p className="es-demo-card__sub">
              Currently {spanLabel(booking.startsAt, booking.endsAt, zone)}.
            </p>
          )}
          {error && <p role="alert" className="es-demo-form__error">{error}</p>}
          <button type="button" className="es-btn es-btn--primary es-demo-form__submit" onClick={submit} disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Moving…' : 'Move my demo to this time'}
          </button>
        </div>
      )}
    </section>
  );
}

