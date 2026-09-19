'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { post } from '../../utils/apiClient';
import { setAuthUser } from '../../hooks/useAuth';
import { safeNext } from '../login/LoginForm';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import OtpInput from '../../components/forms/OtpInput';
import SubmitButton from '../../components/forms/SubmitButton';
import NavIcon from '../../components/shell/NavIcon';
import { useVerificationWatch, forgetWatchToken } from './useVerificationWatch';
import { landingAfterAuth } from '../../lib/authLanding';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Check your inbox" — the step between signing up and the dashboard.
 *
 * The email carries an ACTIVATION LINK, and that is what this screen asks for:
 * open the email, tap the button. Nothing to type. The account stays inactive
 * until then; the link opens /activate, which confirms it and signs them in.
 *
 * The six digits in the same email are the fallback, folded away under "Use a
 * code instead" — for someone who signed up on a laptop and reads mail on a
 * phone, where the link would sign in the wrong device.
 *
 * Reached from sign-up, and from sign-in when the right password meets an
 * address that was never confirmed — both with `?email=` and `?sent=1`, because
 * an email has already gone out and resend starts on its one-minute cooldown.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const COOLDOWN = 60;

export default function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const knownEmail = params.get('email') || '';

  const [email, setEmail] = useState(knownEmail);
  const [code, setCode] = useState('');
  const [useCode, setUseCode] = useState(!knownEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [cooldown, setCooldown] = useState(params.get('sent') === '1' ? COOLDOWN : 0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * ACTIVATED ON THE OTHER DEVICE — noticed, rather than waited out.
   *
   * This screen tells somebody to open their email, and most people open email
   * on their phone. The phone then activates the account and is signed in,
   * while THIS tab carries on saying "open the email" with no way of knowing.
   *
   * The watch reports when the address has been confirmed anywhere, and the
   * server signs this tab in at the same moment. Disabled once this tab has
   * confirmed the code itself — at that point it already has a session and
   * there is nothing left to watch.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const watched = useVerificationWatch({ enabled: !done && !busy });

  useEffect(() => {
    if (!watched?.verified) return;
    if (watched.signedIn) {
      setAuthUser(watched.user);
      // `next` if the visitor was sent here from somewhere, otherwise where the
      // API says a signed-in person belongs.
      router.replace(landingAfterAuth(params, watched));
      router.refresh();
    } else {
      // Confirmed, but the account is blocked. Sign-in explains it properly.
      router.replace(`/login?email=${encodeURIComponent(email || knownEmail)}`);
    }
  }, [watched, router, next, params, email, knownEmail]);

  async function confirm(value = code) {
    if (value.length !== 6 || !email || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const user = await post('/auth/verify-email', { email, code: value }, { noRedirect: true });
      setDone(true);
      forgetWatchToken();
      setAuthUser(user);
      // The API now says where a confirmed account belongs, so typing the code
      // and tapping the link land in the same place. An explicit `?next=` still
      // wins — that is what carries somebody back where they were bounced from.
      router.push(landingAfterAuth(params, user));
      router.refresh();
    } catch (err) {
      setError(err);
      setCode('');
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const data = await post('/auth/resend-verification', { email }, { noRedirect: true });
      setNotice('A new activation email is on its way. Use the newest one — older links stop working.');
      setCooldown(data?.cooldownSeconds || COOLDOWN);
      setCode('');
    } catch (err) {
      setError(err);
    }
  }

  /**
   * THE REPORT BACK. Between the watch noticing and the router arriving there
   * is a paint, and on a slow connection several — so the screen says what has
   * happened rather than sitting on "open the email" for a second longer than
   * it is true, which is the whole complaint this fixes.
   */
  if (watched?.verified) {
    return (
      <div className="es-result" role="status">
        <span className="es-result__mark"><NavIcon name="check" size={32} /></span>
        <div className="fx-stack fx-stack--sm items-center">
          <p className="es-eyebrow">Confirmed</p>
          <h1 className="text-2xl">Your account is active</h1>
          <p className="max-w-[40ch] text-muted">
            {watched.signedIn
              ? 'You activated it on another device. Taking you to your dashboard…'
              : 'You activated it on another device. Sign in to continue.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fx-stack">
      <div className="es-result">
        <span className="es-result__mark"><NavIcon name="mail" size={32} /></span>
        <div className="fx-stack fx-stack--sm items-center">
          <p className="es-eyebrow">One last step</p>
          <h1 className="text-2xl">Check your inbox</h1>
          <p className="max-w-[40ch] text-muted">
            {knownEmail
              ? <>We sent an activation link to <strong className="fx-break text-ink">{knownEmail}</strong>.</>
              : 'Enter the email you signed up with to get a new activation link.'}
          </p>
        </div>
      </div>

      {knownEmail && (
        <ol className="es-steps rounded-(--es-radius-lg) bg-bg-sunken p-5">
          <li className="es-steps__item" data-state="current">
            <span className="es-steps__marker" aria-hidden="true">1</span>
            <div className="es-steps__body">
              <p className="es-steps__title">Open the email from Eventsli</p>
              <p className="text-sm text-muted">Not there after a minute? Check spam or promotions.</p>
            </div>
          </li>
          <li className="es-steps__item" data-state="upcoming">
            <span className="es-steps__marker" aria-hidden="true">2</span>
            <div className="es-steps__body">
              <p className="es-steps__title">Tap “Activate my account”</p>
              <p className="text-sm text-muted">Your account stays inactive until you do. The link works for 48 hours.</p>
            </div>
          </li>
          <li className="es-steps__item" data-state="upcoming">
            <span className="es-steps__marker" aria-hidden="true">3</span>
            <div className="es-steps__body">
              <p className="es-steps__title">You land in your dashboard</p>
              <p className="text-sm text-muted">Signed in and ready to set things up.</p>
            </div>
          </li>
        </ol>
      )}

      {!knownEmail && (
        <Field
          label="Email" type="email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
      )}

      {notice && <p className="es-notice es-notice--info" role="status"><span>{notice}</span></p>}
      {!useCode && <FormError error={error} />}

      <div className="fx-stack fx-stack--sm items-center text-center">
        <button
          type="button"
          onClick={resend}
          disabled={cooldown > 0 || !email}
          className="es-btn es-btn--secondary es-btn--block"
        >
          {cooldown > 0 ? `Resend the email in 0:${String(cooldown).padStart(2, '0')}` : 'Resend the activation email'}
        </button>
      </div>

      <div className="border-t border-border-base pt-4">
        {!useCode ? (
          <button type="button" className="text-sm text-accent underline underline-offset-2" onClick={() => setUseCode(true)}>
            Opened the email on another device? Use the 6-digit code instead
          </button>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); confirm(); }} className="fx-stack fx-stack--sm">
            <p className="text-sm text-ink">Enter the 6-digit code from the same email</p>
            <OtpInput
              value={code}
              onChange={(v) => { setCode(v); setError(null); }}
              // Submitted the moment the sixth digit lands — including when the
              // phone autofills all six at once.
              onComplete={confirm}
              invalid={Boolean(error)}
              disabled={busy}
              label="The 6-digit code from the email"
            />
            <FormError error={error} />
            <SubmitButton busy={busy} busyLabel="Activating…" disabled={code.length !== 6 || !email}>
              Activate with code
            </SubmitButton>
          </form>
        )}
      </div>

      <p className="text-center text-sm text-subtle">
        Wrong address?{' '}
        <Link href={next === '/organizer' ? '/register/organizer' : '/register'} className="text-accent underline">
          Sign up again
        </Link>{' '}
        with the right one.
      </p>
    </div>
  );
}
