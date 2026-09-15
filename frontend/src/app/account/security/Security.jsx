'use client';

import { useCallback, useEffect, useState } from 'react';
import { get, post, del } from '../../utils/apiClient';
import { formatEventTime } from '../../lib/eventTime';
import { useAuth, signOut } from '../../hooks/useAuth';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import { Loading, ErrorNotice } from '../../components/Feedback';

const MIN_PASSWORD = 12;

/**
 * Sessions and the password.
 *
 * The sessions list is the visible half of something the API does that most
 * cookie auth does not: every token is backed by a row keyed on `jti`, and that
 * row is checked on EVERY request. Ending a session here is not clearing a
 * cookie on this device — it revokes the row, so the token stops working on the
 * device that holds it, at its next request. That is what makes "sign out
 * everywhere" and a lost-phone recovery real rather than decorative.
 */
export default function Security() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/auth/sessions', { cache: 'no-store' });
        if (!cancelled) { setSessions(Array.isArray(data) ? data : []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  return (
    <div className="fx-stack">
      {user && (
        <section className="fx-stack fx-stack--sm es-card p-5">
          <h2 className="text-lg">Account</h2>
          <dl className="fx-stack fx-stack--sm text-sm">
            <Row term="Name">{user.fullName}</Row>
            <Row term="Email">{user.email}</Row>
            <Row term="Role">{user.role}</Row>
          </dl>
        </section>
      )}

      <SessionList sessions={sessions} error={error} onChanged={refresh} />
      <ChangePassword />
    </div>
  );
}

function SessionList({ sessions, error, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);

  async function end(session) {
    setBusy(session.id);
    setActionError(null);
    try {
      await del(`/auth/sessions/${session.id}`, { noRedirect: true });
      // Ending the CURRENT session clears this device's cookie too, so staying
      // on the page would mean every subsequent request 401s and bounces
      // mid-action. Leaving deliberately is the honest outcome.
      //
      // `assign()` rather than `location.href = …`: assigning to a property of
      // a global inside a component is a mutation the React 19 lint refuses,
      // and rightly — it cannot tell an event handler from a render. A method
      // call says the same thing and is the more explicit API.
      //
      // A hard navigation, not router.push: the session is gone server-side, so
      // the whole client tree and its cached auth state have to go with it.
      //
      // Next 16.3 added a lint rule preferring router.push here. It is right in
      // general and wrong in this one case, which is the whole reason the rule
      // is disabled by name rather than the line rewritten: a soft navigation
      // keeps the React tree alive, and with it useAuth's module-level store —
      // so the page after "sign out everywhere" would still say who you were.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (session.current) { window.location.assign('/login'); return; }
      onChanged();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  }

  async function endAll() {
    setBusy('all');
    setActionError(null);
    try {
      await post('/auth/logout-all', undefined, { noRedirect: true });
      // `logout-all` revokes THIS session as well, so there is nothing left to
      // stay signed in with.
      await signOut('/login');
    } catch (err) {
      setActionError(err);
      setBusy(null);
    }
  }

  return (
    <section className="fx-stack fx-stack--sm es-card p-5">
      <div className="fx-row fx-row--between">
        <h2 className="text-lg">Where you are signed in</h2>
        {sessions?.length > 1 && (
          <button
            type="button"
            onClick={endAll}
            disabled={busy === 'all'}
            className="text-sm text-danger hover:underline disabled:opacity-40"
          >
            {busy === 'all' ? 'Ending…' : 'Sign out everywhere'}
          </button>
        )}
      </div>

      {error ? (
        <ErrorNotice error={error} />
      ) : !sessions ? (
        <Loading variant="list" />
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="fx-row fx-row--between border-t border-border-base pt-3 first:border-0 first:pt-0"
            >
              <div className="fx-min0">
                <p className="fx-truncate text-sm text-ink">
                  {/* The user agent, plainly. It is what the API records, and
                      dressing it up as "Chrome on macOS" invents a confidence
                      the string does not support. */}
                  {s.device || 'Unknown device'}
                  {s.current && <span className="text-accent"> · this device</span>}
                </p>
                <p className="text-xs text-subtle">
                  Signed in {when(s.issuedAt)}
                  {s.lastSeenAt && ` · last used ${when(s.lastSeenAt)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => end(s)}
                disabled={busy === s.id}
                className="whitespace-nowrap text-sm text-muted hover:text-danger disabled:opacity-40"
              >
                {busy === s.id ? 'Ending…' : s.current ? 'Sign out' : 'End'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <FormError error={actionError} />

      <p className="text-xs text-subtle">
        Ending a session stops that device working immediately — not when it next
        signs out.
      </p>
    </section>
  );
}

function ChangePassword() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const tooShort = form.newPassword.length > 0 && form.newPassword.length < MIN_PASSWORD;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/change-password', form, { noRedirect: true });
      setDone(true);
      setForm({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fx-stack fx-stack--sm es-card p-5">
      <h2 className="text-lg">Change your password</h2>

      {done ? (
        <div className="fx-stack fx-stack--sm">
          <p className="rounded-(--es-radius-md) bg-accent-wash px-3 py-2.5 text-sm text-ink">
            Password changed. Every other device has been signed out.
          </p>
          <button
            type="button"
            onClick={() => setDone(false)}
            className="self-start text-sm text-accent"
          >
            Change it again
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="fx-stack fx-stack--sm">
          <Field
            label="Current password" type="password" name="currentPassword"
            autoComplete="current-password" required
            value={form.currentPassword}
            onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
          />
          <Field
            label="New password" type="password" name="newPassword"
            autoComplete="new-password" required minLength={MIN_PASSWORD}
            hint={`At least ${MIN_PASSWORD} characters. This signs out every other device.`}
            error={tooShort ? `${MIN_PASSWORD - form.newPassword.length} more to go.` : null}
            value={form.newPassword}
            onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
          />
          <FormError error={error} />
          <SubmitButton busy={busy} busyLabel="Saving…" disabled={tooShort}>
            Change password
          </SubmitButton>
        </form>
      )}
    </section>
  );
}

function Row({ term, children }) {
  return (
    <div className="fx-row items-start">
      <dt className="w-20 flex-none font-mono text-[11px] uppercase tracking-[0.09em] text-subtle">
        {term}
      </dt>
      <dd className="fx-min0 fx-break text-ink">{children}</dd>
    </div>
  );
}

/** Your own clock, with the zone named — a session is not about any one event. */
function when(iso) {
  if (!iso) return 'unknown';
  return formatEventTime(iso);
}
