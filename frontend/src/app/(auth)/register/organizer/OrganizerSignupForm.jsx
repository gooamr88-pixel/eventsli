'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { rememberWatchToken } from '../../verify-email/useVerificationWatch';
import { post } from '../../../utils/apiClient';
import Field from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import AccountTypeChoice from '../AccountTypeChoice';
import { MIN_PASSWORD, MAX_PASSWORD, PASSWORD_HINT, passwordProblem } from '../../../lib/passwordRules';


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
  const params = useSearchParams();
  // Present only when somebody was sent here mid-flow. It survives the
  // chooser and the whole verification detour.
  const asked = params.get('next');
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

      // Handed to the waiting screen so it can notice the activation happening
      // on a phone instead of sitting on "open your email" forever.
      rememberWatchToken(account?.watchToken);
      const query = new URLSearchParams({
        email: account?.email || form.email.trim(),
        sent: '1',
        /**
         * NO HARDCODED '/organizer' ANY MORE. This form used to pin the
         * destination itself, which was right by luck — it is the organizer
         * sign-up — and wrong in shape: it meant two places decided where
         * somebody lands, and a real `?next=` from a checkout bounce was
         * thrown away. The account's own type decides now, on the API side,
         * and only a destination that was actually asked for is carried.
         */
        ...(asked ? { next: asked } : {}),
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
        <h1 className="text-2xl">Create an account</h1>
      </div>

      {/* Shown here too, with this side marked. The organizer form asks for
          more — an organization, a phone number, two agreements — and somebody
          halfway down it should be able to see why, and change their mind
          without going to find the other page. */}
      <AccountTypeChoice current="organizer" next={asked} />

      <p className="text-sm text-muted">
        We will email you a link to activate the account. Setting up payouts comes later.
      </p>

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
          minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD}
          hint={PASSWORD_HINT}
          error={passwordProblem(form.password)}
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
