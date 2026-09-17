import { redirect } from 'next/navigation';

/**
 * Payouts became Payment methods — Stripe and manual methods on one page.
 *
 * Kept as a redirect, not deleted: organizers have it bookmarked, and Stripe
 * onboarding links issued before the move return here with `?stripe=return` or
 * `?stripe=refresh`, which the new page still reads.
 */
export default async function PayoutsPage({ searchParams }) {
  const params = new URLSearchParams();
  const stripe = (await searchParams)?.stripe;
  if (typeof stripe === 'string') params.set('stripe', stripe);
  redirect(`/organizer/payments${params.size ? `?${params}` : ''}`);
}
