'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { get, post, del } from '../../utils/apiClient';
import { describeError, isOrganizerPayoutProblem } from '../../utils/errors';
import { formatMoney } from '../../utils/money';
import { useReservation } from '../../hooks/useReservation';
import { useCountdown } from '../../hooks/useCountdown';
import HoldBar from './HoldBar';
import { Loading } from '../../components/Feedback';

/**
 * The last screen before Stripe.
 *
 * Every number on it comes from `GET /public/reservations/:id/quote`. Nothing
 * is added up here — the four fee items (face, event tax, commission, payment
 * fee) are reconciled in the backend against what Stripe actually bills, and a
 * client that re-derives the total will eventually disagree with the charge.
 */
export default function CheckoutClient({ reservationId }) {
  const router = useRouter();
  const { reservation, release, forget } = useReservation();

  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);
  const [promoCode, setPromoCode] = useState('');
  const [promoError, setPromoError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [buyer, setBuyer] = useState({ name: '', email: '', acceptTerms: false });
  // Set once a free claim has issued the tickets. There is no payment step and
  // nothing to wait for, so this page shows the outcome itself.
  const [claimed, setClaimed] = useState(null);

  const loadQuote = useCallback(async () => {
    try {
      setQuote(await get(`/public/reservations/${reservationId}/quote`, {
        cache: 'no-store', noRedirect: true,
      }));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [reservationId]);

  // Inline, so every setState lands after an await. React 19 rejects a
  // synchronous setState in an effect body, and it is right to: that is a
  // render the component immediately discards.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get(`/public/reservations/${reservationId}/quote`, {
          cache: 'no-store', noRedirect: true,
        });
        if (!cancelled) { setQuote(data); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [reservationId]);

  const { formatted, expired, remaining } = useCountdown(quote?.expiresAt, {
    onExpire: () => {
      // Nothing is released here — the server let it go on its own schedule,
      // and asking would 410. Only the local record is dropped so no other page
      // offers a hold that no longer exists.
      forget();
      setError({ code: 'RESERVATION_EXPIRED' });
    },
  });

  async function applyPromo(e) {
    e.preventDefault();
    setBusy('promo');
    setPromoError(null);
    try {
      await post(`/public/reservations/${reservationId}/promo`, { code: promoCode.trim() }, {
        headers: token(reservation), noRedirect: true,
      });
      await loadQuote();
      setPromoCode('');
    } catch (err) {
      setPromoError(err);
    } finally {
      setBusy(null);
    }
  }

  async function removePromo() {
    setBusy('promo');
    try {
      await del(`/public/reservations/${reservationId}/promo`, {
        headers: token(reservation), noRedirect: true,
      });
      await loadQuote();
    } catch (err) {
      setPromoError(err);
    } finally {
      setBusy(null);
    }
  }

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * TWO ENDINGS, DECIDED BY THE TOTAL — and the total comes from the server.
   *
   * A total of zero goes to `/claim`, which issues the tickets directly: there
   * is no card to take, so sending somebody to a payment page to enter one for
   * nothing is a step that can only lose them.
   *
   * `quote.totalCents` is recomputed from the database on every quote, so this
   * follows the prices, the promo code and the taxes as they actually are. It
   * is NOT the authority — `/claim` re-quotes and refuses anything above zero —
   * which is what makes reading it here safe: the worst a stale total can do is
   * send the buyer to the endpoint that then tells them to pay.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async function pay(e) {
    e.preventDefault();
    setBusy('pay');
    setError(null);
    try {
      const body = {
        email: buyer.email || undefined,
        name: buyer.name || undefined,
        acceptTerms: buyer.acceptTerms,
      };

      if (free) {
        const result = await post(
          `/public/reservations/${reservationId}/claim`, body, { noRedirect: true },
        );
        /**
         * DONE, HERE, WITH NO REDIRECT — and that is the point of the free path.
         *
         * `/checkout/success` exists to POLL: a card payment redirects back
         * before Stripe's webhook has necessarily written the order, so that
         * page waits for it to appear. A claim has no webhook and no race — the
         * tickets exist by the time this line runs — so sending the buyer to a
         * page whose whole job is waiting would invent a wait that is over.
         *
         * The hold is forgotten for the same reason the success page forgets
         * it: it has become an order, and keeping it would leave a stale
         * reservation in this tab that a later release could act on.
         */
        forget();
        setClaimed({ ticketCount: result.ticketCount, email: result.email });
        return;
      }

      const { checkoutUrl } = await post(
        `/public/reservations/${reservationId}/checkout`, body, { noRedirect: true },
      );
      // A full navigation, not router.push: Stripe Checkout is a different
      // origin, and the client router cannot leave the app.
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  async function abandon() {
    setBusy('release');
    await release({ reservationId, reservationToken: reservation?.reservationToken });
    router.push(reservation?.slug ? `/e/${reservation.slug}` : '/events');
  }

  if (error && !quote) return <Fatal error={error} slug={reservation?.slug} />;
  if (claimed) return <Claimed claimed={claimed} slug={reservation?.slug} />;
  if (!quote) return <Loading variant="card" />;

  const discount = quote.lines.find((l) => l.amountCents < 0);
  // Nothing to pay. Everything the page says about payment changes with it.
  const free = Number(quote.totalCents) === 0;

  return (
    <div className="fx-stack">
      <h1 className="text-2xl">Your order</h1>

      {/* `remaining` is passed down rather than recomputed there: reading
          Date.now() during a render is impure, and the value already exists
          on the same one-second beat as the text beside it. */}
      <HoldBar formatted={formatted} expired={expired} remaining={remaining} />

      {/* The summary is the one object on this page the buyer is actually
          agreeing to, so it is a plate rather than a card — the same
          treatment the seat map and the ticket stub get. The three panels
          below it stay cards: they are controls, and if everything is
          presented then nothing is. */}
      <section className="es-plate bg-surface fx-stack fx-stack--sm p-6">
        <p className="text-muted">
          Admits {quote.admits} {quote.admits === 1 ? 'person' : 'people'}
        </p>

        <dl className="fx-stack fx-stack--sm">
          {quote.lines.map((line) => (
            <div key={line.label} className="fx-row fx-row--between">
              <dt className="fx-min0 text-muted">{line.label}</dt>
              <dd className="es-nums text-ink">{formatMoney(line.amountCents, quote.currency)}</dd>
            </div>
          ))}
          {/* The total was `text-lg` — 17.6px — one step above the line items
              it sums. It is the number the whole page exists to state, and it
              now gets the display treatment prices get everywhere else. */}
          <div className="fx-row fx-row--between items-baseline border-t border-border-base pt-4">
            <dt className="font-medium text-ink">Total</dt>
            <dd className="es-price">
              {formatMoney(quote.totalCents, quote.currency)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="fx-stack fx-stack--sm es-card p-5">
        {discount ? (
          <div className="fx-row fx-row--between">
            <p className="text-sm text-ink">{discount.label} applied</p>
            <button type="button" onClick={removePromo} disabled={busy === 'promo'} className="es-btn es-btn--ghost es-btn--sm">
              Remove
            </button>
          </div>
        ) : (
          <form onSubmit={applyPromo} className="fx-row">
            <input
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              placeholder="Discount code"
              aria-label="Discount code"
              className="es-input fx-min0 flex-1"
            />
            <button
              type="submit"
              disabled={busy === 'promo' || promoCode.trim().length < 2}
              className="es-btn es-btn--secondary"
            >
              Apply
            </button>
          </form>
        )}
        {promoError && (
          <p role="alert" className="text-sm text-danger">{describeError(promoError).recovery}</p>
        )}
      </section>

      <form onSubmit={pay} className="fx-stack fx-stack--sm es-card p-5">
        <h2 className="text-lg">Where should the tickets go?</h2>
        {/* Guest checkout is a first-class path — the API takes an optional
            email rather than requiring an account, and asking someone to
            register before they can pay is where conversion goes to die. */}
        <p className="text-sm text-subtle">
          You do not need an account. Signed in? We will use your account email.
        </p>
        <input
          type="text" name="name" value={buyer.name} autoComplete="name"
          onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))}
          placeholder="Full name" aria-label="Full name"
          className="es-input"
        />
        {/* Required, because the API refuses without one — "Enter an email
            address — your tickets are sent there." Catching it in the browser
            saves a round trip that ends in a red box under a button they
            already pressed. */}
        <input
          type="email" name="email" value={buyer.email} autoComplete="email" required
          onChange={(e) => setBuyer((b) => ({ ...b, email: e.target.value }))}
          placeholder="Email for your tickets" aria-label="Email"
          className="es-input"
        />

        {/* BRD §02 — the buyer accepts the terms before paying, and the API
            records the acceptance against the VERSION they were shown rather
            than as a boolean. It only records it when we send the flag, so a
            checkout that never asks is one where nobody ever agreed. */}
        {/* Was `text-xs` — 10.4px on a phone for the sentence that carries
            legal consent, beside a checkbox that records it. */}
        <label className="fx-row items-start gap-2.5 text-sm text-muted">
          <input
            type="checkbox" required checked={buyer.acceptTerms}
            onChange={(e) => setBuyer((b) => ({ ...b, acceptTerms: e.target.checked }))}
            className="mt-0.5"
          />
          <span>
            I agree to the <Link href="/terms" className="text-accent">terms</Link> and the{' '}
            <Link href="/privacy" className="text-accent">privacy policy</Link>. Tickets are
            non-refundable by default; any refund is between me and the organizer.
          </span>
        </label>

        {/* The organizer's own policies, the ones they marked to show here.
            Before the button, not under it: a refund policy read after paying
            is one that becomes an email to the organizer. */}
        {(quote.policies || []).length > 0 && (
          <div className="fx-stack fx-stack--sm">
            {quote.policies.map((policy) => (
              <details key={policy.id} className="rounded-(--es-radius-md) border border-border-base px-4 py-3">
                <summary className="cursor-pointer text-sm text-ink marker:text-subtle">{policy.title}</summary>
                <div className="fx-break mt-2 whitespace-pre-line text-sm text-muted">{policy.body}</div>
              </details>
            ))}
          </div>
        )}

        {error && <PayError error={error} />}

        <button
          type="submit"
          disabled={busy === 'pay' || expired}
          aria-busy={busy === 'pay' || undefined}
          className="es-btn es-btn--primary es-btn--lg es-btn--block"
        >
          {busy === 'pay'
            ? (free ? 'Getting your tickets…' : 'Taking you to payment…')
            : free ? 'Get my tickets' : `Pay ${formatMoney(quote.totalCents, quote.currency)}`}
        </button>

        <button
          type="button" onClick={abandon} disabled={busy === 'release'}
          className="es-btn es-btn--ghost es-btn--block"
        >
          Release my seats
        </button>
      </form>
    </div>
  );
}

/** The reservation token authorises release and promo changes. A bare id is
 *  not proof — it travels to the client, so anyone holding one could drop
 *  somebody else's seats while they were paying. */
function token(reservation) {
  return reservation?.reservationToken
    ? { 'x-access-token': reservation.reservationToken }
    : undefined;
}

/**
 * Three of the payment failures are the ORGANIZER's Stripe setup, not anything
 * the buyer can fix. Told "payment failed" they try another card, then a third;
 * told the truth they can come back later.
 */
function PayError({ error }) {
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
 * A free claim, done.
 *
 * Says where the tickets went and how to get them back, because the email is
 * the only copy — there is no receipt to re-open and no card statement to check
 * against. `/tickets/find` is the existing path for anyone whose email did not
 * arrive, so it is offered here rather than left to be discovered later.
 */
function Claimed({ claimed, slug }) {
  const count = claimed.ticketCount || 0;
  return (
    <div className="es-plate fx-stack bg-surface p-6" role="status">
      <h2 className="text-lg">You&apos;re in.</h2>
      <p className="text-md text-muted">
        {count} {count === 1 ? 'ticket is' : 'tickets are'} yours.
        {claimed.email && <> We&apos;ve emailed {count === 1 ? 'it' : 'them'} to {claimed.email}.</>}
      </p>
      <p className="text-sm text-subtle">
        Bring the QR code with you — on your phone is fine. If the email does not arrive,
        you can look your tickets up with the address you used.
      </p>
      <div className="fx-row flex-wrap gap-2">
        <Link href="/tickets/find" className="es-btn es-btn--primary">Find my tickets</Link>
        {slug && (
          <Link href={`/e/${slug}`} className="es-btn es-btn--ghost">Back to the event</Link>
        )}
      </div>
    </div>
  );
}

function Fatal({ error, slug }) {
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
