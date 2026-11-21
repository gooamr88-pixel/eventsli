'use client';

import { useState } from 'react';
import { put } from '../../../utils/apiClient';
import { useToast } from '../../../components/ui/Toast';
import NavIcon from '../../../components/shell/NavIcon';
import Field from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import { eventUrl } from '../../../lib/eventSeo';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PRIVATE EVENT, BEHIND A PASSWORD (owner, 2026-11-22).
 *
 * Its own card with its own Save, outside the details form: the password is a
 * secret, sent once to PUT /events/:id/privacy, hashed there and never read
 * back. It has no business in the form's "unsaved changes" bookkeeping.
 *
 * Rendered inside the details <form>, so it holds no <form> of its own (forms
 * cannot nest). Every input names a form that does not exist (`form=…`), which
 * takes it out of the details form: its `required` cannot block that form's
 * Save, and Enter is caught here to save this card instead.
 *
 * THE LENGTH RULE IS THE ORGANIZER'S: the shortest and longest the password
 * may be, 1 to 100. Guests see the range on the password screen. The stored
 * password is a hash, so a new rule needs the password typed again.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const DETACHED = 'es-privacy-standalone';
const DEFAULT_MIN = 4;
const DEFAULT_MAX = 100;
// The guests' password, not the organizer's sign-in: keep password managers
// from offering to save it over their Eventsli login.
const NO_MANAGER = { autoComplete: 'off', 'data-1p-ignore': 'true', 'data-lpignore': 'true' };

function seed(saved) {
  return {
    isPrivate: Boolean(saved.isPrivate),
    min: String(saved.passwordMin ?? DEFAULT_MIN),
    max: String(saved.passwordMax ?? DEFAULT_MAX),
  };
}

const asInt = (v) => (/^\d{1,3}$/.test(String(v).trim()) ? Number(v) : NaN);

export default function PrivacyCard({ event, onSaved }) {
  const toast = useToast();
  const saved = event.privacy || { isPrivate: false, hasPassword: false, passwordSetAt: null };
  const [form, setForm] = useState(() => seed(saved));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Re-seeded when the saved setting changes (after a save), during render.
  // Keyed on the privacy itself: a save here does not touch `updatedAt`.
  const version = `${saved.isPrivate}|${saved.passwordSetAt || ''}|${saved.passwordMin ?? ''}|${saved.passwordMax ?? ''}`;
  const [seen, setSeen] = useState(version);
  if (version !== seen) {
    setSeen(version);
    setForm(seed(saved));
    setPassword('');
  }

  const editable = !['cancelled', 'completed'].includes(event.status);
  const min = asInt(form.min);
  const max = asInt(form.max);
  const ruleProblem = !Number.isInteger(min) || min < 1 || min > 100
    ? 'Shortest: a number from 1 to 100.'
    : !Number.isInteger(max) || max < 1 || max > 100
      ? 'Longest: a number from 1 to 100.'
      : min > max ? 'The shortest cannot be longer than the longest.' : null;
  const ruleChanged = !ruleProblem
    && (min !== (saved.passwordMin ?? DEFAULT_MIN) || max !== (saved.passwordMax ?? DEFAULT_MAX));
  // Spaces at either end are dropped by the API (guests never type them).
  const length = password.trim().length;
  const passwordProblem = password.length > 0 && !ruleProblem && (length < min || length > max)
    ? (min === max ? `Use exactly ${min} characters.` : `Use ${min} to ${max} characters.`)
    : null;
  const needsPassword = form.isPrivate && (!saved.hasPassword || ruleChanged);
  const dirty = form.isPrivate !== saved.isPrivate || password.length > 0 || ruleChanged;
  const blocked = !dirty || busy || Boolean(ruleProblem) || Boolean(passwordProblem) || (needsPassword && !password);

  async function commit() {
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        isPrivate: form.isPrivate,
        ...(password ? { password } : {}),
        ...(form.isPrivate ? { passwordMin: min, passwordMax: max } : {}),
      };
      const result = await put(`/events/${event.id}/privacy`, body, { noRedirect: true });
      toast.success(result.isPrivate
        ? (password ? 'Saved. Your event is private — share the link and the password with your guests.' : 'Saved. Your event is private.')
        : 'Saved. Your event is public again.');
      setPassword('');
      onSaved?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  // Enter in any box saves THIS card; it must not submit the details form.
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); commit(); }
  };

  // The site's own origin, the same on the server and in the browser.
  const link = eventUrl(event.slug);
  const setOn = saved.passwordSetAt
    ? new Date(saved.passwordSetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const rangeText = ruleProblem ? null : min === max ? `exactly ${min} characters` : `${min} to ${max} characters`;

  let passwordHint;
  if (ruleChanged && saved.hasPassword) passwordHint = `You changed the length, so enter the password again (${rangeText}).`;
  else if (saved.hasPassword) passwordHint = `A password is set${setOn ? ` (since ${setOn})` : ''}. Leave this blank to keep it — a new one signs out everyone who used the old one.`;
  else passwordHint = rangeText ? `${rangeText[0].toUpperCase()}${rangeText.slice(1)}. Send it to your guests with the event link.` : null;

  return (
    <section className="es-dcard" aria-label="Private event">
      <div className="es-dcard__head">
        <div className="es-ovcard__head">
          <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="lock" size={24} /></span>
          <div className="fx-min0">
            <h2 className="es-dcard__title">Private event</h2>
            <p className="es-ovcard__desc">Only people you give the password to can open it.</p>
          </div>
        </div>
      </div>

      <div className="es-qset">
        <div className="es-qset__row" aria-disabled={!editable || undefined}>
          <NavIcon name="eye" size={20} />
          <span className="es-qset__text">
            <b id="qset-private">Make this event private</b>
            <small>Hidden from Eventsli listings, search and your public page. Guests need the password to see details and get tickets.</small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={form.isPrivate}
            aria-labelledby="qset-private"
            className="es-switch"
            disabled={!editable || busy}
            onClick={() => setForm((f) => ({ ...f, isPrivate: !f.isPrivate }))}
          >
            <span aria-hidden className="es-switch__track"><span className="es-switch__thumb" /></span>
          </button>
        </div>
      </div>

      {form.isPrivate && editable && (
        // Enter is caught here for the inputs inside.
        <div className="fx-stack fx-stack--sm" onKeyDown={onKeyDown}>
          {/* The organizer's length rule (owner, 2026-11-22). */}
          <fieldset className="es-privacy-rule">
            <legend className="es-label">Password length</legend>
            <div className="es-privacy-rule__row">
              <label className="es-privacy-rule__field">
                <span className="text-xs text-muted">Shortest</span>
                <input
                  className="es-input es-nums" type="number" inputMode="numeric" min={1} max={100} step={1}
                  value={form.min} form={DETACHED}
                  aria-invalid={ruleProblem?.startsWith('Shortest') || ruleProblem?.startsWith('The shortest') ? 'true' : undefined}
                  aria-describedby="privacy-rule-help"
                  onChange={(e) => setForm((f) => ({ ...f, min: e.target.value }))}
                />
              </label>
              <span className="es-privacy-rule__to" aria-hidden="true">to</span>
              <label className="es-privacy-rule__field">
                <span className="text-xs text-muted">Longest</span>
                <input
                  className="es-input es-nums" type="number" inputMode="numeric" min={1} max={100} step={1}
                  value={form.max} form={DETACHED}
                  aria-invalid={ruleProblem?.startsWith('Longest') || ruleProblem?.startsWith('The shortest') ? 'true' : undefined}
                  aria-describedby="privacy-rule-help"
                  onChange={(e) => setForm((f) => ({ ...f, max: e.target.value }))}
                />
              </label>
              <span className="es-privacy-rule__unit text-xs text-muted">characters</span>
            </div>
            <p id="privacy-rule-help" className={`text-xs ${ruleProblem ? 'text-danger' : 'text-subtle'}`}>
              {ruleProblem || 'Your guests see this range on the password screen.'}
            </p>
          </fieldset>

          <Field
            label={saved.hasPassword && !ruleChanged ? 'New password' : 'Password'}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            form={DETACHED}
            {...NO_MANAGER}
            maxLength={Number.isInteger(max) ? Math.min(max + 10, 100) : 100}
            optional={!needsPassword}
            required={needsPassword}
            error={passwordProblem}
            hint={passwordHint}
          />
        </div>
      )}

      {saved.isPrivate && (
        <p className="text-xs text-subtle fx-break">
          Guests open <b>{link}</b> and enter the password. You see the page without it while signed in.
        </p>
      )}

      <FormError error={error} />

      {editable && (
        <div className="fx-row">
          <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={blocked} onClick={commit}>
            <NavIcon name="tick" size={16} /> {busy ? 'Saving…' : 'Save privacy'}
          </button>
          {dirty && !busy && (
            <button type="button" className="es-btn es-btn--ghost es-btn--sm"
              onClick={() => { setForm(seed(saved)); setPassword(''); setError(null); }}>
              Discard
            </button>
          )}
        </div>
      )}
    </section>
  );
}
