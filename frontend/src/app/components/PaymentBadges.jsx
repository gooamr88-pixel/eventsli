/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW A BUYER CAN PAY, AS BADGES (owner, 2026-11-10): "Stripe" and "Manual",
 * each a crisp inline SVG, shown under the seat page's checkout button.
 *
 * They follow the EVENT, never a guess: `payments` is the public event's
 * `{ card, manual }` (discoveryController) — card when the event takes Stripe,
 * manual when the organizer takes e-Transfer, bank transfer or cash. An event
 * with neither shows nothing rather than a badge it would then refuse.
 *
 * The Stripe badge is Stripe's purple (#635BFF) with the lowercase wordmark
 * set in white, the way Stripe's own "Powered by Stripe" badges read; card
 * payments on Eventsli are processed by Stripe. Inline SVG, so it is sharp at
 * every density and costs no request.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PaymentBadges({ payments, className = '' }) {
  const card = payments ? payments.card !== false : true;
  const manual = Boolean(payments?.manual);
  if (!card && !manual) return null;
  return (
    <ul className={`es-paybadges ${className}`} aria-label="Ways to pay">
      {card && <li><StripeBadge /></li>}
      {manual && <li><ManualBadge /></li>}
    </ul>
  );
}

export function StripeBadge() {
  return (
    <svg className="es-paybadge" viewBox="0 0 120 40" width="120" height="40" role="img" aria-labelledby="pay-stripe-t">
      <title id="pay-stripe-t">Card payment by Stripe</title>
      <rect x="0.5" y="0.5" width="119" height="39" rx="9" fill="#635BFF" />
      {/* A card, then the wordmark. */}
      <g fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinejoin="round" opacity="0.9">
        <rect x="13" y="13" width="20" height="14" rx="2.5" />
        <path d="M13 18h20" />
      </g>
      <text
        x="40" y="26.5"
        fill="#ffffff"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
        fontSize="19" fontWeight="700" letterSpacing="-0.6"
      >
        stripe
      </text>
    </svg>
  );
}

export function ManualBadge() {
  return (
    <svg className="es-paybadge" viewBox="0 0 132 40" width="132" height="40" role="img" aria-labelledby="pay-manual-t">
      <title id="pay-manual-t">Manual payment: e-Transfer, bank transfer or cash</title>
      <rect x="0.75" y="0.75" width="130.5" height="38.5" rx="9" fill="#ffffff" stroke="#0d5b5e" strokeWidth="1.5" />
      {/* A banknote: the organizer's own methods. */}
      <g fill="none" stroke="#0d5b5e" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
        <rect x="12" y="13" width="24" height="14" rx="2.5" />
        <circle cx="24" cy="20" r="3.2" />
        <path d="M16 17v0M32 23v0" />
      </g>
      <text
        x="43" y="25.5"
        fill="#0d5b5e"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
        fontSize="14.5" fontWeight="700" letterSpacing="-0.2"
      >
        Manual
      </text>
    </svg>
  );
}
