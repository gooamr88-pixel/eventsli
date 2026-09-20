'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { get, post, del } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import { useReservation, heldNoun } from '../../hooks/useReservation';
import { useCountdown } from '../../hooks/useCountdown';
import HoldBar from './HoldBar';
import HoldConfirm from './HoldConfirm';
import Field from '../../components/forms/Field';
import { Claimed, Fatal, PayError } from '../Outcomes';
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
  // "seats", "table" or "tickets" — a general-admission event has no seats, and
  // this screen named them anyway. See `heldNoun`.
  const noun = heldNoun(reservation);

  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);
  const [promoCode, setPromoCode] = useState('');
  const [promoError, setPromoError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [buyer, setBuyer] = useState({ name: '', email: '', acceptTerms: false });
  // Set once a free claim has issued the tickets. There is no payment step and
  // nothing to wait for, so this page shows the outcome itself.
  const [claimed, setClaimed] = useState(null);

  /**
   * The hold is confirmed before the form is asked for.
   *
   * Not remembered across a reload, and that is the point rather than a gap:
   * somebody coming back to this page gets the countdown again, shorter than
   * last time, which is the single most useful thing it can tell them.
   */
  const [ready, setReady] = useState(false);

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
          `/public/reservations/${reservationId}/claim`, body,
          // The token proves this browser made the hold. Without it the API
          // refuses: a reservation id is in the URL, so it is not proof, and
          // free tickets issued on one alone go to whoever asked.
          { headers: token(reservation), noRedirect: true },
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
        `/public/reservations/${reservationId}/checkout`, body,
        { headers: token(reservation), noRedirect: true },
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

  // What was held, for how long, and what it costs — before a single field
  // asks for anything. `HoldConfirm` argues the trade-off this step makes.
  if (!ready) {
    return (
      <HoldConfirm
        quote={quote}
        formatted={formatted}
        remaining={remaining}
        expired={expired}
        totalMs={quote.heldForMs}
        noun={noun}
        slug={quote.event?.slug || reservation?.slug}
        onProceed={() => setReady(true)}
      />
    );
  }

  const discount = quote.lines.find((l) => l.amountCents < 0);
  // Nothing to pay. Everything the page says about payment changes with it.
  const free = Number(quote.totalCents) === 0;

  // In the EVENT's zone, and labelled with it — `formatEventTime` appends the
  // short zone name, so a buyer in another timezone reads "8:00 PM EST" rather
  // than a number that quietly disagrees with their ticket.
  const eventWhen = quote.event?.startsAt
    ? formatEventTime(quote.event.startsAt, quote.event.timezone)
    : null;

  return (
    <div className="fx-stack">
      {/**
        * WHICH EVENT THIS IS — kept on screen, not left behind.
        *
        * `HoldConfirm` names the event, and then hands over to this form and
        * disappears. From that point the page said "Your order" over a list of
        * money with no title, no date and no venue anywhere on it: somebody who
        * opened two events in two tabs, or came back to this one after a
        * detour, had nothing to check before paying. Every value comes from the
        * quote the totals come from, so it cannot describe a different order
        * from the one being charged.
        */}
      <header className="fx-stack fx-stack--sm gap-1">
        <h1 className="text-2xl">Your order</h1>
        {quote.event?.title && (
          <p className="fx-break text-md text-ink">{quote.event.title}</p>
        )}
        {(eventWhen || quote.event?.venue) && (
          <p className="text-sm text-muted">
            {eventWhen}
            {eventWhen && quote.event?.venue && ' · '}
            {quote.event?.venue}
          </p>
        )}
      </header>

      {/* `remaining` is passed down rather than recomputed there: reading
          Date.now() during a render is impure, and the value already exists
          on the same one-second beat as the text beside it. */}
      <HoldBar formatted={formatted} expired={expired} remaining={remaining} noun={noun} />

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
        {/* `Field`, not a bare input with a placeholder. Both of these carried
            their label in `placeholder` + `aria-label`, which is the one
            pattern `Field`'s own note argues against: a placeholder disappears
            the moment somebody types, so a buyer who looks away mid-form has to
            clear the box to find out what it wanted. On the screen that takes
            their money and decides where the tickets are sent, that is the
            worst place in the product for it. `Field` also gives each one a
            real `<label for>`, the required star, and `aria-describedby` for
            the hint below. */}
        <Field
          label="Full name"
          name="name"
          type="text"
          optional
          autoComplete="name"
          value={buyer.name}
          onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))}
        />
        {/* Required, because the API refuses without one — "Enter an email
            address — your tickets are sent there." Catching it in the browser
            saves a round trip that ends in a red box under a button they
            already pressed. */}
        <Field
          label="Email address"
          name="email"
          type="email"
          required
          inputMode="email"
          autoComplete="email"
          hint="Your tickets and receipt are sent here — check it for typos."
          value={buyer.email}
          onChange={(e) => setBuyer((b) => ({ ...b, email: e.target.value }))}
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

        {/**
          * WHERE THE CARD DETAILS GO, said before the button rather than
          * discovered after it.
          *
          * Pressing Pay leaves this site: `createSession` returns a Stripe
          * Checkout URL and the handler above does a full navigation to it. A
          * buyer who expected a card form here and lands on a different domain
          * has to decide whether that is the payment step or something wrong,
          * and the page they left said nothing either way.
          *
          * Two plain facts, both true and both checkable — the name of the
          * processor, and that the card never touches this server. No padlock
          * glyph, no "100% secure", no trust-seal image: a claim about security
          * made by the party asking for the money is worth nothing, and the
          * decoration is what a phishing page copies first.
          *
          * Only on the paid path. A free claim goes nowhere near Stripe.
          */}
        {!free && (
          <p className="text-center text-xs text-subtle">
            You will finish on Stripe, our payment processor. Your card details are
            entered there and never reach us.
          </p>
        )}

        <button
          type="button" onClick={abandon} disabled={busy === 'release'}
          aria-busy={busy === 'release' || undefined}
          className="es-btn es-btn--ghost es-btn--block"
        >
          {busy === 'release' ? 'Releasing…' : `Release my ${noun.many}`}
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

/* The four ending screens live in `../Outcomes.jsx` — the free claim's, the
   payment failure, the fatal one, and the mark they share with the paid
   success page. That file argues why they are together. */
