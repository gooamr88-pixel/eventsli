'use client';

import Link from 'next/link';
import SegmentError from '../components/SegmentError';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE BOUNDARY THAT HAS TO TALK ABOUT MONEY.
 *
 * It covers `/checkout/[reservationId]` and `/checkout/success`, the two
 * screens either side of Stripe. Without it a throw on those pages unwound all
 * the way to `app/error.jsx`, which says "Something broke" and offers "Back to
 * events" — to somebody who has just entered their card details and watched the
 * confirmation page vanish. Every question they have at that moment goes
 * unanswered, and the offered action is to go and browse something else.
 *
 * WHAT IT ADDS IS NOT A PRETTIER FAILURE, IT IS THE TWO FACTS.
 *
 *   • A charge does not depend on this page. The order is written by Stripe's
 *     webhook server-side; `/checkout/success` only POLLS for the result. So a
 *     render that throws here cannot have lost a payment, and cannot have made
 *     one either — which is exactly what somebody staring at a broken screen
 *     with their card in their hand cannot know.
 *
 *   • The tickets are in the email regardless, and `/tickets/find` re-sends
 *     them to the address that bought them. That route needs no account, which
 *     matters because guest checkout is a first-class path here — pointing this
 *     screen at `/account/tickets` would end a broken checkout on a login wall
 *     for precisely the people who chose not to register.
 *
 * `home` is `/tickets/find` for the same reason: after a failure on this
 * segment, "where are my tickets" is the only question, and it is the one route
 * that answers it for every buyer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CheckoutError({ error, reset }) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      area="This step"
      note={(
        <>
          <p>Nothing here can charge you, and nothing here can lose a payment.</p>
          <p>
            If you had already paid, the order went through and your tickets are in
            your email — you can{' '}
            <Link href="/tickets/find" className="text-accent hover:text-accent-hover">
              have them sent again
            </Link>
            . If you had not, you have not been charged.
          </p>
        </>
      )}
      home={{ href: '/tickets/find', label: 'Find my tickets' }}
    />
  );
}
