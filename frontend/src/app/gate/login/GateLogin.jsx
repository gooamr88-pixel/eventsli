'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeError } from '../../utils/errors';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import { Segmented } from '../../components/ui/Filters';
import { signIn, useGateSession } from '../gateSession';
import StaffSignIn from './StaffSignIn';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Signing the gate in, at the start of a shift. Two ways, side by side:
 *
 *   Device PIN  — a shared tablet the organizer registered. Two fields and no
 *                 email, because there is no person here. The PIN is shown to
 *                 the organizer exactly once and only a hash is kept.
 *   My account  — a named door-team member, with their own Eventsli login,
 *                 scanning the one event they were added to.
 *
 * Both end in the same scoped gate token, so the scanner behind this page does
 * not know or care which was used.
 *
 * The PIN refusal is deliberately vague — "that device id or PIN is not right"
 * — and this page repeats it rather than trying to be more helpful. A wrong PIN
 * and a REVOKED DEVICE are answered identically by the API, on purpose, so that
 * whoever picked up a lost tablet cannot learn which of the two stopped them.
 *
 * The PIN login is rate limited at 12 per fifteen minutes, keyed on the device id
 * as well as the address, because a four-digit PIN is brute-forceable in minutes
 * and the attempt touches no user account.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MODES = [
  { value: 'device', label: 'Device PIN' },
  { value: 'account', label: 'My account' },
];

export default function GateLogin() {
  const router = useRouter();
  const session = useGateSession();
  const [mode, setMode] = useState('device');
  const [deviceId, setDeviceId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A tablet that is already signed in has no business on this screen — it is
  // reached by a bookmark to /gate/login as often as by anything else.
  useEffect(() => {
    if (session) router.replace('/gate');
  }, [session, router]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn({ deviceId, pin });
      router.replace('/gate');
    } catch (err) {
      setError(err);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="fx-container fx-container--xs fx-gutter fx-section">
      <div className="fx-stack">
        <div className="fx-stack fx-stack--sm">
          <p className="text-sm uppercase tracking-[0.18em] text-accent">Eventsli Gate</p>
          <h1 className="text-2xl text-ink">Start scanning</h1>
          <p className="max-w-[54ch] text-muted">
            Sign in a shared device with its PIN, or sign in as yourself if the organizer added you to the
            door team. Either way this opens one event&apos;s door and no other.
          </p>
        </div>

        <Segmented label="How are you signing in?" value={mode} onChange={setMode} options={MODES} />

        {mode === 'account' ? (
          <StaffSignIn />
        ) : (
          <>
            <form onSubmit={submit} className="fx-stack">
              <Field
                label="Device id"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                hint="The long code shown next to the device name."
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                required
              />

              <Field
                label="PIN"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                // `inputMode` and not `type="number"`: a numeric keypad on a tablet,
                // without the spinner arrows and the silent stripping of a leading
                // zero that a number input does to a PIN.
                inputMode="numeric"
                autoComplete="off"
                minLength={4}
                maxLength={32}
                required
              />

              <FormError error={error} />

              <button
                type="submit"
                disabled={busy || !deviceId.trim() || pin.length < 4}
                aria-busy={busy || undefined}
                // Tall. This is tapped with a thumb, standing up, in the dark.
                className="es-btn es-btn--primary es-btn--block es-btn--lg"
              >
                {busy ? 'Signing in…' : 'Start scanning'}
              </button>
            </form>

            <div className="fx-stack fx-stack--sm rounded-(--es-radius-lg) border border-border-base bg-surface p-4">
              <p className="text-sm text-ink">A device stays signed in for seven days.</p>
              <p className="text-sm text-muted">
                Long enough for a festival weekend without a re-login between guests, short enough that a
                tablet left in a taxi stops working before the next event. If one goes missing, the organizer
                revokes it from the dashboard — nobody&apos;s account is touched and its scans are kept.
              </p>
            </div>

            {error && describeError(error).code === 'RATE_LIMITED' && (
              <p className="text-sm text-muted">
                Too many attempts from this device. Wait a few minutes — the limit exists because a short PIN
                can otherwise be guessed by a machine.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
