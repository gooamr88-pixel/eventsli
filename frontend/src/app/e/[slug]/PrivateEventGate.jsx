'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import NavIcon from '../../components/shell/NavIcon';
import {
  GateScene, TicketLock, HeroWave, CornerSwoosh, LockGlyph, ShieldGlyph, EyeGlyph,
} from './PrivateGateArt';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The password screen in front of a PRIVATE event — the owner's design
 * (2026-11-22): a hero (the event's cover, or a drawn concert scene) with a
 * dark ticket-and-padlock over it and a wave at its foot; the "Private event"
 * badge, the title, who hosts it; a note; the password field; Unlock; and
 * "Your information is secure".
 *
 * Shows only what the API gave a locked visitor: title, cover, organizer, and
 * the organizer's length rule when they set one. Nothing behind the password.
 *
 * A match sets an httpOnly cookie for this one event (the API does that, so no
 * script here ever holds the key). `router.refresh()` then re-renders on the
 * server, which reads the cookie and draws the event — or the seats, tickets,
 * sponsor or vendor page this gate was standing in front of.
 *
 * Every refusal is the same "does not match": the API does not say whether the
 * event is private, unpublished or absent, and nor does this.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PrivateEventGate({ event }) {
  const router = useRouter();
  const ids = useId();
  const inputId = `${ids}-pw`;
  const helpId = `${ids}-help`;
  const inputRef = useRef(null);
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Set once the password matched. The refresh then replaces this gate with
  // the event; if the gate is STILL here when it settles, the browser did not
  // keep the unlock cookie — said, rather than a button stuck on "Checking…".
  const [matched, setMatched] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  const rule = event.passwordRule || null;
  const range = rule ? (rule.min === rule.max ? `exactly ${rule.min} characters` : `${rule.min}–${rule.max} characters`) : null;

  async function submit(e) {
    e.preventDefault();
    setMatched(false);
    const value = password.trim();
    // Checked here first, so an empty or wrong-length try costs no request.
    if (!value) { setError({ local: 'Enter the event password.' }); inputRef.current?.focus(); return; }
    if (rule && (value.length < rule.min || value.length > rule.max)) {
      setError({ local: `The password is ${range}.` });
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post(`/public/events/${encodeURIComponent(event.slug)}/unlock`, { password }, { noRedirect: true });
      setMatched(true);
      startRefresh(() => router.refresh());
    } catch (err) {
      setError(err);
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const cookieBlocked = matched && !refreshing && !busy;
  let message = null;
  if (error?.local) message = error.local;
  else if (error) message = error.code === 'EVENT_PASSWORD_INVALID' ? 'That password does not match. Check your invitation and try again.' : describeError(error).recovery;
  else if (cookieBlocked) message = 'The password is right, but your browser did not keep it. Allow cookies for this site, then try again.';
  const working = busy || refreshing;

  return (
    <main className="es-pgate-page">
      <div className="fx-gutter">
        <article className="es-pgate" aria-labelledby={`${ids}-title`}>
          <div className="es-pgate__hero">
            {event.coverUrl ? (
              // The organizer's own poster; the title below names the event.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="es-pgate__img" src={event.coverUrl} alt="" />
            ) : <GateScene />}
            <CornerSwoosh corner="tl" />
            <TicketLock />
            <HeroWave />
          </div>

          <div className="es-pgate__body">
            <p className="es-pgate__badge"><LockGlyph size={16} /> Private event</p>
            <h1 id={`${ids}-title`} className="es-pgate__title">{event.title || 'Private event'}</h1>
            {event.organizer?.name && (
              <p className="es-pgate__host">Hosted by <span>{event.organizer.name}</span></p>
            )}

            <hr className="es-pgate__rule" />

            <p className="es-pgate__note">
              <span className="es-pgate__info" aria-hidden="true"><NavIcon name="info" size={20} /></span>
              <span>This event is by invitation. Enter the password the organizer gave you to see the details and get tickets.</span>
            </p>

            <form onSubmit={submit} noValidate className="es-pgate__form">
              <label htmlFor={inputId} className="es-pgate__label">
                Event password <span className="es-req" aria-hidden="true">*</span>
              </label>
              <div className="es-pgate__field" data-invalid={message && !cookieBlocked ? 'true' : undefined}>
                <span className="es-pgate__field-icon" aria-hidden="true"><LockGlyph size={22} /></span>
                <input
                  ref={inputRef}
                  id={inputId}
                  type={revealed ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setMatched(false); if (error?.local) setError(null); }}
                  placeholder="Enter event password"
                  required
                  aria-invalid={message && !cookieBlocked ? 'true' : undefined}
                  aria-describedby={message || range ? helpId : undefined}
                  maxLength={100}
                  // An event's password, not an Eventsli sign-in: no autofill of
                  // the visitor's own account password into it, no offer to save.
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  // The one thing this page asks for.
                  autoFocus
                />
                <button
                  type="button"
                  className="es-pgate__eye"
                  aria-label={revealed ? 'Hide password' : 'Show password'}
                  aria-pressed={revealed}
                  aria-controls={inputId}
                  onClick={() => setRevealed((v) => !v)}
                >
                  <EyeGlyph off={!revealed} />
                </button>
              </div>
              {(message || range) && (
                <p id={helpId} className={`es-pgate__help${message ? ' es-pgate__help--error' : ''}`}>
                  {message || `The password is ${range}.`}
                </p>
              )}

              <button type="submit" className="es-pgate__submit" disabled={working}>
                <span className="es-pgate__submit-label">
                  <NavIcon name="key" size={22} /> {working ? 'Checking…' : 'Unlock event'}
                </span>
                <span className="es-pgate__submit-chev" aria-hidden="true"><NavIcon name="chevronRight" size={22} /></span>
              </button>
              {/* The help line above is not announced on its own; this is, so a
                  screen reader hears the refusal after pressing Unlock. */}
              <p className="sr-only" role="status" aria-live="polite">{message || ''}</p>
            </form>

            <p className="es-pgate__secure"><ShieldGlyph /> Your information is secure</p>
          </div>

          <CornerSwoosh corner="br" />
        </article>
      </div>
    </main>
  );
}
