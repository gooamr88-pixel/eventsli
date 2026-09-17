import { Notice } from '../components/Feedback';

/**
 * The two things about an organizer's own account that stop them selling, said
 * where they can act on them rather than discovered from a buyer's complaint.
 *
 * `payouts={false}` where the page already says it another way. The dashboard
 * showed "No payout account yet" as a banner AND as the first line of Needs
 * you, one above the other — the same sentence twice reads as two problems.
 */
export default function OrganizerNotices({ organizer, payouts = true }) {
  return (
    <>
      {/* BRD §19 — a banned organizer is NOT a blocked account. They still sign
          in and still see what they owe, because an organizer who cannot see
          the invoice cannot pay it. What stops is putting anything new on sale. */}
      {organizer.isBanned && (
        <Notice tone="danger" title="Your organizer account is suspended.">
          <p>
            You can still see your events and settle anything owed, but nothing new
            can go on sale. Contact support if you think that is a mistake.
          </p>
        </Notice>
      )}

      {/* An organizer from before the setup step: nothing stops their live
          events, but the next new one needs these details first. */}
      {!organizer.setupComplete && (
        <Notice
          tone="warning"
          title="Finish your organization details."
          action={{ href: '/organizer/profile', label: 'Add them now' }}
        >
          <p>Your organization name, brand and description are needed before you create another event.</p>
        </Notice>
      )}

      {/* With no way to take money a ticketed event cannot go on sale. Said
          once, where it can be fixed; the buyer is never told why. */}
      {payouts && (organizer.payments?.choices?.length ?? 0) === 0 && (
        <Notice
          tone="warning"
          title={organizer.stripeConnected ? 'Stripe still needs some details.' : 'No payment method yet.'}
          action={{ href: '/organizer/payments', label: 'Set up payment methods' }}
        >
          <p>Ticketed events cannot go on sale until you connect Stripe or add a manual payment method.</p>
        </Notice>
      )}
    </>
  );
}
