'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { get, post, del } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import { useReservation, heldNoun } from '../../hooks/useReservation';
import { rememberBuyer, recalledBuyer } from '../../lib/cartStore';
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
import PayOptions, { usePayOptions } from './PayOptions';
import ExtrasAdded from './ExtrasAdded';
import { cardFeeNote } from '../../lib/cardFee';
import HolderForms, { holderPayload } from './HolderForms';
import { addressLine } from '../../lib/venueAddress';
import GuestOfField from './GuestOfField';
import { pickFromCode, recalledGuestOf } from '../../lib/guestOf';

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
  // `first` and `last` are the two boxes; `name` is them joined — what the
  // rest of the checkout and the API read (2026-11-24).
  const [buyer, setBuyer] = useState({ name: '', first: '', last: '', email: '' });
  // ONE agreement beside the button (owner, 2026-11-19: "reduce them as
  // possible"). It was three boxes, from the 2026-11-15 reference; the API
  // only ever received one `acceptTerms`, so nothing it records changed.
  const [agreed, setAgreed] = useState(false);
  // Who each ticket is for (2026-11-19), keyed by the quote's holder slots.
  const [holderValues, setHolderValues] = useState({});
  const [holderError, setHolderError] = useState(null);
  // Whose guest (2026-11-23): undefined until the buyer answers, so a host's
  // own link can pick them first (see `guestOfId` below); null = no answer.
  const [guestOfChoice, setGuestOfChoice] = useState(undefined);
  const [guestOfError, setGuestOfError] = useState(null);
  // A free order's lead-guest card starts from what is known (account, or the
  // last checkout in this tab) — once, never over anything typed.
  const [leadSeeded, setLeadSeeded] = useState(false);
  // Optional texts: a number, and separate transactional / marketing boxes.
  const [phone, setPhone] = useState('');

  /**
   * A cart's next checkout starts with the details given at the last one
   * (2026-11-17). After mount, not in the initial state: the server has no
   * tab storage, and a first render that differs from it is a hydration
   * mismatch. Only empty fields are filled — nothing typed is overwritten.
   */
  useEffect(() => {
    const kept = recalledBuyer();
    if (!kept) return undefined;
    const t = setTimeout(() => {
      setBuyer((b) => ({ ...(b.name ? b : seedName(b, kept.name)), email: b.email || kept.email || '' }));
      if (kept.phone) setPhone((p) => p || kept.phone);
    }, 0);
    return () => clearTimeout(t);
  }, []);
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
    setBuyer((b) => ({ ...(b.name ? b : seedName(b, user.fullName)), email: b.email || user.email }));
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

  // Phase 2: card, or reserve and pay the organizer. Asked only once the hold
  // is confirmed and there is something to pay; off by default, when the
  // answer is "card only" and the page is unchanged.
  const [payMode, setPayMode] = useState(null);
  const [methodId, setMethodId] = useState('');
  const payOptions = usePayOptions(reservationId, token(reservation),
    Boolean(ready && reservation && quote && Number(quote.totalCents) > 0), quote?.totalCents);
  const offlineMode = Boolean(payOptions?.available)
    && (payOptions.card === false || payMode === 'offline');

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
  // The host picked: the buyer's own answer, else the one their link named.
  const guestOfId = guestOfChoice !== undefined
    ? guestOfChoice
    : pickFromCode(quote?.guestOf, recalledGuestOf(quote?.event?.slug || reservation?.slug));

  function askToSign(e) {
    e.preventDefault();
    setError(null);
    setSignError(null);
    // "Whose guest are you?" when the organizer requires it — said on the
    // question itself, before the signature is asked for.
    if (quote?.guestOf?.mode === 'required' && !guestOfId) {
      setGuestOfError(`Answer “${quote.guestOf.question}” to continue.`);
      document.getElementById('co-guestof')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSigning(true);
  }

  async function pay(signature) {
    setBusy('pay');
    setError(null);
    setSignError(null);
    // Kept for the next event in the cart (2026-11-17): the buyer types their
    // name and email once. This tab only — never across devices or people.
    // A free order has no contact card: ticket 1's lead guest is the buyer.
    const contact = free ? leadContact(quote, holderValues) : { name: buyer.name, email: buyer.email, phone };
    rememberBuyer(contact);
    try {
      const body = {
        email: contact.email || undefined,
        name: contact.name || undefined,
        acceptTerms: agreed,
        signature,
        ...(!free && smsPayload(sms, phone).sms ? { phone: phone.trim(), ...smsPayload(sms, phone) } : {}),        ...(quote.holders?.slots?.length ? { holders: holderPayload(quote.holders, holderValues) } : {}),
        ...(quote.guestOf ? { guestOfHostId: guestOfId || null } : {}),
      };
      setHolderError(null);

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

      if (offlineMode) {
        // Reserved, not paid: the hold now lasts until the payment deadline and
        // the instructions page is where the buyer goes next. The hold is no
        // longer this tab's to release, so it is forgotten here.
        const reserved = await post(
          `/public/reservations/${reservationId}/offline`, { ...body, methodId },
          { headers: token(reservation), noRedirect: true },
        );
        forget();
        router.push(`/checkout/offline/${reserved.id}?token=${encodeURIComponent(reserved.accessToken)}`);
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
      } else if (err?.meta?.field === 'guestOf') {
        setSigning(false);
        setGuestOfError(err.message);
        document.getElementById('co-guestof')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (err?.meta?.key) {
        // A ticket holder's details were refused: say so on that ticket's card.
        setSigning(false);
        setHolderError({ key: err.meta.key, message: err.message });
        const i = (quote.holders?.slots || []).findIndex((x) => x.key === err.meta.key);
        document.getElementById(`holder-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        accessToken={claimed.accessToken || null}
      />
    );
  }
  if (!quote) return <div className="es-co-narrow"><Loading variant="card" /></div>;

  // Said BEFORE the form, not after Pay: without this tab's token every
  // action below is refused, and the buyer would find out last.
  if (!reservation) return <div className="es-co-narrow"><NotThisTab slug={quote.event?.slug} /></div>;

  // What was held, for how long, and what it costs — before a single field
  // asks for anything. `HoldConfirm` argues the trade-off this step makes.
  // Not for a free order or a no-seat-map one (owner, 2026-11-22): there is no
  // seat to lose and the banner on the form shows the clock, so the extra tap
  // only slowed the buyer down. A paid seated hold still gets it.
  const skipHold = Number(quote.totalCents) === 0 || reservation.kind === 'general';
  if (!ready && !skipHold) {
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
  // Ending the same day: the time alone. "Feb 13, 2027, 7:00 PM EST – Feb 13,
  // 2027, 11:59 PM EST" wrapped to three lines on a phone to say one date twice.
  const sameDay = ev.startsAt && ev.endsAt
    && formatEventTime(ev.startsAt, ev.timezone, { time: false }) === formatEventTime(ev.endsAt, ev.timezone, { time: false });
  const until = ev.endsAt ? formatEventTime(ev.endsAt, ev.timezone, { date: !sameDay }) : null;
  const tickets = quote.tickets || [];
  const allChecked = agreed;

  /**
   * FREE: TICKET HOLDERS ONLY (owner, 2026-11-22). No "Your details" card —
   * one card per ticket, ticket 1 the lead guest, sent as the buyer. Only the
   * first name is required ("Name only", same day); the email is optional. A one-ticket order (or an event that
   * asks no names) has no holder slots from the API, so it gets the lead
   * card alone; the API then names that ticket from the buyer, as before.
   */
  const leadKey = leadKeyOf(quote);
  const holderSlots = free
    ? ((quote.holders?.slots || []).length ? quote.holders.slots
      : [{ key: leadKey, title: tickets.reduce((n, t) => n + t.quantity, 0) > 1 ? 'Your tickets' : 'Ticket 1', tierName: tickets.length === 1 ? tickets[0].name : null }])
    : null;
  if (free && !leadSeeded && (buyer.name || buyer.email) && !holderValues[leadKey]) {
    setLeadSeeded(true);
    const parts = String(buyer.name || '').trim().split(/\s+/).filter(Boolean);
    setHolderValues((v) => ({
      ...v,
      [leadKey]: { firstName: parts[0] || '', lastName: parts.slice(1).join(' '), email: buyer.email || '', phone: phone || '' },
    }));
  }
  const leadName = free ? leadContact(quote, holderValues).name : buyer.name;

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
      <HoldBar expired={expired} remaining={remaining} totalMs={quote.heldForMs} noun={noun} />

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
          {/* Redone 2026-11-22 (owner: "enhance it more professionally"): one
              white card — the event as a compact row, then every line of the
              order (tickets and extras), "Free" where a price is zero. */}
          <section className="es-co__summary" aria-labelledby="co-summary">
            <div className="es-co__summary-head">
              <h2 id="co-summary" className="es-co__h2">Order summary</h2>
              {ev.slug && (
                <Link href={`/e/${ev.slug}`} className="es-co__edit">Event details</Link>
              )}
            </div>

            <div className="es-co__event">
              {ev.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- the event's poster, straight from storage
                <img src={ev.coverUrl} alt="" className="es-co__poster" />
              ) : (
                <span className="es-co__poster es-co__poster--blank" aria-hidden="true"><NavIcon name="ticket" size={28} /></span>
              )}
              <div className="es-co__event-info fx-min0">
                <p className="es-co__event-title fx-break">{ev.title}</p>
                <ul className="es-co__facts">
                  {when && <li><NavIcon name="calendar" size={15} /><span>{when}{until ? ` – ${until}` : ''}</span></li>}
                  {(ev.venue || addressLine(ev)) && (
                    <li><NavIcon name="pin" size={15} /><span>{[ev.venue, addressLine(ev)].filter(Boolean).join(' · ')}</span></li>
                  )}
                  {ev.organizerName && <li><NavIcon name="user" size={15} /><span>By {ev.organizerName}</span></li>}
                </ul>
              </div>
            </div>

            {tickets.length > 0 || (quote.addons || []).length > 0 ? (
              <ul className="es-co__lines" aria-label="Your order">
                {tickets.map((t) => (
                  <li key={t.key} className="es-co__line">
                    <span aria-hidden className="es-co__line-icon"><NavIcon name="ticket" size={18} /></span>
                    <span className="es-co__line-name fx-min0">
                      {t.name}
                      <small className="es-nums">{priceOrFree(t.unitPriceCents, quote.currency)}{Number(t.unitPriceCents) > 0 ? ' each' : ''}</small>
                    </span>
                    <span className="es-co__line-qty es-nums" aria-label={`Quantity ${t.quantity}`}>× {t.quantity}</span>
                  </li>
                ))}
                {(quote.addons || []).map((a) => (
                  <li key={a.addonId} className="es-co__line es-co__line--extra">
                    <span aria-hidden className="es-co__line-icon"><NavIcon name="sparkle" size={18} /></span>
                    <span className="es-co__line-name fx-min0">
                      {a.name}
                      <small className="es-nums">Extra · {priceOrFree(a.unitPriceCents, quote.currency)}{Number(a.unitPriceCents) > 0 ? ' each' : ''}</small>
                    </span>
                    <span className="es-co__line-qty es-nums" aria-label={`Quantity ${a.quantity}`}>× {a.quantity}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="es-co__summary-foot">
              <span>Admits {quote.admits} {quote.admits === 1 ? 'person' : 'people'}</span>
              <b className="es-nums">{priceOrFree(quote.totalCents, quote.currency)}</b>
            </div>
          </section>

          {/* ── Extras: chosen with the tickets before checkout (owner,
                2026-11-22); here the buyer is told plainly whether they
                added any, with the way back to change them. ──────────── */}
          <ExtrasAdded
            quote={quote}
            organizerName={ev.organizerName}
            backHref={ev.slug ? (reservation.kind === 'general' ? `/e/${ev.slug}#event-tickets` : `/e/${ev.slug}/seats`) : null}
          />

          {/* ── Where the tickets go — a paid order only; a free one asks
                the ticket holders alone (below). ─────────────────────── */}
          {!free && (
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
              {/* FIRST AND LAST NAME, TWO BOXES (owner, 2026-11-24). The first is
                  required on every booking (owner, 2026-11-22); the last too
                  when the organizer requires both on every ticket
                  (holder_details 'full') — a one-ticket order's ticket is named
                  from these. The API still receives one `name` and refuses a
                  missing last name itself. */}
              <Field
                label="First name"
                name="firstName"
                type="text"
                required
                maxLength={60}
                autoComplete="given-name"
                value={buyer.first}
                onChange={(e) => setBuyer((b) => withName(b, e.target.value, b.last))}
              />
              <Field
                label="Last name"
                name="lastName"
                type="text"
                required={quote.holders?.mode === 'full'}
                optional={quote.holders?.mode !== 'full'}
                maxLength={60}
                autoComplete="family-name"
                hint={quote.holders?.mode === 'full' ? 'This event prints your first and last name on the ticket.' : null}
                value={buyer.last}
                onChange={(e) => setBuyer((b) => withName(b, b.first, e.target.value))}
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
          )}

          {/* Who each ticket is for — two tickets and up, as the event asks
              (2026-11-19); on a free order, always, with the lead guest first. */}
          {/* Whose guest (2026-11-23): the organizer's hosts, when they ask. */}
          <GuestOfField
            guestOf={quote.guestOf} value={guestOfId}
            onChange={(id) => { setGuestOfChoice(id); setGuestOfError(null); }}
            error={guestOfError}
          />

          <HolderForms holders={free ? { mode: quote.holders?.mode || 'optional', slots: holderSlots } : quote.holders}
            values={holderValues} onChange={setHolderValues}
            buyer={buyer} phone={phone} error={holderError} lead={free} />
        </div>

        <aside className="es-co__side">
          {/* A free order says so, loudly, the way the reference does: the
              buyer is not about to be charged, and that is good news. */}
          {free && <FreeStamp />}

          <section className="es-co__total" aria-labelledby="co-total">
            <h2 id="co-total" className="sr-only">Total and payment</h2>

            <PayOptions
              options={payOptions}
              mode={offlineMode ? 'offline' : 'card'}
              onMode={setPayMode}
              methodId={methodId}
              onMethod={setMethodId}
              timezone={ev.timezone}
              cardTotalCents={quote.totalCents}
              currency={quote.currency}
            />

            {!free && (
              <dl className="es-co__breakdown">
                {((offlineMode && Array.isArray(payOptions.lines)) ? payOptions.lines : quote.lines).map((line) => (
                  <div key={line.label}>
                    <dt>{line.label}</dt>
                    <dd className="es-nums">{formatMoney(line.amountCents, quote.currency)}</dd>
                    {/* What the card processing fee is, and the rate it came from (2026-11-19). */}
                    {line.basis && cardFeeNote(line.basis, quote.currency) && (
                      <dd className="es-co__fee-note">{cardFeeNote(line.basis, quote.currency)}</dd>
                    )}
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
              <b className="es-nums">{free ? 'Free' : formatMoney(offlineMode ? payOptions.totalCents : quote.totalCents, quote.currency)}</b>
            </div>

            {/* BRD §02 — the terms are accepted before buying, and the API
                records the acceptance against the version shown. One box now
                carries all three statements the reference had as three: the
                terms, no refunds from Eventsli, and one entry per e-ticket.
                Every word is still in front of the buyer; only the taps went. */}
            <div className="es-co__agree">
              <label>
                <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>
                  I accept the <Link href="/terms">Terms &amp; conditions</Link>, the{' '}
                  <Link href="/privacy">Privacy policy</Link> and the purchase agreement: tickets are
                  non-refundable (any refund is between me and the organizer), and each ticket is valid for
                  one entry with the e-ticket{free ? '' : ' emailed to me'}.
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
              disabled={busy === 'pay' || expired || !allChecked || (offlineMode && !methodId)}
              aria-busy={busy === 'pay' || undefined}
              className={`es-co__submit ${free ? 'es-co__submit--free' : ''}`}
            >
              <NavIcon name={free ? 'ticket' : offlineMode ? 'cash' : 'lock'} size={20} />
              {busy === 'pay'
                ? (free ? 'Getting your tickets…' : offlineMode ? 'Reserving…' : 'Taking you to payment…')
                : free ? 'Get my free tickets' : offlineMode ? 'Reserve and get payment details' : `Pay ${formatMoney(quote.totalCents, quote.currency)}`}
            </button>
            <p className="es-co__secure">
              <NavIcon name="pencil" size={16} />
              {free
                ? 'You will sign to confirm, and your tickets appear straight away.'
                : offlineMode
                  ? 'You will sign to confirm. You pay the organizer directly — Eventsli never takes this payment.'
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
        defaultName={leadName}
        actionLabel={free ? 'Get my free tickets' : offlineMode ? 'Reserve and get payment details' : `Pay ${formatMoney(quote.totalCents, quote.currency)}`}
        busyLabel={free ? 'Getting your tickets…' : offlineMode ? 'Reserving…' : 'Taking you to payment…'}
      />
    </>
  );
}

/** A full name split for the two boxes: the first word, then the rest. */
export function nameParts(full) {
  const p = String(full || '').trim().split(/\s+/).filter(Boolean);
  return { first: p[0] || '', last: p.slice(1).join(' ') };
}

/** The buyer with new first/last boxes, and `name` kept as the two joined. */
export function withName(b, first, last) {
  const name = [first, last].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  return { ...b, first, last, name };
}

/** The buyer seeded from a remembered or account full name. */
function seedName(b, full) {
  const { first, last } = nameParts(full);
  return withName(b, first, last);
}

/** The key of a free order's lead-guest card: the API's first holder slot, or
 *  a local one when the API sends none (a one-ticket order). */
function leadKeyOf(quote) {
  return quote?.holders?.slots?.[0]?.key || 'lead';
}

/** A free order's buyer, read from its lead-guest card. */
function leadContact(quote, values) {
  const v = values[leadKeyOf(quote)] || {};
  return {
    name: [v.firstName, v.lastName].map((s) => String(s || '').trim()).filter(Boolean).join(' '),
    email: String(v.email || '').trim(),
    phone: String(v.phone || '').trim(),
  };
}

/** A price, or "Free" when it is zero (owner, 2026-11-22: never "$0.00"). */
function priceOrFree(cents, currency) {
  return Number(cents) === 0 ? 'Free' : formatMoney(cents, currency);
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
