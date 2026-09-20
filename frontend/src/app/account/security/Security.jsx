'use client';

import { useCallback, useEffect, useState } from 'react';
import { get, post, del } from '../../utils/apiClient';
import { formatEventTime } from '../../lib/eventTime';
import { useAuth, signOut } from '../../hooks/useAuth';
import { LogoutConfirmDialog } from '../../components/auth/LogoutConfirm';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import { Loading, ErrorNotice } from '../../components/Feedback';
import { PageHeader } from '../../components/ui/Page';
import { MIN_PASSWORD, isWeakPassword } from '../../lib/passwordRules';
import NewPasswordFields from '../../components/forms/NewPassword';
import { roleLabel } from '../../lib/roleLadder';
import { workspacesFor, WORKSPACE } from '../../lib/workspaces';

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
      {/* The heading is this screen's own. It used to come from
          `account/layout.jsx`, which made the reader's NAME the `<h1>` of every
          page under it — so this page and My tickets shared one heading and
          neither said which page it was. */}
      <PageHeader
        eyebrow="Your account"
        title="Sign-in & security"
        lede="Who you are here, where you are signed in, and your password."
      />

      {user && (
        <section className="fx-stack fx-stack--sm es-card p-5">
          <h2 className="text-lg">Account</h2>
          <dl className="fx-stack fx-stack--sm text-sm">
            <Row term="Name">{user.fullName}</Row>
            <Row term="Email">{user.email}</Row>
            {/**
              * TWO ROWS, WHERE THERE WAS ONE THAT SAID "attendee".
              *
              * This card printed `user.role` raw, so an ordinary buyer read
              * "Role: attendee" — a word that appears nowhere else in the
              * product — and somebody who had signed up to sell but not finished
              * setting up read the same thing, with no hint that the product knew
              * otherwise. It was the account type / permission confusion in its
              * most literal form: one field, showing the wrong one of the two
              * facts, in the one place a person goes to check who they are.
              *
              * `What this account is for` is `account_types`: the preference,
              * and the thing that decides which workspaces exist for them.
              * `Permissions` is the role, through `roleLabel` so it reads as
              * English, and it is shown only for staff — "Attendee" as a
              * permission level is an implementation detail that means nothing
              * to the person reading it, while "Admin" is something they need to
              * know is switched on.
              */}
            <Row term="What this is for">{describeTypes(user)}</Row>
            {user.isAdmin && <Row term="Permissions">{roleLabel(user.role)}</Row>}
          </dl>
        </section>
      )}

      <SessionList sessions={sessions} error={error} onChanged={refresh} />
      <ChangePassword />
    </div>
  );
}

/**
 * The account's types in the product's own words.
 *
 * `workspacesFor` rather than `accountTypes` directly, so this says the same
 * thing the sidebar's switcher does — an organizer whose type column predates
 * the column gets "Buying and organizing" here and the organizer workspace
 * there, instead of the two disagreeing.
 *
 * Admin is left out on purpose: it is a permission, not what the account is for,
 * and it has its own row above.
 */
function describeTypes(user) {
  const mine = workspacesFor(user);
  return mine.includes(WORKSPACE.ORGANIZER)
    ? 'Buying tickets and organizing events'
    : 'Buying tickets';
}

function SessionList({ sessions, error, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  // "Sign out everywhere" ends every session including this one, so it is the
  // most terminal control in the account area and gets the same confirmation
  // the ordinary sign-out does — the shared dialog, with copy that says what
  // makes this one different.
  const [confirmAll, setConfirmAll] = useState(false);

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
    setActionError(null);
    try {
      await post('/auth/logout-all', undefined, { noRedirect: true });
      // `logout-all` revokes THIS session as well, so there is nothing left to
      // stay signed in with.
      await signOut('/login');
    } catch (err) {
      /**
       * Caught rather than rethrown, and the dialog is closed.
       *
       * The dialog's own failure line is deliberately generic. This endpoint
       * answers with a specific one — a rate limit, a revoked session — and
       * the panel already renders it. Letting this reach the dialog would put
       * the vague sentence in front of the precise one.
       */
      setActionError(err);
      setConfirmAll(false);
    }
  }

  return (
    <section className="fx-stack fx-stack--sm es-card p-5">
      <div className="fx-row fx-row--between">
        <h2 className="text-lg">Where you are signed in</h2>
        {/* Both controls in this panel end sessions, and both were ~20px lines
            of text. `.es-btn--ghost` gives them the 44px floor and the press
            feedback every other button in the product has, while staying quiet
            enough to sit beside a heading.

            `text-danger` on top of the component class is deliberate and it
            works because of the layer order this file's header argues for:
            utilities beat `@layer components`, so the tone survives without
            inventing an `.es-btn--ghost-danger`.

            THE COMMENT IS OUT HERE, above the guard, and that is not a style
            choice. `{/* … *}` is only valid in JSX CHILDREN position; the
            parenthesis after `&&` is an EXPRESSION position, where the first
            thing must be the element itself. Inside it, the parser reads `{` as
            the start of an object literal and fails on the first JSX attribute
            with "Expected '</', got 'type'" — pointing at the `<button>` two
            lines down rather than at the comment that caused it. */}
        {sessions?.length > 1 && (
          <button
            type="button"
            onClick={() => setConfirmAll(true)}
            className="es-btn es-btn--ghost es-btn--sm text-danger"
          >
            Sign out everywhere
          </button>
        )}
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={onChanged} />
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
                className="es-btn es-btn--ghost es-btn--sm whitespace-nowrap"
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

      {/* The shared dialog, with this action's own words. `onConfirm` replaces
          the plain sign-out: every OTHER session has to be revoked before this
          one lets go, and the dialog owns the busy state and the
          double-click guard either way. */}
      {confirmAll && (
        <LogoutConfirmDialog
          title="Sign out everywhere?"
          body="Every device signed in to this account is signed out, including this one. You will need to sign in again."
          confirmLabel="Sign out everywhere"
          busyLabel="Ending sessions…"
          onConfirm={endAll}
          onCancel={() => setConfirmAll(false)}
        />
      )}
    </section>
  );
}

function ChangePassword() {
  // The address is read here only so the "must not contain your email" rule can
  // be shown while typing. It is the same rule the API applies, and the API is
  // what enforces it.
  const { user } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  // The same three rules the API applies to every password-setting endpoint.
  const blocked = form.newPassword.length < MIN_PASSWORD
    || isWeakPassword(form.newPassword, { email: user?.email })
    || form.newPassword !== form.confirmPassword;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      /**
       * NAMED FIELDS, not the whole `form`.
       *
       * It used to be `post(..., form)`, which was fine while the state held
       * exactly the two keys the endpoint wants. It now also holds
       * `confirmPassword`, and spreading the object would put a second copy of
       * the password on the wire for an endpoint that never asked for one. The
       * confirmation is a browser-side check and has no reason to leave it.
       */
      await post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      }, { noRedirect: true });
      setDone(true);
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
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
          <NewPasswordFields
            label="New password"
            confirmLabel="Confirm new password"
            name="newPassword"
            email={user?.email}
            value={form.newPassword}
            onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
            confirm={form.confirmPassword}
            onConfirmChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
          />
          {/* Kept from the old hint, as its own line. It is a CONSEQUENCE of
              the change rather than a rule about the password, so it does not
              belong in the requirement checklist beside "at least 12
              characters" — and it is the sentence somebody most needs before
              they press the button. */}
          <p className="text-xs text-subtle">
            Changing this signs out every other device.
          </p>
          <FormError error={error} />
          <SubmitButton busy={busy} busyLabel="Saving…" disabled={blocked}>
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
