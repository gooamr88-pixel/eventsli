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

      {/* Without a connected account every checkout is refused, and the buyer is
          deliberately not told why — it is not theirs to fix. */}
      {payouts && !organizer.canReceivePayouts && (
        <Notice
          tone="warning"
          title={organizer.stripeConnected ? 'Stripe still needs some details.' : 'No payout account yet.'}
          action={{ href: '/organizer/payouts', label: 'Set up payouts' }}
        >
          <p>Until this is done, tickets cannot be sold online.</p>
        </Notice>
      )}
    </>
  );
}
