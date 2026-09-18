'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { get, PUBLIC_API_URL } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { formatMoney } from '../../utils/money';
import { useReservation } from '../../hooks/useReservation';
import { useAuth } from '../../hooks/useAuth';
import { SuccessMark } from '../Outcomes';
import TicketStub from '../../components/TicketStub';

/**
 * The page Stripe returns to.
 *
 * It POLLS, because arriving here does not mean the order exists yet. Stripe
 * redirects the browser the instant the payment succeeds, and the webhook that
 * writes the order is a separate delivery racing the redirect — usually behind
 * it. The endpoint fulfils from the session itself when it has to, so this
 * resolves either way, but the first call can legitimately come back `unpaid`
 * for a second or two.
 *
 * Showing "something went wrong" during that window would be wrong on the one
 * screen where a buyer has just been charged.
 */
export default function SuccessClient() {
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const { reservation, forget } = useReservation();
  const { signedIn } = useAuth();

  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  // A missing session id is derived during render, not written into state by an
  // effect. It cannot change while this page is mounted, so storing it would be
  // a second copy of a fact the URL already holds.
  const missingSession = !sessionId;

  useEffect(() => {
    if (!sessionId) return undefined;

    let cancelled = false;
    let timer;

    (async () => {
      try {
        const data = await get(`/public/checkout/${encodeURIComponent(sessionId)}`, {
          cache: 'no-store', noRedirect: true,
        });
        if (cancelled) return;

        if (data.status === 'paid') {
          setResult(data);
          // The hold became an order. Keeping it would leave a stale
          // reservation in this tab that another page could offer to release.
          forget();
          return;
        }

        // Not paid YET. Back off rather than hammering — but stop after about
        // 20 seconds, because past that it is not a race, it is a failure, and
        // a spinner forever tells the buyer nothing.
        if (attempt < 6) {
          timer = setTimeout(() => setAttempt((n) => n + 1), 1000 + attempt * 1000);
        } else {
          setResult(data);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();

    return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId, attempt, forget]);

  if (error || missingSession) {
    const { title, recovery } = describeError(error || { code: 'NOT_FOUND' });
    return (
      <div className="fx-stack">
        <h1 className="text-xl">{title}</h1>
        <p className="text-muted">{recovery}</p>
        <p className="text-sm text-subtle">
          If you were charged, your tickets are in your email. You can also{' '}
          <Link href="/tickets/find" className="text-accent">have them sent again</Link>.
        </p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="fx-stack">
        <h1 className="text-xl">Confirming your payment…</h1>
        <p className="text-muted">This takes a moment. Do not close this page.</p>
      </div>
    );
  }

  if (result.status !== 'paid') {
    return (
      <div className="fx-stack">
        <h1 className="text-xl">Payment not completed</h1>
        <p className="text-muted">Nothing was charged.</p>
        <Link
          href={reservation?.slug ? `/e/${reservation.slug}/seats` : '/events'}
          className="es-btn es-btn--primary self-start"
        >
          Try again
        </Link>
      </div>
    );
  }

  const { order, tickets = [], ticketsWithheld, message } = result;

  return (
    <div className="fx-stack">
      {/**
        * THE MARK, THE CLAIM, AND THE TWO WAYS ON.
        *
        * This screen used to open with a small mono eyebrow and go straight
        * into ticket stubs, with no next step anywhere on the paid path — the
        * one place in the product where a person has just handed over money and
        * most wants to be told, unambiguously, that it worked. "Open my
        * tickets" existed only in the withheld branch, so the ordinary
        * successful buyer finished the entire funnel on a page with no button.
        *
        * The mark is `aria-hidden` and the heading carries the meaning: a
        * screen reader gets "Payment confirmed", not "check mark image".
        */}
      <div className="fx-stack items-center gap-3 text-center">
        <SuccessMark />
        <h1 className="text-2xl">Payment confirmed</h1>
        <p className="text-md text-muted">
          You&apos;re going. {formatMoney(order.totalCents, order.currency)} paid.
        </p>
        {order.email && (
          <p className="text-sm text-subtle">
            {/* The address is the thing to check for a typo, so it is the one
                part of this sentence set in ink rather than subtle. */}
            A confirmation has been sent to <span className="fx-break text-ink">{order.email}</span>
          </p>
        )}
      </div>

      {/**
        * WHERE "MY TICKETS" GOES DEPENDS ON WHETHER THERE IS AN ACCOUNT.
        *
        * `/account/tickets` is a private prefix — `proxy.ts` bounces anyone
        * without a session. Guest checkout is a first-class path here (the API
        * takes an email and never requires registration), so pointing every
        * buyer at it would end the happy path on a login wall for exactly the
        * people who chose not to register. `/tickets/find` is the guest's
        * equivalent: it emails the tickets to the address that bought them.
        *
        * While `loading` is true neither answer is known, so the button says
        * the neutral thing and goes to the guest route, which works for both.
        */}
      <div className="fx-stack fx-stack--sm">
        <Link
          href={signedIn ? '/account/tickets' : '/tickets/find'}
          className="es-btn es-btn--primary es-btn--lg es-btn--block"
        >
          {signedIn ? 'View my tickets' : 'Find my tickets'}
        </Link>
        <Link href="/events" className="es-btn es-btn--secondary es-btn--block">
          Browse more events
        </Link>
      </div>

      {ticketsWithheld ? (
        <div className="es-card p-5">
          <p className="text-sm text-muted">{message}</p>
        </div>
      ) : (
        <div className="fx-stack fx-stack--sm">
          {tickets.map((ticket) => (
            <TicketStub
              key={ticket.id}
              ticket={ticket}
              qrSrc={`${PUBLIC_API_URL}/public/qr/${encodeURIComponent(ticket.qr)}`}
            />
          ))}
        </div>
      )}

      <p className="text-center text-sm text-subtle">
        Keep the email — it is the link that works everywhere, on any device.
      </p>
    </div>
  );
}
