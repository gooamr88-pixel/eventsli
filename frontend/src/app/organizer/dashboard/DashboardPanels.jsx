import Link from 'next/link';
import NavIcon from '../../components/shell/NavIcon';

/**
 * The dashboard's panels. Each is empty-safe and says what an empty list MEANS
 * rather than showing a blank card.
 */

/**
 * The first screen for an organizer with no events, once the organization is
 * set up: where they are on the road to a first event, and ONE button for the
 * step they are on. Each step's button leads to the next — nobody has to work
 * out what to do now.
 *
 * Payments can be skipped: an organizer who only lists events never needs them,
 * and a ticketed draft can be built before they exist (it just cannot go on sale).
 */
export function GettingStarted({ organizer }) {
  const paymentsReady = (organizer.payments?.choices?.length ?? 0) > 0;
  const steps = [
    {
      key: 'organization', state: 'done', title: 'Your organization',
      detail: `Buyers see you as ${organizer.displayName}.`,
    },
    {
      key: 'payments',
      state: paymentsReady ? 'done' : 'current',
      title: 'Payment methods',
      detail: paymentsReady
        ? describeChoices(organizer)
        : 'Connect Stripe for cards, add e-Transfer or cash, or both. Not needed for display-only events.',
    },
    {
      key: 'event',
      state: paymentsReady ? 'current' : 'upcoming',
      title: 'Create your first event',
      detail: 'Choose a ticketed event or a display-only listing. It stays a private draft until you submit it.',
    },
  ];

  return (
    <section className="es-onboard es-band--field" aria-labelledby="onboard-title">
      <div className="fx-stack fx-stack--sm gap-4">
        <p className="es-eyebrow">Welcome, {organizer.displayName}</p>
        <h2 id="onboard-title" className="max-w-[20ch] text-ink">
          {paymentsReady ? 'Now create your first event.' : 'Next: how buyers pay you.'}
        </h2>
        <p className="max-w-[46ch] text-muted">
          {paymentsReady
            ? 'Everything saves as you go, and nothing is public until Eventsli approves it.'
            : 'Set up at least one payment method so your ticketed events can go on sale.'}
        </p>
        <div className="fx-row gap-2">
          {paymentsReady ? (
            <Link href="/organizer/events/new" className="es-btn es-btn--primary es-btn--lg">
              <NavIcon name="plus" size={18} />
              Create your first event
            </Link>
          ) : (
            <>
              <Link href="/organizer/payments?onboarding=1" className="es-btn es-btn--primary es-btn--lg">
                <NavIcon name="card" size={18} />
                Set up payment methods
              </Link>
              <Link href="/organizer/events/new" className="es-btn es-btn--ghost">
                Skip for now
              </Link>
            </>
          )}
        </div>
      </div>

      <ol className="es-steps rounded-(--es-radius-lg) bg-bg-sunken p-5" aria-label="Getting set up">
        {steps.map((step, i) => (
          <li key={step.key} className="es-steps__item" data-state={step.state}>
            <span className="es-steps__marker" aria-hidden="true">
              {step.state === 'done' ? <NavIcon name="tick" size={16} /> : i + 1}
            </span>
            <div className="es-steps__body">
              <p className="es-steps__title">
                {step.title}
                {step.state === 'done' && <span className="sr-only"> — done</span>}
                {step.state === 'current' && <span className="sr-only"> — you are here</span>}
              </p>
              <p className="text-sm text-muted">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function describeChoices(organizer) {
  const { stripeReady, manualMethods } = organizer.payments || {};
  if (stripeReady && manualMethods > 0) return 'Stripe and manual payments are ready.';
  if (stripeReady) return 'Stripe is connected for card payments.';
  return `${manualMethods} manual payment ${manualMethods === 1 ? 'method is' : 'methods are'} ready.`;
}
