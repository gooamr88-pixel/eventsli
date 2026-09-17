'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { post } from '../../utils/apiClient';
import { setAuthUser } from '../../hooks/useAuth';
import { describeError } from '../../utils/errors';
import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Where the activation link lands.
 *
 * It activates the account and signs the person in, says so plainly, and takes
 * them where they belong — the organizer dashboard for an organizer sign-up —
 * after a short pause, with a button for anyone who would rather not wait.
 *
 * THE TOKEN IS SENT ONCE. React's development double-mount would POST it twice,
 * and the second answer ("already used") would replace the first on screen; a
 * ref guards the call. The token is then taken out of the address bar, so it is
 * not left in history or copied into a support message.
 *
 * The POST happens from the page, not on a GET: mail scanners fetch links to
 * check them, and a link that activated on fetch would be used up by a robot.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const REDIRECT_SECONDS = 4;

export default function ActivateAccount() {
  const router = useRouter();
  const params = useSearchParams();
  const sent = useRef(false);
  const [state, setState] = useState({ phase: 'working', next: '/', error: null });
  const [seconds, setSeconds] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const token = params.get('token') || '';
    try { window.history.replaceState(null, '', '/activate'); } catch { /* not fatal */ }

    (async () => {
      if (!token) {
        setState({ phase: 'failed', next: '/', error: { code: 'INVALID_TOKEN' } });
        return;
      }
      try {
        const user = await post('/auth/activate', { token }, { noRedirect: true });
        setAuthUser(user);
        setState({ phase: 'done', next: user?.next || '/', error: null });
      } catch (err) {
        if (err?.code === 'ALREADY_VERIFIED') {
          setState({ phase: 'already', next: err.meta?.next || '/', error: null });
        } else {
          setState({ phase: 'failed', next: '/', error: err });
        }
      }
    })();
  }, [params]);

  useEffect(() => {
    if (state.phase !== 'done') return undefined;
    if (seconds <= 0) {
      router.replace(state.next);
      router.refresh();
      return undefined;
    }
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [state, seconds, router]);

  const organizer = state.next === '/organizer';

  if (state.phase === 'working') {
    return (
      <div className="es-result" role="status">
        <span className="es-result__mark es-result__mark--busy"><NavIcon name="mail" size={32} /></span>
        <h1 className="text-2xl">Activating your account…</h1>
        <p className="text-muted">This takes a second.</p>
      </div>
    );
  }

  if (state.phase === 'done') {
    return (
      <div className="es-result" role="status">
        <span className="es-result__mark"><NavIcon name="tick" size={36} /></span>
        <div className="fx-stack fx-stack--sm items-center">
          <p className="es-eyebrow">Account activated</p>
          <h1 className="text-3xl">You’re all set</h1>
          <p className="max-w-[38ch] text-muted">
            {organizer
              ? 'Your organizer account is active. Next, tell us about your organization — it takes two minutes.'
              : 'Your account is active and you are signed in.'}
          </p>
        </div>
        <Link href={state.next} className="es-btn es-btn--primary es-btn--lg">
          {organizer ? 'Go to my dashboard' : 'Continue'}
          <NavIcon name="arrow" size={18} />
        </Link>
        <p className="text-sm text-subtle" aria-live="polite">
          Taking you there in {Math.max(seconds, 0)}…
        </p>
      </div>
    );
  }

  if (state.phase === 'already') {
    return (
      <div className="es-result">
        <span className="es-result__mark"><NavIcon name="check" size={34} /></span>
        <div className="fx-stack fx-stack--sm items-center">
          <h1 className="text-2xl">Your account is already active</h1>
          <p className="max-w-[38ch] text-muted">This link has been used. Sign in to continue.</p>
        </div>
        <Link href={`/login?next=${encodeURIComponent(state.next)}`} className="es-btn es-btn--primary es-btn--lg">
          Sign in
        </Link>
      </div>
    );
  }

  const { title, recovery } = describeError(state.error);
  return (
    <div className="es-result">
      <span className="es-result__mark es-result__mark--danger"><NavIcon name="alert" size={32} /></span>
      <div className="fx-stack fx-stack--sm items-center">
        <h1 className="text-2xl">{state.error?.code === 'INVALID_TOKEN' ? 'This link does not work' : title}</h1>
        <p className="max-w-[40ch] text-muted">
          {state.error?.code === 'INVALID_TOKEN'
            ? 'It may be incomplete — try tapping the button in the email again rather than copying the link.'
            : recovery}
        </p>
      </div>
      <Link href="/verify-email" className="es-btn es-btn--primary es-btn--lg">
        Send me a new link
      </Link>
      <p className="text-sm text-muted">
        Or <Link href="/login" className="text-accent">sign in</Link> — if the account is not active yet, we will email you again.
      </p>
    </div>
  );
}
