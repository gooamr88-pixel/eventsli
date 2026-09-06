'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { post } from '../../utils/apiClient';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';

const MIN_PASSWORD = 12;

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
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;

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
          className="self-start rounded-[--es-radius-md] bg-accent px-4 py-2.5 text-sm font-medium text-on-accent"
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
          className="self-start rounded-[--es-radius-md] bg-accent px-4 py-2.5 text-sm font-medium text-on-accent"
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
        <Field
          label="New password" type="password" name="password"
          autoComplete="new-password" required minLength={MIN_PASSWORD}
          hint={`At least ${MIN_PASSWORD} characters. A short phrase works well.`}
          error={tooShort ? `${MIN_PASSWORD - password.length} more to go.` : null}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <FormError error={error} />

        <SubmitButton busy={busy} busyLabel="Saving…" disabled={tooShort}>
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
