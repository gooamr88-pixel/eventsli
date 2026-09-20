'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { signOut } from '../../hooks/useAuth';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Sign out?" — once, for every place that asks.
 *
 * THE WORD IS "SIGN OUT", not "log out". Every existing control says it — the
 * header, the mobile menu, the sidebar, "Sign out everywhere" in account
 * security, and the door scanner's "Sign this device out?". Renaming all of
 * them would be a product-wide terminology change, and using the other word in
 * only the dialog would be worse than either: the button says one thing and the
 * confirmation asks about another.
 *
 * Sign-out was immediate in all four places it was offered: the desktop header,
 * the mobile menu, the console sidebar, and "sign out everywhere" in account
 * security. On a shared laptop at a venue office — which `ShellFoot.jsx` names
 * as a real place this gets opened — the sidebar's "Sign out" sits one row under
 * "Back to site", and the cost of the slip is an organizer re-authenticating
 * mid-event.
 *
 * WHY NOT `useConfirm()`. That is the right tool and it was the first attempt.
 * `ConfirmProvider` is mounted in `admin/layout.jsx` and `organizer/layout.jsx`
 * ONLY — not at the root — and `useConfirm` falls back to `REFUSE`, a function
 * that resolves `null`, when there is no provider. In the site header, which is
 * where a buyer signs out, every "Log out" would have opened nothing and then
 * silently done nothing. Mounting the provider globally would put the toast and
 * confirm runtime into the storefront bundle for a dialog that opens on one
 * click, so this component carries its own.
 *
 * WHAT THE NATIVE <dialog> IS DOING, and why there is no focus code here:
 * `showModal()` traps Tab, closes on Escape, makes the rest of the document
 * inert, and RESTORES FOCUS to whatever was focused before when it closes. All
 * four are things a hand-rolled modal gets at least one of wrong, and
 * `Confirm.jsx` makes the same argument for the same reason. Unmounting runs
 * `close()` in the cleanup, which is what restores focus to the button that
 * opened it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function LogoutConfirmDialog({
  onCancel,
  /** Where to land afterwards. Passed through to `signOut`. */
  next = '/',
  /**
   * Replaces the default sign-out with something else that ends the session —
   * "sign out everywhere" revokes every other session first. It is still a
   * logout, so it gets this dialog rather than one of its own.
   */
  onConfirm,
  title = 'Sign out?',
  body = 'You will need to sign in again to get back to your account.',
  confirmLabel = 'Sign out',
  busyLabel = 'Signing out…',
}) {
  const ref = useRef(null);
  const titleId = useId();
  const bodyId = useId();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    // jsdom and some older engines have no showModal; the dialog still renders.
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => { if (dialog.open && typeof dialog.close === 'function') dialog.close(); };
  }, []);

  async function confirm() {
    // The guard is the duplicate-submission protection. `signOut` posts to
    // `/auth/logout`, and a second click before the navigation commits spends
    // another request revoking a session that is already gone.
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await (onConfirm ? onConfirm() : signOut(next));
      // Nothing after this line normally runs: `signOut` ends in
      // `window.location.assign`, so the document is already going away.
    } catch {
      /**
       * `signOut` swallows its own network failure and navigates anyway —
       * somebody who clicked "log out" must not be left sitting on their
       * account page because a request failed. So reaching this branch means
       * something further out broke, and the honest thing is to hand the
       * decision back rather than to claim they are signed out.
       */
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <dialog
      ref={ref}
      className="es-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // Escape closes the native dialog on its own and would leave this
      // component mounted with nothing on screen. Cancelled explicitly instead.
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
    >
      <div className="es-dialog__body">
        <h2 id={titleId} className="text-lg text-ink">{title}</h2>
        <p id={bodyId} className="text-sm text-muted">{body}</p>

        {failed && (
          <p role="alert" className="text-sm text-danger">
            We could not sign you out just now. Check your connection and try again.
          </p>
        )}
      </div>

      <div className="es-dialog__actions">
        <button
          type="button"
          className="es-btn es-btn--secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        {/* `--danger`, because it is the terminal action on this screen. The
            label changes rather than being swapped for a spinner: a spinner
            alone tells a screen reader nothing, `aria-busy` plus real text
            does. That is `SubmitButton`'s rule, kept for a button that cannot
            be one — this dialog has no form to submit. */}
        <button
          type="button"
          className="es-btn es-btn--danger"
          onClick={confirm}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/**
 * The button and its dialog, together.
 *
 * Every plain "Sign out" in the product is one of these, so the copy, the
 * destructive styling and the busy behaviour cannot drift between the header,
 * the mobile menu and the console sidebar. `className` and `children` are the
 * only things a call site varies, because the three of them sit in visually
 * different furniture — a ghost button in the bar, a full-width row in the
 * menu, a nav item in the sidebar.
 */
export default function LogoutButton({ className = '', children = 'Sign out', next = '/', ...props }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} {...props}>
        {children}
      </button>
      {open && <LogoutConfirmDialog next={next} onCancel={() => setOpen(false)} />}
    </>
  );
}
