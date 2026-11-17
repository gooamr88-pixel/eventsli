import NavIcon from '../shell/NavIcon';
import { LOGO_PATHS } from './paymentLogos';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "PAYMENT PLATFORMS WE USE" — above the partners band (owner, 2026-11-17).
 *
 * WHAT IT SHOWS IS WHAT THE CHECKOUT DOES, and nothing else. Card payments run
 * on Stripe's hosted Checkout (backend stripeService), so the card details are
 * typed on Stripe's page, never ours. The cards and wallets are the ones Stripe
 * offers there; Apple Pay and Google Pay appear only on devices that support
 * them, and the line under the logos says so.
 *
 * PAYPAL IS DELIBERATELY ABSENT. It was asked for, but Eventsli takes no
 * PayPal payments, and a logo here is a promise a buyer then looks for at the
 * checkout. The owner chose Stripe and the card brands instead (2026-11-17).
 * If PayPal is ever connected, it belongs in BRANDS below.
 *
 * A server component: static marks, no state.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The ways to pay at Stripe's checkout, in the order a buyer looks for them.
 * Each mark is drawn in its brand colour (`.es-pay__logo--<key>`) on a tile
 * that stays white in both themes — a navy Visa or a black Apple Pay on a dark
 * surface would disappear, and card marks are made to sit on white.
 */
const BRANDS = [
  { key: 'visa', name: 'Visa' },
  { key: 'mastercard', name: 'Mastercard' },
  { key: 'americanexpress', name: 'American Express' },
  { key: 'applepay', name: 'Apple Pay' },
  { key: 'googlepay', name: 'Google Pay' },
];

export default function PaymentPlatforms() {
  return (
    <section className="es-pay fx-section" aria-labelledby="pay-title">
      <div className="fx-container fx-container--xl">
        <div className="es-pay__head">
          <p className="es-pay__eyebrow">Secure checkout</p>
          <h2 id="pay-title" className="es-pay__title">Payment platforms we use</h2>
          <p className="es-pay__lede">
            Card payments are processed by Stripe, on Stripe&rsquo;s own secure checkout — your card
            details never touch Eventsli.
          </p>
        </div>

        <div className="es-pay__panel">
          {/* The processor, on its own: it is the platform; the rest are the
              ways to pay through it. */}
          <div className="es-pay__stripe">
            <span className="es-pay__stripe-mark" aria-hidden="true">
              <Logo path={LOGO_PATHS.stripe} />
            </span>
            <span className="es-pay__stripe-text">
              <span className="es-pay__stripe-name">Stripe</span>
              <span className="es-pay__stripe-sub">
                <NavIcon name="lock" size={14} />
                PCI DSS Level 1 certified
              </span>
            </span>
          </div>

          <ul className="es-pay__brands" aria-label="Ways to pay by card">
            {BRANDS.map((b) => (
              <li key={b.key} className="es-pay__brand">
                <span className={`es-pay__logo es-pay__logo--${b.key}`} aria-hidden="true">
                  {b.key === 'mastercard' ? <MastercardMark /> : <Logo path={LOGO_PATHS[b.key]} />}
                </span>
                <span className="es-pay__name">{b.name}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="es-pay__note">
          Apple Pay and Google Pay appear at checkout on devices that support them. Where an
          organizer sells offline, you pay them directly — by e-Transfer, bank transfer or cash.
        </p>
      </div>
    </section>
  );
}

/** A single-colour mark; its colour is the CSS `color` of its tile. */
function Logo({ path }) {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" focusable="false" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** Mastercard's symbol: two overlapping circles in its own two colours. */
function MastercardMark() {
  return (
    <svg viewBox="0 0 38 24" width="100%" height="100%" focusable="false" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#EB001B" />
      <circle cx="26" cy="12" r="11" fill="#F79E1B" />
      <path d="M19 3.52a11 11 0 0 1 0 16.96 11 11 0 0 1 0-16.96z" fill="#FF5F00" />
    </svg>
  );
}
