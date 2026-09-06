'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post } from '../../utils/apiClient';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';

/**
 * Ask for a reset link.
 *
 * THE ANSWER IS ALWAYS THE SAME, and that is the design. An endpoint that said
 * "no account for that address" is a directory — anyone could check whether a
 * given person has an account, one address at a time. The API returns the same
 * `{ sent: true }` either way, so this screen says the same thing either way.
 *
 * Which puts the weight on the copy: somebody who mistyped their address has to
 * work that out from this page, because nothing else will tell them.
 *
 * The rate limit behind this is keyed on IP ALONE, not IP + email, because
 * keying on the address would give each of a thousand sprayed addresses its own
 * budget — an enumeration probe and a way to have us mail a thousand strangers.
 * So `RATE_LIMITED` is a real outcome here and it gets a real message.
 */
export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/forgot-password', { email: email.trim() }, { noRedirect: true });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="fx-stack">
        <h1 className="text-2xl">Check your inbox</h1>
        <p className="text-muted">
          If <span className="text-ink">{email}</span> has an account, a reset link is on
          its way. It can take a minute, and it may land in spam.
        </p>
        <p className="text-sm text-subtle">
          The link expires, so use it soon. Nothing has changed about your account yet.
        </p>
        <div className="fx-row fx-row--between text-sm">
          <button
            type="button"
            onClick={() => { setSent(false); setEmail(''); }}
            className="text-accent"
          >
            Try a different address
          </button>
          <Link href="/login" className="text-muted hover:text-ink">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h1 className="text-2xl">Reset your password</h1>
        <p className="text-sm text-muted">
          Enter your email and we will send you a link.
        </p>
      </div>

      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <Field
          label="Email" type="email" name="email" autoComplete="email" required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <FormError error={error} />
        <SubmitButton busy={busy} busyLabel="Sending…">Send reset link</SubmitButton>
      </form>

      <p className="text-center text-sm text-muted">
        Remembered it? <Link href="/login" className="text-accent">Sign in</Link>
      </p>
    </div>
  );
}
