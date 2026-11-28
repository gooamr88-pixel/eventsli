'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../../hooks/useApi';
import { post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { Loading, ErrorNotice, Notice } from '../../../components/Feedback';
import Field, { SelectField, TextareaField, FieldLabel } from '../../../components/forms/Field';
import PhoneField from '../../../components/forms/PhoneField';
import NavIcon from '../../../components/shell/NavIcon';
import WhatsAppButton from '../../../components/vip/WhatsAppButton';
import { displayPhone } from '../../../components/vip/vipStatus';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Start a VIP request (2026-11-28).
 *
 *   1  What you need     service tiles, as many as apply
 *   2  The event         one of theirs, or one not on Eventsli yet
 *   3  The details       guests, budget, what they have in mind
 *   4  Reaching you      name, email, WhatsApp number and the WhatsApp
 *                        opt-in (never pre-ticked: WhatsApp requires the
 *                        person to agree before a business writes first)
 *
 * Sent → the reference, and "Continue on WhatsApp" with the request typed
 * in, which is what ties their chat to the request on our side.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const NEW_EVENT = '__new__';

/**
 * `mode`: 'organizer' (the dashboard: their events to pick, their details
 * filled in) or 'visitor' (the public /vip page, 2026-11-28: no account, an
 * optional organization, a private link to follow the request).
 */
export default function VipRequestForm({ mode = 'organizer' }) {
  const { data, error, loading, reload } = useApi(mode === 'visitor' ? '/public/vip' : '/organizer/vip/options');
  if (loading) return <Loading variant="card" label="Loading the form" />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  return <Form key="form" options={data} mode={mode} />;
}

function Form({ options, mode }) {
  const visitor = mode === 'visitor';
  const s = options.settings;
  const formRef = useRef(null);
  const [attempt, setAttempt] = useState(0);
  useFocusFirstInvalid(formRef, attempt);

  const [services, setServices] = useState([]);
  const [eventId, setEventId] = useState(options.events[0]?.id || NEW_EVENT);
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [guests, setGuests] = useState('');
  const [budget, setBudget] = useState('');
  const [details, setDetails] = useState('');
  const [name, setName] = useState(options.contact.name);
  const [email, setEmail] = useState(options.contact.email);
  const [phone, setPhone] = useState(options.contact.phone);
  const [company, setCompany] = useState('');
  // The hidden field only bots fill (visitor form). Never shown to people.
  const [website, setWebsite] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [prefer, setPrefer] = useState('whatsapp');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [done, setDone] = useState(null);

  if (!s.enabled) {
    return (
      <Notice tone="info" title="New requests are paused just now.">
        <p>Message us on WhatsApp at {displayPhone(s.whatsappNumber)} or email {s.email}, and we will help.</p>
      </Notice>
    );
  }
  if (done) return <Sent done={done} settings={s} visitor={visitor} />;

  const toggle = (key) => setServices((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const isNew = eventId === NEW_EVENT;

  function check() {
    const e = {};
    if (!services.length) e.services = 'Choose at least one service.';
    if (isNew && !eventName.trim()) e.eventName = 'Name the event, even a working title.';
    if (details.trim().length < 10) e.details = 'Tell us a little about what you need (at least 10 characters).';
    if (!name.trim()) e.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Enter a valid email address.';
    if (prefer === 'whatsapp' && !phone) e.phone = 'Enter your WhatsApp number, or choose email below.';
    return e;
  }

  async function submit(ev) {
    ev.preventDefault();
    const e = check();
    setErrors(e);
    setFailure(null);
    if (Object.keys(e).length) { setAttempt((n) => n + 1); return; }
    setBusy(true);
    try {
      const res = await post(visitor ? '/public/vip/requests' : '/organizer/vip', {
        services,
        eventId: isNew ? undefined : eventId,
        eventName: isNew ? eventName.trim() : undefined,
        eventDate: isNew && eventDate ? eventDate : undefined,
        guestCount: guests ? Number(guests) : undefined,
        budget: budget || undefined,
        details: details.trim(),
        contactName: name.trim(),
        contactEmail: email.trim(),
        whatsappNumber: phone || undefined,
        whatsappOptIn: Boolean(phone && optIn),
        preferredChannel: phone ? prefer : 'email',
        ...(visitor ? { company: company.trim() || undefined, website: website || undefined } : {}),
      });
      setDone(res);
      if (visitor) document.getElementById('request')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setFailure({ title: describeError(err).title, message: messageFor(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} className="es-vipform" onSubmit={submit} noValidate>
      <div className="es-vipform__head">
        {visitor ? (
          <h2 className="es-vipform__title">Start a VIP request</h2>
        ) : (
          <>
            <Link href="/organizer/vip" className="es-vip__back"><NavIcon name="chevronLeft" size={16} /> VIP Services</Link>
            <h1 className="es-vipform__title">Start a VIP request</h1>
          </>
        )}
        <p className="es-vipform__lede">Tell us what you need. Our team replies on WhatsApp or by email{s.responseTime ? ` — ${s.responseTime.charAt(0).toLowerCase()}${s.responseTime.slice(1)}` : '.'}</p>
      </div>
      {visitor && options.isOrganizer && (
        <Notice tone="info" title="You have an organizer account.">
          <p>Ask from your <Link href="/organizer/vip/new">dashboard</Link> instead to link the request to one of your events.</p>
        </Notice>
      )}

      <fieldset className="es-vipform__step">
        <legend><span className="es-vipform__n">1</span> What do you need?</legend>
        <div className="es-viptiles" role="group" aria-describedby={errors.services ? 'vip-services-error' : undefined}>
          {s.services.map((x) => {
            const on = services.includes(x.key);
            return (
              <label key={x.key} className={`es-viptile${on ? ' is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(x.key)} aria-invalid={errors.services ? 'true' : undefined} />
                <span className="es-viptile__icon" aria-hidden="true"><NavIcon name={x.icon} size={22} /></span>
                <span className="fx-min0">
                  <b>{x.title}</b>
                  <span>{x.blurb}</span>
                </span>
                <span className="es-viptile__check" aria-hidden="true"><NavIcon name="tick" size={14} /></span>
              </label>
            );
          })}
        </div>
        {errors.services && <p id="vip-services-error" className="text-xs text-danger">{errors.services}</p>}
      </fieldset>

      <fieldset className="es-vipform__step">
        <legend><span className="es-vipform__n">2</span> Which event?</legend>
        <div className="es-vipform__grid">
          {options.events.length > 0 && (
            <SelectField
              label="Event"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              options={[
                ...options.events.map((e) => [e.id, `${e.title}${e.startsAt ? ` — ${new Date(e.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: e.timezone || 'UTC' })}` : ''}`]),
                [NEW_EVENT, 'An event not on Eventsli yet'],
              ]}
            />
          )}
          {isNew && (
            <>
              <Field label="Event name" required value={eventName} onChange={(e) => setEventName(e.target.value)} maxLength={160} error={errors.eventName} placeholder="New Year's Eve Gala" />
              <Field label="Date" type="date" optional value={eventDate} onChange={(e) => setEventDate(e.target.value)} hint="If you know it." />
            </>
          )}
          <Field label="Number of guests" type="number" inputMode="numeric" optional min={1} max={1000000} value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="300" />
          <SelectField label="Budget for these services" optional value={budget} onChange={(e) => setBudget(e.target.value)}
            options={[['', 'Choose…'], ...options.budgets.map((b) => [b.value, b.label])]} />
        </div>
      </fieldset>

      <fieldset className="es-vipform__step">
        <legend><span className="es-vipform__n">3</span> Tell us about it</legend>
        <TextareaField
          label="What do you have in mind?"
          required
          rows={5}
          maxLength={4000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          error={errors.details}
          hint="The venue, the timing, anything you already have (a floor plan, a guest list) and anything you are worried about."
        />
      </fieldset>

      <fieldset className="es-vipform__step">
        <legend><span className="es-vipform__n">4</span> How should we reach you?</legend>
        <div className="es-vipform__grid">
          <Field label="Your name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} error={errors.name} />
          <Field label="Email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} error={errors.email} />
          {visitor && (
            <Field label="Company or organization" optional autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={160} />
          )}
        </div>
        {visitor && (
          <div className="sr-only" aria-hidden="true">
            <label htmlFor="vip-website">Leave this empty</label>
            <input id="vip-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
        )}
        <PhoneField label="WhatsApp number" optional={prefer === 'email'} value={phone} onChange={setPhone} error={errors.phone}
          hint="The number you use WhatsApp on, so our replies reach you there." />
        <div className="fx-stack fx-stack--sm">
          <FieldLabel as="p">Where should updates go?</FieldLabel>
          <div className="es-vipchoice" role="radiogroup" aria-label="Where should updates go?">
            {[['whatsapp', 'WhatsApp', 'Fastest. Chat with the team.'], ['email', 'Email', 'Updates by email only.']].map(([v, l, h]) => (
              <label key={v} className={`es-vipchoice__opt${prefer === v ? ' is-on' : ''}`}>
                <input type="radio" name="vip-prefer" value={v} checked={prefer === v} onChange={() => setPrefer(v)} />
                <b>{l}</b><span>{h}</span>
              </label>
            ))}
          </div>
        </div>
        {phone && (
          <label className="es-vipconsent">
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
            <span>
              Eventsli may message me on WhatsApp at this number about this request: replies, proposals and status updates.
              No marketing. I can say STOP or change this at any time on the request page.
            </span>
          </label>
        )}
      </fieldset>

      {failure && <Notice tone="danger" title={failure.title}><p>{failure.message}</p></Notice>}

      <div className="es-vipform__submit">
        <button type="submit" className="es-btn es-btn--primary es-btn--lg" disabled={busy}>
          {busy ? 'Sending…' : 'Send request'} {!busy && <NavIcon name="send" size={18} />}
        </button>
        <p className="text-sm text-subtle">
          Rather talk first? <a href={options.chatUrl} target="_blank" rel="noopener noreferrer">Message us on WhatsApp</a> or <a href={`mailto:${s.email}`}>email {s.email}</a>.
        </p>
      </div>
    </form>
  );
}

function Sent({ done, settings, visitor = false }) {
  const r = done.request;
  // A bot that filled the hidden field gets this screen with no request.
  if (!r) return <Notice tone="success" title="Thank you.">We have your request.</Notice>;
  const Heading = visitor ? 'h2' : 'h1';
  return (
    <section className="es-vipsent" aria-labelledby="vip-sent-title">
      <span className="es-vipsent__mark" aria-hidden="true"><NavIcon name="check" size={34} /></span>
      <p className="es-vipsent__ref es-nums">{r.reference}</p>
      <Heading id="vip-sent-title" className="es-vipsent__title">Your request is with our team</Heading>
      <p className="es-vipsent__lede">
        We have emailed you a copy. {settings.responseTime}
      </p>
      <div className="es-vipsent__next">
        <p className="es-vipsent__label">The fastest way from here</p>
        <WhatsAppButton href={done.chatUrl} size="lg" block>Continue on WhatsApp</WhatsAppButton>
        <p className="es-vipsent__small">
          It opens a chat with {displayPhone(settings.whatsappNumber)} with your request typed in. Just press send.
        </p>
      </div>
      <div className="es-vipsent__links">
        {visitor ? (
          <>
            <Link href={`/vip/request/${r.id}?t=${done.token}`} className="es-btn es-btn--secondary">Open your request</Link>
            <p className="es-vipsent__small">We emailed you this private link too, to follow your request and write to us.</p>
          </>
        ) : (
          <>
            <Link href={`/organizer/vip/${r.id}`} className="es-btn es-btn--secondary">Open your request</Link>
            <Link href="/organizer/vip" className="es-btn es-btn--ghost">Back to VIP Services</Link>
          </>
        )}
      </div>
    </section>
  );
}
