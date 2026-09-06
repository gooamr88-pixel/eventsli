'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { get, post } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { useOrganizer } from '../../hooks/useOrganizer';
import FormError from '../../components/forms/FormError';
import CreateProfile from '../CreateProfile';

/**
 * Stripe Connect.
 *
 * The status is re-read from Stripe on every visit rather than answered from
 * our own flags, because onboarding finishes ASYNCHRONOUSLY: an organizer can
 * land back here before Stripe has verified them, and an account can be
 * restricted later without telling us. A cached "connected" is a promise we
 * cannot keep.
 *
 * `requirements` is the reason this page is worth building at all. "Not ready
 * yet" with no explanation leaves an organizer with nothing to do but wait and
 * guess; the list says what Stripe is actually holding out for.
 */
export default function Payouts() {
  const params = useSearchParams();
  const { loading, organizer, refresh } = useOrganizer();

  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Stripe sends the organizer back here after hosted onboarding. The status is
  // re-read either way; the flag only decides whether to say "welcome back".
  const returned = params.get('stripe') === 'return';

  useEffect(() => {
    if (!organizer) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/organizer/stripe/status', { cache: 'no-store', noRedirect: true });
        if (!cancelled) { setStatus(data); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [organizer, returned]);

  async function startOnboarding() {
    setBusy(true);
    setError(null);
    try {
      const { onboardingUrl } = await post('/organizer/stripe/onboard', undefined, {
        noRedirect: true,
      });
      // A full navigation: Stripe's onboarding is a different origin.
      window.location.assign(onboardingUrl);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-subtle">Loading…</p>;
  if (!organizer) return <CreateProfile onCreated={refresh} />;

  return (
    <div className="fx-container fx-container--md fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Getting paid</h2>
        <p className="max-w-[60ch] text-muted">
          Buyers pay by card, and the money reaches your Stripe account on Stripe&apos;s own
          schedule. We never hold it after your event.
        </p>
      </div>

      {status?.paymentsDisabled ? (
        // The platform's own Stripe is off. Not the organizer's problem and not
        // something they can act on, so it does not read as their to-do.
        <Panel tone="warning">
          <p className="text-ink">Card payments are not switched on yet</p>
          <p className="text-sm text-muted">
            This is a setting on our side. Your events can be built and reviewed in the
            meantime — they just cannot go on sale until it is done.
          </p>
        </Panel>
      ) : status?.canReceivePayouts ? (
        <Panel tone="success">
          <p className="text-ink">Your payout account is ready</p>
          <p className="text-sm text-muted">
            Published events can sell tickets. If Stripe ever needs more from you, it
            will show up here.
          </p>
        </Panel>
      ) : (
        <Panel tone="warning">
          <p className="text-ink">
            {status?.connected ? 'Stripe still needs a few things' : 'Connect a payout account'}
          </p>
          <p className="text-sm text-muted">
            {status?.connected
              ? 'Your account exists but is not cleared to receive money yet.'
              : 'You will be taken to Stripe to enter your details. It takes a few minutes.'}
          </p>

          {status?.disabledReason && (
            <p className="mt-2 text-sm text-muted">
              Stripe reports: <span className="text-ink">{humanise(status.disabledReason)}</span>
            </p>
          )}

          {status?.requirements?.length > 0 && (
            <div className="mt-3">
              <p className="text-sm text-ink">Outstanding:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted">
                {status.requirements.map((r) => <li key={r}>{humanise(r)}</li>)}
              </ul>
            </div>
          )}

          {status?.pendingVerification?.length > 0 && (
            <p className="mt-2 text-sm text-muted">
              Stripe is checking {status.pendingVerification.length}{' '}
              {status.pendingVerification.length === 1 ? 'item' : 'items'}. Nothing to do —
              this can take a day.
            </p>
          )}

          <FormError error={error} />

          <button
            type="button"
            onClick={startOnboarding}
            disabled={busy}
            className="mt-3 rounded-[--es-radius-md] bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? 'Opening Stripe…' : status?.connected ? 'Continue with Stripe' : 'Connect with Stripe'}
          </button>
        </Panel>
      )}

      {error && !status && (
        <p className="text-sm text-muted">{describeError(error).recovery}</p>
      )}

      <p className="text-xs text-subtle">
        Eventsli never sees your bank details. Stripe holds them and pays you directly.
      </p>
    </div>
  );
}

/**
 * Stripe's requirement keys are machine-readable and land in front of a person:
 * `individual.verification.document`, `external_account`. Splitting on the
 * separators and sentence-casing is not a translation, but it is the difference
 * between a sentence and a symbol — and inventing a mapping table would go
 * stale silently as Stripe adds keys.
 */
function humanise(key) {
  return String(key)
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bId\b/g, 'ID');
}

function Panel({ tone, children }) {
  const look = {
    success: 'border-success/40 bg-success/5',
    warning: 'border-warning/40 bg-warning/10',
  }[tone] || 'border-border-base bg-surface';

  return <div className={`rounded-[--es-radius-lg] border p-5 ${look}`}>{children}</div>;
}
