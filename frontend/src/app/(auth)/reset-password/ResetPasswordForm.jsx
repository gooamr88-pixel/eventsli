'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { post } from '../../utils/apiClient';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import { MIN_PASSWORD, isWeakPassword } from '../../lib/passwordRules';
import NewPasswordFields from '../../components/forms/NewPassword';

/**
 * Choose a new password, from the emailed link.
 *
 * NO SESSION IS ISSUED on success, and that is deliberate on the API's side:
 * signing someone in straight off a link that arrived by email would make a
 * stolen link a session. Making them sign in with the password they just chose
 * proves they know it. So this ends on "now sign in", not on a dashboard — and
 * the copy has to make that read as the end of a job rather than as a step that
 * failed.
 */
export default function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /**
   * The SAME gate as sign-up. A recovery flow that accepts what registration
   * refuses is a way around registration, so the rules are one module and both
   * screens read it — and the API applies them identically to all three
   * password endpoints regardless of what any form decides.
   *
   * No `email` context here on purpose: this page deliberately does not know
   * the address (see the note in the form below), so the "must not contain your
   * email" rule is one only the server can apply. It does.
   */
  const blocked = password.length < MIN_PASSWORD
    || isWeakPassword(password)
    || password !== confirmPassword;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/reset-password', { token, password }, { noRedirect: true });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="fx-stack">
        <h1 className="text-2xl">That link is incomplete</h1>
        <p className="text-muted">
          It may have been cut short by your email app. Ask for a new one — they are
          quick to send.
        </p>
        <Link
          href="/forgot-password"
          className="es-btn es-btn--primary self-start"
        >
          Send a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="fx-stack">
        <h1 className="text-2xl">Password changed</h1>
        <p className="text-muted">
          Sign in with your new password. Any other devices you were signed in on have
          been signed out.
        </p>
        <Link
          href="/login"
          className="es-btn es-btn--primary self-start"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h1 className="text-2xl">Choose a new password</h1>
        <p className="text-sm text-muted">
          This also signs you out everywhere else.
        </p>
      </div>

      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        {/* The email address is not shown and not asked for: the token already
            identifies the account, and printing the address would tell anyone
            who intercepted the link whose account it opens. */}
        <NewPasswordFields
          label="New password"
          confirmLabel="Confirm new password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          confirm={confirmPassword}
          onConfirmChange={(e) => setConfirmPassword(e.target.value)}
        />

        <FormError error={error} />

        <SubmitButton busy={busy} busyLabel="Saving…" disabled={blocked}>
          Change password
        </SubmitButton>
      </form>

      <p className="text-center text-sm text-muted">
        Link expired?{' '}
        <Link href="/forgot-password" className="text-accent">Send a new one</Link>
      </p>
    </div>
  );
}
