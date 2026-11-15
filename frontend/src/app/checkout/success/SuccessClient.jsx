'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { get } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { useReservation } from '../../hooks/useReservation';
import { useAuth } from '../../hooks/useAuth';
import OrderConfirmation from '../OrderConfirmation';
import NavIcon from '../../components/shell/NavIcon';

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
    /* The three states before "paid" share the empty-state card (icon tile,
       bold heading, the sentence under it) — they were bare text, the one
       part of the funnel that looked unfinished. Each keeps its <h1>. */
    return (
      <div className="es-empty">
        <span className="es-empty__mark" aria-hidden="true"><NavIcon name="alert" size={26} /></span>
        <h1 className="es-empty__title">{title}</h1>
        <p className="es-empty__hint">{recovery}</p>
        <p className="es-empty__hint">
          If you were charged, your tickets are in your email. You can also{' '}
          <Link href="/tickets/find" className="text-accent">have them sent again</Link>.
        </p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="es-empty" aria-busy="true">
        <span className="es-empty__mark" aria-hidden="true"><NavIcon name="clock" size={26} /></span>
        <h1 className="es-empty__title">Confirming your payment…</h1>
        <p className="es-empty__hint">This takes a moment. Do not close this page.</p>
      </div>
    );
  }

  if (result.status !== 'paid' && result.sessionStatus === 'complete') {
    // Stripe accepted the payment but has not settled it yet. Telling this
    // buyer "Nothing was charged" with a "Try again" button is how they end
    // up paying twice.
    return (
      <div className="es-empty" role="status">
        <span className="es-empty__mark" aria-hidden="true"><NavIcon name="clock" size={26} /></span>
        <h1 className="es-empty__title">Your payment is processing</h1>
        <p className="es-empty__hint">
          Stripe has your payment and is still confirming it. We will email your tickets as
          soon as it completes, so please do not pay again.
        </p>
        <Link href="/tickets/find" className="es-btn es-btn--primary">
          Find my tickets
        </Link>
      </div>
    );
  }

  if (result.status !== 'paid') {
    return (
      <div className="es-empty">
        <span className="es-empty__mark" aria-hidden="true"><NavIcon name="card" size={26} /></span>
        <h1 className="es-empty__title">Payment not completed</h1>
        <p className="es-empty__hint">Nothing was charged.</p>
        <Link
          href={reservation?.slug ? `/e/${reservation.slug}/seats` : '/events'}
          className="es-btn es-btn--primary"
        >
          Try again
        </Link>
      </div>
    );
  }

  const { order, event, tickets = [], ticketsWithheld, message } = result;

  // The confirmation, with the tickets ready to save and print (owner's
  // reference, 2026-11-15) — the same page the free ending shows.
  return (
    <OrderConfirmation
      totalCents={order.totalCents}
      currency={order.currency}
      email={order.email}
      event={event}
      tickets={tickets}
      ticketsWithheld={ticketsWithheld}
      message={message}
      signedIn={signedIn}
    />
  );
}
