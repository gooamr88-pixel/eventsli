'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { get, PUBLIC_API_URL } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { formatMoney } from '../../utils/money';
import { useReservation } from '../../hooks/useReservation';
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
          className="self-start rounded-[--es-radius-md] bg-accent px-4 py-2 text-sm font-medium text-on-accent"
        >
          Try again
        </Link>
      </div>
    );
  }

  const { order, tickets = [], ticketsWithheld, message } = result;

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <p className="font-mono text-xs uppercase tracking-[0.1em] text-accent">Confirmed</p>
        <h1 className="text-2xl">You&apos;re going.</h1>
        <p className="text-muted">
          {formatMoney(order.totalCents, order.currency)} paid.
          {order.email && <> Tickets sent to {order.email}.</>}
        </p>
      </div>

      {ticketsWithheld ? (
        <div className="rounded-[--es-radius-lg] border border-border-base bg-surface p-5">
          <p className="text-sm text-muted">{message}</p>
          <Link href="/account/tickets" className="mt-2 inline-block text-sm text-accent">
            Open my tickets
          </Link>
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

      <p className="text-sm text-subtle">
        Keep the email — it is the link that works everywhere, on any device.
      </p>
    </div>
  );
}
