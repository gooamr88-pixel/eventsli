'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { post } from '../../utils/apiClient';
import { useAuth, signOut } from '../../hooks/useAuth';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import { Loading } from '../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The consent step of "Sign in with Eventsli" (authorization code + PKCE; the
 * mechanics are in backend/services/appAuthService.js).
 *
 * The app sent only a CHALLENGE — the hash of a secret it kept. Pressing Allow
 * asks the API for a one-time code bound to it and sends the browser back to
 * the app with that code. Anyone who intercepts the code still lacks the
 * secret, so it is worthless to them.
 *
 * An explicit button, never an automatic redirect: a page that silently hands
 * a sign-in to whatever opened it would let any app that can open a browser
 * sign in as whoever is signed in to the site.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// What the app sends. The API re-checks both; these only stop the page from
// offering a button that cannot work.
const CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;
const APP_SCHEME = /^eventsli-checkin(-[a-z]+)?:\/\//;

function withParams(uri, params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return `${uri}${uri.includes('?') ? '&' : '?'}${query}`;
}

export default function AppAuthorize() {
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  const challenge = params.get('code_challenge') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const state = params.get('state') || '';
  const method = params.get('code_challenge_method') || 'S256';
  const valid = CHALLENGE.test(challenge) && APP_SCHEME.test(redirectUri) && method === 'S256';

  if (loading) return <Loading variant="card" />;

  if (!valid) {
    return (
      <div className="fx-stack">
        <h1 className="text-2xl">This sign-in link is not complete</h1>
        <p className="text-muted">
          Open the Eventsli Check-in app and tap <strong>Sign in with Eventsli</strong> again.
        </p>
      </div>
    );
  }

  async function allow() {
    setBusy(true);
    setError(null);
    try {
      const { code } = await post('/auth/app/authorize', { codeChallenge: challenge, redirectUri });
      const back = withParams(redirectUri, { code, state });
      setSent(back);
      window.location.assign(back);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  function cancel() {
    window.location.assign(withParams(redirectUri, { error: 'access_denied', state }));
  }

  if (sent) {
    return (
      <div className="fx-stack">
        <h1 className="text-2xl">Returning to the app…</h1>
        <p className="text-muted">You can close this page once Eventsli Check-in opens.</p>
        <p className="text-sm text-subtle">
          Nothing happened?{' '}
          <a href={sent} className="text-accent underline">Open Eventsli Check-in</a>
        </p>
      </div>
    );
  }

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <p className="font-mono text-xs uppercase tracking-[0.1em] text-accent">Eventsli Check-in</p>
        <h1 className="text-2xl">Sign in to the check-in app?</h1>
        <p className="text-muted">
          The app will be signed in as <strong className="fx-break text-ink">{user?.email}</strong>. It can
          scan tickets for the events you organize or work the door for — nothing else.
        </p>
      </div>

      <p className="rounded-(--es-radius-md) bg-bg-sunken px-3 py-2 text-sm text-muted">
        Only continue if you just tapped <strong>Sign in with Eventsli</strong> in the app on your own phone.
      </p>

      <FormError error={error} />

      <div className="fx-stack fx-stack--sm">
        <SubmitButton type="button" onClick={allow} busy={busy} busyLabel="Signing the app in…">
          Allow and return to the app
        </SubmitButton>
        <button type="button" onClick={cancel} className="es-btn es-btn--secondary" disabled={busy}>
          Cancel
        </button>
      </div>

      <p className="text-center text-sm text-subtle">
        Not you?{' '}
        <button
          type="button"
          className="fx-touch text-accent underline"
          onClick={() => signOut(`/login?next=${encodeURIComponent(`/app-auth?${params.toString()}`)}`)}
        >
          Use a different account
        </button>
      </p>
    </div>
  );
}
