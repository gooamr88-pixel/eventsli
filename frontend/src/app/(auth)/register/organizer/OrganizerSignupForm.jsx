'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { post } from '../../../utils/apiClient';
import Field from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';

/** The API's rule, mirrored so it can be shown before the round trip. */
const MIN_PASSWORD = 12;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Sign up to sell tickets.
 *
 * Only what is needed to open the account: who they are, the organization,
 * a mobile number, the email, a password, and the two agreements. Everything
 * else about the organization is asked on the setup step after activation, when
 * they are already inside the dashboard and can see why it is being asked.
 *
 * Nothing is signed in here. The API emails an activation link; the next screen
 * says so, and the link is what opens the dashboard.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OrganizerSignupForm() {
  const router = useRouter();
  const termsId = useId();
  const privacyId = useId();
  const [form, setForm] = useState({
    fullName: '', organizationName: '', phone: '', email: '', password: '',
    acceptTerms: false, acceptPrivacy: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const tick = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.checked }));
  const tooShort = form.password.length > 0 && form.password.length < MIN_PASSWORD;
  const ready = form.acceptTerms && form.acceptPrivacy && !tooShort;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const account = await post('/auth/register', {
        accountType: 'organizer',
        fullName: form.fullName.trim(),
        organizationName: form.organizationName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        password: form.password,
        acceptTerms: form.acceptTerms,
        acceptPrivacy: form.acceptPrivacy,
      }, { noRedirect: true });

      const query = new URLSearchParams({
        email: account?.email || form.email.trim(),
        sent: '1',
        next: '/organizer',
      });
      router.push(`/verify-email?${query}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <p className="es-eyebrow">For organizers</p>
        <h1 className="text-2xl">Start selling tickets</h1>
        <p className="text-sm text-muted">
          Create your organizer account. It takes a minute — we will email you a link to activate it.
        </p>
      </div>

      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <Field
          label="Your name" name="fullName" autoComplete="name" required
          minLength={2} maxLength={120}
          value={form.fullName} onChange={set('fullName')}
        />
        <Field
          label="Organization name" name="organizationName" autoComplete="organization" required
          minLength={2} maxLength={160}
          hint="The company, club or collective running the events."
          value={form.organizationName} onChange={set('organizationName')}
        />
        <Field
          label="Mobile number" type="tel" name="phone" autoComplete="tel" required
          inputMode="tel" minLength={7} maxLength={20}
          placeholder="+1 416 555 0123"
          hint="Only used by Eventsli to reach you about your events."
          value={form.phone} onChange={set('phone')}
        />
        <Field
          label="Email" type="email" name="email" autoComplete="email" required
          hint="Your activation link is sent here."
          value={form.email} onChange={set('email')}
        />
        <Field
          label="Password" type="password" name="password" autoComplete="new-password" required
          minLength={MIN_PASSWORD}
          hint={`At least ${MIN_PASSWORD} characters. A short phrase works well.`}
          error={tooShort ? `${MIN_PASSWORD - form.password.length} more to go.` : null}
          value={form.password} onChange={set('password')}
        />

        <fieldset className="fx-stack fx-stack--sm gap-2 pt-1">
          <legend className="sr-only">Agreements</legend>
          <label htmlFor={termsId} className="es-check">
            <input
              id={termsId} type="checkbox" className="es-check__box" required
              checked={form.acceptTerms} onChange={tick('acceptTerms')}
            />
            <span className="text-sm text-ink">
              I agree to the{' '}
              <Link href="/terms" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                terms and conditions<span className="sr-only"> (opens in a new tab)</span>
              </Link>
              <span className="es-req" aria-hidden="true">*</span>
            </span>
          </label>
          <label htmlFor={privacyId} className="es-check">
            <input
              id={privacyId} type="checkbox" className="es-check__box" required
              checked={form.acceptPrivacy} onChange={tick('acceptPrivacy')}
            />
            <span className="text-sm text-ink">
              I agree to the{' '}
              <Link href="/privacy" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                privacy policy<span className="sr-only"> (opens in a new tab)</span>
              </Link>
              <span className="es-req" aria-hidden="true">*</span>
            </span>
          </label>
        </fieldset>

        <FormError error={error} />

        <SubmitButton busy={busy} busyLabel="Creating your account…" disabled={!ready} className="es-btn--lg es-btn--block">
          Create organizer account
        </SubmitButton>
        {!ready && !tooShort && (
          <p className="text-center text-xs text-subtle">Tick both agreements to continue.</p>
        )}
      </form>

      <p className="text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login?next=%2Forganizer" className="text-accent">Sign in</Link>
      </p>
      <p className="text-center text-xs text-subtle">
        Just buying tickets? <Link href="/register" className="text-accent">Create a regular account</Link>.
      </p>
    </div>
  );
}
