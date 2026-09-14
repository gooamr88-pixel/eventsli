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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The last step of signing up: the six digits from the email.
 *
 * Reached from sign-up, and from sign-in when the right password meets an
 * address that was never confirmed — both arrive with `?email=` and `?sent=1`,
 * because a code has already gone out and the resend button starts on its
 * one-minute cooldown rather than inviting a second email straight away.
 *
 * A correct code signs the person in and carries on to `?next=`.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [cooldown, setCooldown] = useState(params.get('sent') === '1' ? COOLDOWN : 0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function confirm(value = code) {
    if (value.length !== 6 || !email || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const user = await post('/auth/verify-email', { email, code: value }, { noRedirect: true });
      setAuthUser(user);
      router.push(next);
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
      setNotice(data?.message || 'A new code is on its way.');
      setCooldown(data?.cooldownSeconds || COOLDOWN);
      setCode('');
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <p className="es-eyebrow">One last step</p>
        <h1 className="text-2xl">Check your email</h1>
        <p className="text-muted">
          {knownEmail
            ? <>We sent a 6-digit code to <strong className="fx-break text-ink">{knownEmail}</strong>. It expires in 10 minutes.</>
            : 'Enter the email you signed up with and the 6-digit code we sent to it.'}
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); confirm(); }}
        className="fx-stack"
      >
        {!knownEmail && (
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}

        <OtpInput
          value={code}
          onChange={(v) => { setCode(v); setError(null); }}
          // Submitted the moment the sixth digit lands — including when the
          // phone autofills all six at once — so there is nothing else to tap.
          onComplete={confirm}
          invalid={Boolean(error)}
          disabled={busy}
          autoFocus
          label="The 6-digit code from the email"
        />

        <FormError error={error} />
        {notice && <p className="es-notice es-notice--info" role="status"><span>{notice}</span></p>}

        <SubmitButton busy={busy} busyLabel="Confirming…" disabled={code.length !== 6 || !email}>
          Confirm email
        </SubmitButton>
      </form>

      <div className="fx-stack fx-stack--sm items-center text-center text-sm">
        <p className="text-muted">Nothing arrived? Check your spam folder, then</p>
        <button
          type="button"
          onClick={resend}
          disabled={cooldown > 0 || !email}
          className="es-btn es-btn--ghost es-btn--sm"
        >
          {cooldown > 0 ? `Send a new code in 0:${String(cooldown).padStart(2, '0')}` : 'Send a new code'}
        </button>
        <p className="text-subtle">
          Wrong address? <Link href="/register" className="text-accent underline">Sign up again</Link> with the right one.
        </p>
      </div>
    </div>
  );
}
