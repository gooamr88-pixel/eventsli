/**
 * Whether an organizer can be PAID — not merely whether they connected Stripe.
 *
 * A connected account that cannot receive payouts is not ready to sell, so both
 * flags must be true. This was computed inline in seven places; one of them
 * getting it wrong is how the console and the checkout disagree about who can
 * take money.
 *
 * Pure, so it is testable without a database.
 */
function canReceivePayouts(organizer) {
  return Boolean(organizer?.stripe_onboarding_complete && organizer?.stripe_payouts_enabled);
}

module.exports = { canReceivePayouts };
