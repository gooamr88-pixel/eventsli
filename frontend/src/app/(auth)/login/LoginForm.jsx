'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { post } from '../../utils/apiClient';
import { setAuthUser } from '../../hooks/useAuth';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import GoogleSignIn from '../../components/forms/GoogleSignIn';

/**
 * Sign in.
 *
 * Two details here are load-bearing and both come from the API's own design:
 *
 * A 401 on THIS page means "wrong password", not "your session expired" —
 * `apiFetch` knows the difference and passes the server's message through
 * instead of bouncing to /login from /login, which would swallow it and leave
 * the form silent.
 *
 * `?next=` carries where the visitor was going. `proxy.ts` sets it when it
 * bounces someone off a protected page, and the header sets it too. It is
 * validated as a same-origin PATH before use — an absolute URL there is an open
 * redirect, and `//evil.test` is an absolute URL that begins with a slash.
 */
export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const expired = params.get('reason') === 'expired';
  const next = safeNext(params.get('next'));

  function arrive(user) {
    // Seeded straight from the response so the next paint already knows who
    // this is, instead of rendering a signed-out header for one round trip.
    setAuthUser(user);
    router.push(next);
    router.refresh();
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      arrive(await post('/auth/login', form, { noRedirect: true }));
    } catch (err) {
      // The right password on an address that was never confirmed. The API has
      // already sent a fresh code, so this goes straight to where it is typed.
      if (err?.code === 'EMAIL_NOT_VERIFIED') {
        const query = new URLSearchParams({ email: err.meta?.email || form.email, sent: '1' });
        if (next !== '/') query.set('next', next);
        router.push(`/verify-email?${query}`);
        return;
      }
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h1 className="text-2xl">Sign in</h1>
        {expired && (
          <p className="rounded-[--es-radius-md] bg-warning/10 px-3 py-2.5 text-sm text-muted">
            Your session ended. Sign in again to pick up where you left off.
          </p>
        )}
      </div>

      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        />

        <FormError error={error} />

        <SubmitButton busy={busy} busyLabel="Signing in…">Sign in</SubmitButton>
      </form>

      <div className="fx-row fx-row--between text-sm">
        <Link href="/forgot-password" className="text-accent">Forgot your password?</Link>
        <Link href={`/register${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="text-muted hover:text-ink">
          Create an account
        </Link>
      </div>

      <Divider />

      <GoogleSignIn onSuccess={arrive} onError={setError} />

      <p className="text-center text-xs text-subtle">
        Bought as a guest? You do not need an account —{' '}
        {/* Underlined because it sits INSIDE a sentence: colour alone is not
            enough to mark a link in body text (WCAG 1.4.1). The two links
            above are their own row and do not need it. */}
        <Link href="/tickets/find" className="text-accent underline">find your tickets</Link>.
      </p>
    </div>
  );
}

function Divider() {
  return (
    <div className="fx-row fx-row--center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-border-base" />
      <span className="text-xs text-subtle">or</span>
      <span className="h-px flex-1 bg-border-base" />
    </div>
  );
}

/**
 * Same-origin paths only.
 *
 * The two checks are not redundant: `startsWith('/')` alone lets through
 * `//evil.test`, which a browser resolves as a protocol-relative absolute URL.
 */
export function safeNext(value) {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
