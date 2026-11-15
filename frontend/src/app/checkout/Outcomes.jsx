import Link from 'next/link';
import { describeError, isOrganizerPayoutProblem } from '../utils/errors';
import NavIcon from '../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW A CHECKOUT ENDS — the four screens, in one file.
 *
 * WHY THEY LEFT `CheckoutClient`. Two reasons, and the second is the real one.
 *
 * The first is size: that file crossed the project's 500-line cap once the
 * order gained an event header and the free ending gained a mark. These four
 * are the obvious seam — everything above them is state, effects and a form;
 * everything here renders a result and holds nothing.
 *
 * The second is that the ENDINGS HAD ALREADY DIVERGED. A buyer who pays ends on
 * `checkout/success`; a buyer who claims a free ticket ends on
 * `checkout/[reservationId]`, because a claim has no Stripe webhook to wait for
 * and sending them to a page whose only job is waiting would invent a wait that
 * is over. Two files, two endings, and the free one had drifted into a small
 * grey box with a link in it while the paid one got a heading and a mark. They
 * are the same moment for the person — they have tickets — so the mark lives
 * here once and both import it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// The free ending moved to OrderConfirmation (2026-11-15): the same page as
// the paid one, with the tickets to save and print.

/**
 * Three of the payment failures are the ORGANIZER's Stripe setup, not anything
 * the buyer can fix. Told "payment failed" they try another card, then a third;
 * told the truth they can come back later.
 */
export function PayError({ error }) {
  const { title, recovery } = describeError(error);
  const theirs = isOrganizerPayoutProblem(error?.code);
  return (
    <div role="alert" className={`rounded-(--es-radius-md) p-3 ${theirs ? 'bg-warning/10' : 'bg-danger/10'}`}>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="text-sm text-muted">{recovery}</p>
      {theirs && <p className="mt-1 text-xs text-subtle">Nothing has been charged.</p>}
    </div>
  );
}

/**
 * A checkout this tab cannot act on: it was opened in another tab or browser,
 * or this tab has since made a newer hold (which released this one). Paying,
 * claiming and releasing all need the token the original tab received.
 */
export function NotThisTab({ slug }) {
  return (
    <div className="es-empty">
      <span className="es-empty__mark" aria-hidden="true"><NavIcon name="alert" size={26} /></span>
      <h1 className="es-empty__title">This checkout is not open in this tab</h1>
      <p className="es-empty__hint">
        It was started in another tab or browser, or you have chosen again since. Finish it
        where you started it, or choose your tickets again here. Nothing has been charged.
      </p>
      <Link href={slug ? `/e/${slug}` : '/events'} className="es-btn es-btn--primary">
        {slug ? 'Back to the event' : 'Browse events'}
      </Link>
    </div>
  );
}

/**
 * The quote itself could not be loaded, so there is no order to show.
 *
 * This is the screen an EXPIRED HOLD lands on, which makes it the most-seen
 * failure in the checkout — and the way back has to work for both kinds of
 * event. It said "Choose seats again" and linked to `/e/:slug/seats` on every
 * event, including general-admission ones that have no seats and no seat map;
 * `/seats` now redirects those to the ticket picker, so the destination is
 * right either way, and the label no longer promises seats to somebody who was
 * never choosing any.
 */
export function Fatal({ error, slug }) {
  const { title, recovery } = describeError(error);
  return (
    // The empty-state card (icon tile, heading, sentence, the one button), as
    // on every other "this did not work out" screen since the 2026-11 pass.
    <div className="es-empty">
      <span className="es-empty__mark" aria-hidden="true"><NavIcon name="clock" size={26} /></span>
      <h1 className="es-empty__title">{title}</h1>
      <p className="es-empty__hint">{recovery}</p>
      <Link
        href={slug ? `/e/${slug}/seats` : '/events'}
        className="es-btn es-btn--primary"
      >
        {slug ? 'Start again' : 'Browse events'}
      </Link>
    </div>
  );
}
