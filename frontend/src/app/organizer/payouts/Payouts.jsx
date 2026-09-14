'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { get, post } from '../../utils/apiClient';
import { useOrganizer } from '../../hooks/useOrganizer';
import FormError from '../../components/forms/FormError';
import CreateProfile from '../CreateProfile';
import { PageHeader, Panel } from '../../components/ui/Page';
import NavIcon from '../../components/shell/NavIcon';
import { Loading, ErrorNotice, Notice } from '../../components/Feedback';

/**
 * Getting paid — Stripe Connect.
 *
 * The status is re-read from Stripe on every visit rather than answered from our
 * own flags: onboarding finishes ASYNCHRONOUSLY, and an account can be
 * restricted later without telling us. A cached "connected" is a promise we
 * cannot keep.
 *
 * BRD §08 — no holding. Card money goes to the organizer's Stripe account on
 * Stripe's schedule; Eventsli's commission is taken at the charge.
 */
export default function Payouts() {
  const params = useSearchParams();
  const { loading, organizer, refresh } = useOrganizer();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Stripe sends the organizer back here after hosted onboarding.
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
      const { onboardingUrl } = await post('/organizer/stripe/onboard', undefined, { noRedirect: true });
      // A full navigation: Stripe's onboarding is a different origin.
      window.location.assign(onboardingUrl);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (loading) return <Loading variant="card" />;
  if (!organizer) return <CreateProfile onCreated={refresh} />;

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Your account"
        title="Payouts"
        lede="Buyers pay by card, and the money reaches your Stripe account on Stripe's schedule. Eventsli never holds it."
      />

      {!status && !error && <Loading variant="card" label="Checking with Stripe" />}
      {error && !status && <ErrorNotice error={error} />}

      {status?.paymentsDisabled && (
        <Notice tone="warning" title="Card payments are not switched on yet.">
          <p>This is a setting on Eventsli&rsquo;s side. Your events can be built and reviewed in the meantime — they cannot go on sale until it is done.</p>
        </Notice>
      )}

      {status && !status.paymentsDisabled && (
        <div className="grid gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Panel title={status.canReceivePayouts ? 'Your payout account is ready' : status.connected ? 'Stripe still needs a few things' : 'Connect a payout account'}>
            {status.canReceivePayouts ? (
              <p className="text-muted">Published events can sell tickets. If Stripe ever needs more from you, it shows up here.</p>
            ) : (
              <>
                <p className="text-muted">
                  {status.connected
                    ? 'Your account exists but is not cleared to receive money yet.'
                    : 'You will be taken to Stripe to enter your details. It takes a few minutes.'}
                </p>

                {status.disabledReason && (
                  <p className="text-sm text-muted">Stripe reports: <span className="text-ink">{humanise(status.disabledReason)}</span></p>
                )}

                {status.requirements?.length > 0 && (
                  <div className="fx-stack fx-stack--sm gap-1">
                    <p className="text-sm text-ink">Still needed:</p>
                    <ul className="list-disc pl-5 text-sm text-muted">
                      {status.requirements.map((r) => <li key={r}>{humanise(r)}</li>)}
                    </ul>
                  </div>
                )}

                {status.pendingVerification?.length > 0 && (
                  <p className="text-sm text-muted">
                    Stripe is checking {status.pendingVerification.length} {status.pendingVerification.length === 1 ? 'item' : 'items'}. Nothing to do — this can take a day.
                  </p>
                )}

                <FormError error={error} />

                <div>
                  <button type="button" onClick={startOnboarding} disabled={busy} className="es-btn es-btn--primary">
                    {busy ? 'Opening Stripe…' : status.connected ? 'Continue with Stripe' : 'Connect with Stripe'}
                  </button>
                </div>
              </>
            )}
          </Panel>

          <Panel title="How money moves">
            <ol className="fx-stack fx-stack--sm text-sm text-muted">
              <Step icon="ticket" text="A buyer pays by card at checkout." />
              <Step icon="percent" text="Eventsli's commission is taken at that moment, as a separate line." />
              <Step icon="bank" text="The rest goes to your Stripe account and pays out on Stripe's schedule." />
              <Step icon="cash" text="Door sales are yours already — their commission is invoiced to you." />
            </ol>
            <p className="text-xs text-subtle">Eventsli never sees your bank details. Stripe holds them and pays you directly.</p>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Step({ icon, text }) {
  return (
    <li className="fx-row items-start">
      <span className="es-stat__icon"><NavIcon name={icon} size={16} /></span>
      <span className="fx-min0 flex-1 pt-1">{text}</span>
    </li>
  );
}

/** Stripe's requirement keys land in front of a person; split and sentence-case them. */
function humanise(key) {
  return String(key)
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bId\b/g, 'ID');
}
