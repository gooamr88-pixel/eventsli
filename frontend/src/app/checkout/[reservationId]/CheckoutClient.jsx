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
import { useAuth } from '../../hooks/useAuth';
import HoldBar from './HoldBar';
import HoldConfirm from './HoldConfirm';
import Field from '../../components/forms/Field';
import SmsConsentFields, { smsPayload } from '../../components/forms/SmsConsentFields';
import { Fatal, NotThisTab, PayError } from '../Outcomes';
import OrderConfirmation from '../OrderConfirmation';
import { Loading } from '../../components/Feedback';
import NavIcon from '../../components/shell/NavIcon';
import SignatureDialog from './SignatureDialog';

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
  const { reservation: stored, release, forget } = useReservation();
  /**
   * THE HOLD THIS PAGE IS ABOUT, or null. The tab remembers one hold, and it
   * is not necessarily this one: a checkout reopened from history, or a link
   * pasted into another tab, used to send whatever token the tab held — and
   * Pay was refused as "not yours" only after the buyer had filled the form.
   */
  const reservation = stored?.reservationId === reservationId ? stored : null;
  // "seats", "table" or "tickets" — a general-admission event has no seats, and
  // this screen named them anyway. See `heldNoun`.
  const noun = heldNoun(reservation);

  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);
  const [promoCode, setPromoCode] = useState('');
  const [promoError, setPromoError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [buyer, setBuyer] = useState({ name: '', email: '' });
  // The three agreements beside the button (owner's reference, 2026-11-15).
  const [checks, setChecks] = useState({ terms: false, refund: false, entry: false });
  // Optional texts: a number, and separate transactional / marketing boxes.
  const [phone, setPhone] = useState('');
  const [sms, setSms] = useState({});

  /**
   * A SIGNED-IN BUYER'S EMAIL IS FILLED IN (TECH-AUDIT-LOG S-20). The form
   * said "Signed in? We will use your account email" over a required, empty
   * email field. Filled once per account, never over anything typed, and still
   * editable — tickets for a gift go to someone else's address. Set during
   * render, the React 19 way to follow a value that arrives after mount.
   */
  const { user } = useAuth();
  const [prefilledFor, setPrefilledFor] = useState(null);
  if (user?.email && prefilledFor !== user.id) {
    setPrefilledFor(user.id);
    setBuyer((b) => ({ ...b, email: b.email || user.email, name: b.name || user.fullName || '' }));
  }
  // Set once a free claim has issued the tickets. There is no payment step and
  // nothing to wait for, so this page shows the outcome itself.
  const [claimed, setClaimed] = useState(null);
  // The signature step (owner's reference, 2026-11-15): Pay opens it, and the
  // order is placed from inside it. A refusal about the signature stays in the
  // dialog; any other refusal closes it and shows on the page as before.
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState(null);

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
      // offers a hold that no longer exists. Only THIS hold's record.
      if (reservation) forget();
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
  /**
   * Pay (or "Get my free tickets") on the page asks for the signature; the
   * browser has already checked the email and the three agreements by then,
   * because they are `required` in this form.
   */
  function askToSign(e) {
    e.preventDefault();
    setError(null);
    setSignError(null);
    setSigning(true);
  }

  async function pay(signature) {
    setBusy('pay');
    setError(null);
    setSignError(null);
    try {
      const body = {
        email: buyer.email || undefined,
        name: buyer.name || undefined,
        acceptTerms: checks.terms && checks.refund && checks.entry,
        signature,
        ...(smsPayload(sms, phone).sms ? { phone: phone.trim(), ...smsPayload(sms, phone) } : {}),
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
        // The event and the tickets come back with the claim, so the buyer can
        // save and print them here (OrderConfirmation).
        setClaimed(result);
        // The confirmation starts at its top, not wherever the form was scrolled.
        window.scrollTo({ top: 0 });
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
      if (String(err?.code || '').startsWith('SIGNATURE_')) {
        setSignError(err);
      } else {
        setSigning(false);
        setError(err);
      }
      setBusy(null);
    }
  }

  async function abandon() {
    setBusy('release');
    await release({ reservationId, reservationToken: reservation?.reservationToken });
    router.push(reservation?.slug ? `/e/${reservation.slug}` : '/events');
  }

  if (error && !quote) return <div className="es-co-narrow"><Fatal error={error} slug={reservation?.slug || stored?.slug} /></div>;
  if (claimed) {
    return (
      <OrderConfirmation
        free
        email={claimed.email}
        event={claimed.event || quote?.event || null}
        tickets={claimed.tickets || []}
        signedIn={Boolean(user)}
        holderName={buyer.name || null}
      />
    );
  }
  if (!quote) return <div className="es-co-narrow"><Loading variant="card" /></div>;

  // Said BEFORE the form, not after Pay: without this tab's token every
  // action below is refused, and the buyer would find out last.
  if (!reservation) return <div className="es-co-narrow"><NotThisTab slug={quote.event?.slug} /></div>;

  // What was held, for how long, and what it costs — before a single field
  // asks for anything. `HoldConfirm` argues the trade-off this step makes.
  if (!ready) {
    return (
      <div className="es-co-narrow">
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
      </div>
    );
  }

  const discount = quote.lines.find((l) => l.amountCents < 0);
  const free = Number(quote.totalCents) === 0;
  const ev = quote.event || {};
  const when = ev.startsAt ? formatEventTime(ev.startsAt, ev.timezone) : null;
  const until = ev.endsAt ? formatEventTime(ev.endsAt, ev.timezone) : null;
  const tickets = quote.tickets || [];
  const allChecked = checks.terms && checks.refund && checks.entry;
  const tick = (key) => (e) => setChecks((c) => ({ ...c, [key]: e.target.checked }));

  return (
    /**
     * ONE FORM around the whole page (owner's reference, 2026-11-15): the
     * buyer's details sit in the left column and the agreement and the button
     * in the right, and both belong to the same submit. The discount code is
     * not a nested form (HTML has none) — its button is `type="button"` and
     * Enter in its box applies it rather than paying.
     */
    <>
    <form onSubmit={askToSign} className="es-co">
      <HoldBar expired={expired} remaining={remaining} noun={noun} />

      <nav aria-label="Breadcrumb" className="es-co__crumbs">
        <Link href="/events">Events</Link>
        <span aria-hidden>/</span>
        {ev.slug && <><Link href={`/e/${ev.slug}`} className="fx-truncate">{ev.title}</Link><span aria-hidden>/</span></>}
        {ev.slug && <><Link href={`/e/${ev.slug}#event-tickets`}>Tickets</Link><span aria-hidden>/</span></>}
        <span aria-current="page" className="es-co__crumbs-here">Checkout</span>
      </nav>
      <h1 className="es-co__title">Checkout</h1>

      <div className="es-co__grid">
        <div className="es-co__main">
          {/* ── The order summary ─────────────────────────────────────── */}
          <section className="es-co__summary" aria-labelledby="co-summary">
            <h2 id="co-summary" className="es-co__h2">Order summary</h2>
            <p className="es-co__sub">Review your selections and check the total cost.</p>

            <div className="es-co__event">
              {ev.coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- the event's poster, straight from storage
                <img src={ev.coverUrl} alt="" className="es-co__poster" />
              )}
              <div className="es-co__event-info">
                <p className="es-co__event-title fx-break">
                  <NavIcon name="info" size={18} />
                  {ev.title}
                </p>
                <ul className="es-co__facts">
                  {when && (
                    <li><NavIcon name="calendar" size={16} />{when}{until ? ` – ${until}` : ''}</li>
                  )}
                  {ev.venue && <li><NavIcon name="building" size={16} />{ev.venue}</li>}
                  {(ev.venueAddress || ev.city) && <li><NavIcon name="pin" size={16} />{ev.venueAddress || ev.city}</li>}
                  {ev.organizerName && <li><NavIcon name="tag" size={16} /><span><b>Organized by:</b> {ev.organizerName}</span></li>}
                </ul>
                {ev.slug && (
                  <p className="es-co__more"><b>Event details:</b> <Link href={`/e/${ev.slug}`}>See more</Link></p>
                )}
              </div>
            </div>

            {tickets.length > 0 ? (
              <ul className="es-co__lines" aria-label="Tickets">
                {tickets.map((t) => (
                  <li key={t.key} className="es-co__line">
                    <span aria-hidden className="es-co__line-icon"><NavIcon name="ticket" size={18} /></span>
                    <span className="es-co__line-name fx-min0 fx-break">{t.name}</span>
                    <span className="es-co__line-price es-nums">{formatMoney(t.unitPriceCents, quote.currency)}</span>
                    <span className="es-co__line-qty es-nums" aria-label={`Quantity ${t.quantity}`}>× {t.quantity}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="es-co__admits">Admits {quote.admits} {quote.admits === 1 ? 'person' : 'people'}</p>
            )}
          </section>

          {/* ── Where the tickets go ──────────────────────────────────── */}
          <section className="es-co__card" aria-labelledby="co-details">
            <h2 id="co-details" className="es-co__h2 es-co__h2--icon">
              <NavIcon name="user" size={20} />
              Your details
            </h2>
            {/* Guest checkout is a first-class path: an email, no account. */}
            <p className="es-co__sub">
              No account needed. Signed in? Your account email is filled in — change it to send the tickets elsewhere.
            </p>
            <div className="es-co__fields">
              <Field
                label="Full name"
                name="name"
                type="text"
                optional
                autoComplete="name"
                value={buyer.name}
                onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))}
              />
              {/* Required: the API refuses without one — the tickets go there. */}
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
            </div>
            <SmsConsentFields mode="checkout" value={sms} onChange={setSms} phone={phone} onPhone={setPhone} showPhone
              organizerName={ev.organizerName} />
          </section>
        </div>

        <aside className="es-co__side">
          {/* A free order says so, loudly, the way the reference does: the
              buyer is not about to be charged, and that is good news. */}
          {free && <FreeStamp />}

          <section className="es-co__total" aria-labelledby="co-total">
            <h2 id="co-total" className="sr-only">Total and payment</h2>

            {!free && (
              <dl className="es-co__breakdown">
                {quote.lines.map((line) => (
                  <div key={line.label}>
                    <dt>{line.label}</dt>
                    <dd className="es-nums">{formatMoney(line.amountCents, quote.currency)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {!free && (
              <div className="es-co__promo">
                {discount ? (
                  <div className="es-co__promo-on">
                    <span><NavIcon name="tag" size={16} /> {discount.label} applied</span>
                    <button type="button" onClick={removePromo} disabled={busy === 'promo'} className="es-co__link">Remove</button>
                  </div>
                ) : (
                  <div className="es-co__promo-row">
                    <input
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (promoCode.trim().length >= 2) applyPromo(e); } }}
                      placeholder="Discount code"
                      aria-label="Discount code"
                      className="es-input"
                    />
                    <button
                      type="button"
                      onClick={applyPromo}
                      disabled={busy === 'promo' || promoCode.trim().length < 2}
                      className="es-co__apply"
                    >
                      Apply
                    </button>
                  </div>
                )}
                {promoError && <p role="alert" className="text-sm text-danger">{describeError(promoError).recovery}</p>}
              </div>
            )}

            <div className="es-co__total-row">
              <span>Total amount</span>
              <b className="es-nums">{free ? formatMoney(0, quote.currency) : formatMoney(quote.totalCents, quote.currency)}</b>
            </div>

            {/* BRD §02 — the terms are accepted before buying, and the API
                records the acceptance against the version shown. The three
                statements are the reference's; all three are required, and
                `acceptTerms` is sent only when every one is ticked. */}
            <div className="es-co__agree">
              <label>
                <input type="checkbox" required checked={checks.terms} onChange={tick('terms')} />
                <span>
                  By proceeding you accept the <Link href="/terms">Terms &amp; conditions</Link>, the{' '}
                  <Link href="/privacy">Privacy policy</Link> and the purchase agreement.
                </span>
              </label>
              <label>
                <input type="checkbox" required checked={checks.refund} onChange={tick('refund')} />
                <span>I accept that tickets are non-refundable; any refund is between me and the organizer.</span>
              </label>
              <label>
                <input type="checkbox" required checked={checks.entry} onChange={tick('entry')} />
                <span>
                  Entry requires the electronic ticket sent by email (with its QR code, and seat number if
                  applicable). Each ticket is valid for one entry only.
                </span>
              </label>
            </div>

            {/* The organizer's own checkout policies, before the button: a
                refund policy read after paying becomes an email. */}
            {(quote.policies || []).length > 0 && (
              <div className="es-co__policies">
                {quote.policies.map((policy) => (
                  <details key={policy.id}>
                    <summary>{policy.title}</summary>
                    <div className="fx-break whitespace-pre-line">{policy.body}</div>
                  </details>
                ))}
              </div>
            )}

            {error && <PayError error={error} />}

            <button
              type="submit"
              disabled={busy === 'pay' || expired || !allChecked}
              aria-busy={busy === 'pay' || undefined}
              className={`es-co__submit ${free ? 'es-co__submit--free' : ''}`}
            >
              <NavIcon name={free ? 'ticket' : 'lock'} size={20} />
              {busy === 'pay'
                ? (free ? 'Getting your tickets…' : 'Taking you to payment…')
                : free ? 'Get my free tickets' : `Pay ${formatMoney(quote.totalCents, quote.currency)}`}
            </button>
            <p className="es-co__secure">
              <NavIcon name="pencil" size={16} />
              {free
                ? 'You will sign to confirm, and your tickets are emailed straight away.'
                : 'You will sign to confirm, then finish on Stripe, our payment processor. Your card details never reach us.'}
            </p>

            <button type="button" onClick={abandon} disabled={busy === 'release'} className="es-co__release">
              {busy === 'release' ? 'Releasing…' : `Release my ${noun.many}`}
            </button>
          </section>
        </aside>
      </div>
    </form>

    {/* Outside the page's form: the dialog has a form of its own, and HTML
        has no nested forms. */}
    <SignatureDialog
        open={signing && !expired}
        onClose={() => { if (busy !== 'pay') setSigning(false); }}
        onSign={pay}
        busy={busy === 'pay'}
        error={signError}
        free={free}
        defaultName={buyer.name}
        actionLabel={free ? 'Get my free tickets' : `Pay ${formatMoney(quote.totalCents, quote.currency)}`}
        busyLabel={free ? 'Getting your tickets…' : 'Taking you to payment…'}
      />
    </>
  );
}

/** The "FREE" stamp beside a free order — drawn, in the brand coral. */
function FreeStamp() {
  return (
    <div className="es-co__stamp" aria-hidden="true">
      <svg viewBox="0 0 320 220">
        <g transform="rotate(-14 160 110)">
          <rect x="28" y="40" width="264" height="140" rx="22" fill="none" stroke="currentColor" strokeWidth="10" />
          <rect x="46" y="58" width="228" height="104" rx="12" fill="none" stroke="currentColor" strokeWidth="4" />
          <text x="160" y="134" textAnchor="middle" fontFamily="var(--es-font-display)" fontWeight="900" fontSize="74" fill="currentColor" letterSpacing="4">FREE</text>
          {[60, 100, 220, 260].map((x) => (
            <path key={x} d={`M${x} 26l3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z`} fill="currentColor" />
          ))}
        </g>
      </svg>
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
