'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import NavIcon from '../../components/shell/NavIcon';
import { PUBLIC_API_URL } from '../../utils/apiClient';
import { formatEventTime } from '../../lib/eventTime';
import BlurredEventPreview from './BlurredEventPreview';
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
 *
 * WHAT IT SHOWS IS THE ORGANIZER'S CHOICE (2026-11-22, the owner: "blur all
 * details and images until it is unlocked — the organizer decides"):
 * `event.preview` is 'blur' (the event page, blurred, behind this card —
 * BlurredEventPreview) or 'card' (this card alone), and only the details in
 * `event.reveal` arrive at all (title, host, cover, date, city). A hidden
 * cover comes as a 24-pixel copy from the API (`/locked-cover`), blurred here.
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
  const blurredSrc = event.blurredCover
    ? `${PUBLIC_API_URL}/public/events/${encodeURIComponent(event.slug)}/locked-cover` : null;
  const [blurFailed, setBlurFailed] = useState(false);
  const when = event.startsAt ? formatEventTime(event.startsAt, event.timezone) : null;
  const blurPage = event.preview !== 'card';
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
    <main className="es-pgate-page" data-preview={blurPage ? 'blur' : 'card'}>
      {blurPage && <BlurredEventPreview coverSrc={event.coverUrl || (blurFailed ? null : blurredSrc)} />}
      <div className="fx-gutter es-pgate-front">
        <article className="es-pgate" aria-labelledby={`${ids}-title`}>
          {event.coverUrl ? (
            /* THE ORGANIZER'S POSTER, WHOLE (owner, 2026-11-24: "image not
               appear correct"). Cropped to 2:1 under a big lock and a wave,
               a portrait poster lost its top and its title on a phone. It is
               shown entire now, over a blurred copy of itself that fills the
               frame, with a small lock in the corner instead. */
            <div className="es-pgate__hero es-pgate__hero--poster">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="es-pgate__backdrop" src={event.coverUrl} alt="" aria-hidden="true" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="es-pgate__poster" src={event.coverUrl} alt="" />
              <span className="es-pgate__lockchip" aria-hidden="true"><LockGlyph size={18} /></span>
            </div>
          ) : (
            <div className="es-pgate__hero">
              {blurredSrc && !blurFailed ? (
                // A 24-pixel copy, stretched and blurred: colours, no detail.
                // eslint-disable-next-line @next/next/no-img-element
                <img className="es-pgate__img es-pgate__img--blur" src={blurredSrc} alt="" onError={() => setBlurFailed(true)} />
              ) : <GateScene />}
              <CornerSwoosh corner="tl" />
              <TicketLock />
              <HeroWave />
            </div>
          )}

          <div className="es-pgate__body">
            <p className="es-pgate__badge"><LockGlyph size={16} /> Private event</p>
            <h1 id={`${ids}-title`} className="es-pgate__title">{event.title || 'Private event'}</h1>
            {event.organizer?.name && (
              <p className="es-pgate__host">Hosted by <span>{event.organizer.name}</span></p>
            )}
            {/* The date and city, only when the organizer chose to show them. */}
            {(when || event.city) && (
              <ul className="es-pgate__facts">
                {when && <li><NavIcon name="calendar" size={16} />{when}</li>}
                {event.city && <li><NavIcon name="pin" size={16} />{event.city}</li>}
              </ul>
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
