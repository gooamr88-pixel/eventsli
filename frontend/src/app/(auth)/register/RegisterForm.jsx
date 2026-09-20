'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { post } from '../../utils/apiClient';
import { setAuthUser } from '../../hooks/useAuth';
import { safeNext } from '../login/LoginForm';
import { rememberWatchToken } from '../verify-email/useVerificationWatch';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import GoogleSignIn from '../../components/forms/GoogleSignIn';
import AccountTypeChoice from './AccountTypeChoice';
import { landingAfterAuth } from '../../lib/authLanding';
import { MIN_PASSWORD, isWeakPassword } from '../../lib/passwordRules';
import NewPasswordFields from '../../components/forms/NewPassword';

/**
 * Create an account.
 *
 * `POST /auth/register` creates the profile and emails a 6-digit code; it does
 * NOT sign anyone in until that code is entered on /verify-email, which then
 * issues the one session. So this never calls /auth/login afterwards — an
 * earlier version signed in after registering and left an orphaned second
 * session on the account's "Where you are signed in" list.
 */
export default function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));

  const [form, setForm] = useState({
    fullName: '', email: '', password: '', confirmPassword: '', phone: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /**
   * The submit gate mirrors the three rules the API applies, and nothing more.
   *
   * It is a convenience, not a control: the server re-checks every one of them
   * and is the only thing that decides. Gating on MORE than the server would
   * mean a password this form refuses and the API would have taken.
   */
  const blocked = form.password.length < MIN_PASSWORD
    || isWeakPassword(form.password, { email: form.email })
    || form.password !== form.confirmPassword;

  function arrive(user) {
    setAuthUser(user);
    // An explicit `?next=` wins; otherwise the API says where a signed-in
    // person belongs. See the same note in LoginForm.
    router.push(landingAfterAuth(params, user));
    router.refresh();
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const account = await post('/auth/register', {
        // Stated, not defaulted: the choice the chooser above made is what the
        // account is created with, and it is stored on the row.
        accountType: 'buyer',
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        // Sent only when given: the API rejects an empty string as a malformed
        // phone number rather than treating it as absent.
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      }, { noRedirect: true });

      if (account?.verificationRequired) {
        // Handed to the waiting screen so it can notice the activation happening
        // on a phone instead of sitting on "open your email" forever.
        rememberWatchToken(account.watchToken);
        const query = new URLSearchParams({ email: account.email || form.email, sent: '1' });
        if (next !== '/') query.set('next', next);
        router.push(`/verify-email?${query}`);
        return;
      }
      arrive(account);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h1 className="text-2xl">Create an account</h1>
      </div>

      {/* The choice, before anything is typed. It is stored on the account and
          decides which screen they open on — see AccountTypeChoice. */}
      <AccountTypeChoice current="buyer" next={params.get('next') ? next : null} />

      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <Field
          label="Full name" name="fullName" autoComplete="name" required
          minLength={2} maxLength={120}
          value={form.fullName}
          onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
        />
        <Field
          label="Email" type="email" name="email" autoComplete="email" required
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        {/* Length over composition, matching the API — which follows current
            NIST guidance. Demanding a symbol and a digit reliably produces
            `Password1!`, which is harder to remember and easier to guess than
            a longer phrase. The requirements are ticked live here rather than
            discovered by pressing the button. */}
        <NewPasswordFields
          email={form.email}
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          confirm={form.confirmPassword}
          onConfirmChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
        />
        <Field
          label="Phone" type="tel" name="phone" autoComplete="tel"
          hint="Optional. Only shared with the organizer of an event you buy from."
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />

        <FormError error={error} />

        <SubmitButton busy={busy} busyLabel="Creating your account…" disabled={blocked}>
          Create account
        </SubmitButton>
      </form>

      <p className="text-center text-sm text-muted">
        Already have one?{' '}
        <Link
          href={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}
          className="text-accent"
        >
          Sign in
        </Link>
      </p>

      <div className="fx-row fx-row--center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border-base" />
        <span className="text-xs text-subtle">or</span>
        <span className="h-px flex-1 bg-border-base" />
      </div>

      {/* Google both creates and signs in, so one control covers both. The API
          returns `newAccount` to say which happened. */}
      <GoogleSignIn text="signup_with" onSuccess={arrive} onError={setError} />

      <p className="text-center text-xs text-subtle">
        By continuing you agree to the{' '}
        <Link href="/terms" className="text-accent">terms</Link> and the{' '}
        <Link href="/privacy" className="text-accent">privacy policy</Link>.
      </p>
    </div>
  );
}
