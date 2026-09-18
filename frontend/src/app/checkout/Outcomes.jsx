import Link from 'next/link';
import { describeError, isOrganizerPayoutProblem } from '../utils/errors';

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

/**
 * The confirmation mark, shared by both endings.
 *
 * Drawn rather than imported: it is two shapes, and a library or a sprite for
 * them would be bytes on the one screen that has to render instantly on a
 * venue's wifi. `aria-hidden`, because the heading beside it carries the news —
 * a screen reader should hear "Payment confirmed", not "check mark image".
 */
export function SuccessMark() {
  return (
    <span aria-hidden="true" className="grid size-20 place-items-center rounded-full bg-accent-wash">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" focusable="false">
        <circle cx="12" cy="12" r="10" fill="var(--es-accent)" />
        <path
          d="M7.5 12.4l3 3 6-6.2"
          stroke="var(--es-text-on-accent)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * A FREE CLAIM, DONE — deliberately the same shape as the paid ending.
 *
 * Same mark, same heading weight, same two actions in the same order. Two
 * endings that look unrelated make the free one feel like a lesser outcome,
 * and it is not: the person has tickets either way.
 *
 * `/tickets/find` rather than `/account/tickets`, because a free claim is the
 * path most likely to have been taken without an account, and `/account` is a
 * private prefix that would bounce them to a login screen. The email is the
 * only copy of a claimed ticket — there is no card statement to check against —
 * so the way to get it re-sent is offered here rather than left to be found.
 */
export function Claimed({ claimed, slug }) {
  const count = claimed.ticketCount || 0;
  return (
    <div className="fx-stack" role="status">
      <div className="fx-stack items-center gap-3 text-center">
        <SuccessMark />
        <h1 className="text-2xl">You&apos;re in</h1>
        <p className="text-md text-muted">
          {count} {count === 1 ? 'ticket is' : 'tickets are'} yours.
        </p>
        {claimed.email && (
          <p className="text-sm text-subtle">
            We&apos;ve emailed {count === 1 ? 'it' : 'them'} to{' '}
            <span className="fx-break text-ink">{claimed.email}</span>
          </p>
        )}
      </div>

      <div className="fx-stack fx-stack--sm">
        <Link href="/tickets/find" className="es-btn es-btn--primary es-btn--lg es-btn--block">
          Find my tickets
        </Link>
        <Link href={slug ? `/e/${slug}` : '/events'} className="es-btn es-btn--secondary es-btn--block">
          {slug ? 'Back to the event' : 'Browse more events'}
        </Link>
      </div>

      <p className="text-center text-sm text-subtle">
        Bring the QR code with you — on your phone is fine.
      </p>
    </div>
  );
}

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

/** The quote itself could not be loaded, so there is no order to show. */
export function Fatal({ error, slug }) {
  const { title, recovery } = describeError(error);
  return (
    <div className="fx-stack">
      <h1 className="text-xl">{title}</h1>
      <p className="text-muted">{recovery}</p>
      <Link
        href={slug ? `/e/${slug}/seats` : '/events'}
        className="es-btn es-btn--primary self-start"
      >
        {slug ? 'Choose seats again' : 'Browse events'}
      </Link>
    </div>
  );
}
