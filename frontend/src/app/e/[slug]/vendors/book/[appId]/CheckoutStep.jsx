'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { post } from '../../../../../utils/apiClient';
import { formatMoney } from '../../../../../utils/money';
import { formatEventTime } from '../../../../../lib/eventTime';
import Field from '../../../../../components/forms/Field';
import FormError from '../../../../../components/forms/FormError';
import NavIcon from '../../../../../components/shell/NavIcon';
import SignatureDialog from '../../../../../checkout/[reservationId]/SignatureDialog';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 2 of a vendor booking (owner's reference, 2026-11-21): the order
 * summary on the left — event card, the booth, each add-on — and on the
 * right "Choose payment method", the total and the button.
 *
 *   instant  sign the vendor terms, then pay on Stripe (the organizer's own
 *            account, as tickets are). Without card payment for this
 *            organizer, signing books it and the organizer collects the fee.
 *   apply    review and send the application. Nothing is charged.
 *
 * The reference types the card into the page. We send the vendor to Stripe's
 * own page instead, so card numbers never pass through Eventsli — the tile
 * and the line under it say so rather than drawing fields we would not use.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CheckoutStep({ booking, expired, onBack, onRelease, releasing }) {
  const router = useRouter();
  const ev = booking.event;
  const instant = booking.mode === 'instant';
  const money = (c) => (c === 0 ? 'Free' : formatMoney(c, booking.currency));
  const total = booking.amountCents;
  const card = booking.card?.available;
  const free = total === 0;
  const [agreed, setAgreed] = useState(booking.signed);
  const [name, setName] = useState(booking.business.contactName || '');
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [signError, setSignError] = useState(null);

  const poster = ev.coverUrl || booking.booth?.imageUrl || null;
  const when = ev.startsAt ? formatEventTime(ev.startsAt, ev.timezone) : null;
  const action = !instant ? 'Send application' : free ? 'Confirm booking' : card ? `Pay ${money(total)}` : 'Book and get payment details';

  async function finish(signature) {
    setBusy(true);
    setError(null);
    setSignError(null);
    try {
      if (!instant) {
        await post(`/partner/vendors/bookings/${booking.id}/submit`, {}, { noRedirect: true });
        router.push(`/account/vendors/${booking.id}?sent=1`);
        return;
      }
      const body = booking.signed ? {} : { signature, signerName: name.trim(), accept: true, method: card ? 'card' : 'offline' };
      const result = await post(`/partner/vendors/bookings/${booking.id}/checkout`, body, { noRedirect: true });
      if (result.url) {
        window.location.href = result.url;
        return;
      }
      router.push(`/account/vendors/${booking.id}?booked=1`);
    } catch (err) {
      if (String(err?.code || '').startsWith('SIGNATURE_')) setSignError(err);
      else { setSigning(false); setError(err); }
      setBusy(false);
    }
  }

  function go(e) {
    e.preventDefault();
    if (!instant || booking.signed) { finish(null); return; }
    setSigning(true);
  }

  return (
    <>
      <form onSubmit={go} className="es-co__grid">
        <div className="es-co__main">
          <section className="es-co__summary" aria-labelledby="vb-summary">
            <h2 id="vb-summary" className="es-co__h2">Order Summary</h2>
            <p className="es-co__sub">Review your selections and check the total cost.</p>
            {/* The event's poster; without one, the booth's photo, so the card is never a lone column. */}
            <div className={`es-co__event ${poster ? 'es-co__event--poster' : ''}`}>
              {poster && (
                // eslint-disable-next-line @next/next/no-img-element -- the event's poster or the booth's photo, from storage
                <img src={poster} alt="" className="es-co__poster" />
              )}
              <div className="es-co__event-info">
                <p className="es-co__event-title fx-break"><NavIcon name="info" size={18} />{ev.title}</p>
                <ul className="es-co__facts">
                  {when && <li><NavIcon name="calendar" size={16} />{when}</li>}
                  {ev.venue && <li><NavIcon name="building" size={16} />{ev.venue}</li>}
                  {(ev.venueAddress || ev.city) && <li className="es-co__fact--addr"><NavIcon name="pin" size={16} />{ev.venueAddress || ev.city}</li>}
                  {ev.organizerName && <li className="es-co__fact--org"><NavIcon name="tag" size={16} /><span><b>Organized by:</b> {ev.organizerName}</span></li>}
                </ul>
                <p className="es-co__more"><b>Venue:</b> {ev.venue || ev.city} <Link href={`/e/${ev.slug}`}>See more</Link></p>
              </div>
            </div>

            <ul className="es-vb-lines" aria-label="Your booking">
              <li className="es-vb-line">
                <span className="es-vb-line__thumb">
                  {booking.booth?.imageUrl
                    // eslint-disable-next-line @next/next/no-img-element -- the booth's photo
                    ? <img src={booking.booth.imageUrl} alt="" />
                    : <NavIcon name="store" size={22} />}
                </span>
                <span className="es-vb-line__name fx-min0 fx-break">
                  {booking.booth?.name || 'Any booth — the organizer will offer one'}
                  {booking.boothLabel && <span className="es-vb-line__sub">Booth {booking.boothLabel}</span>}
                </span>
                <span className="es-vb-line__price es-nums">{money(booking.boothCents)}</span>
                <span className="es-vb-line__tools">
                  {booking.booth && (
                    <Link href={`/e/${ev.slug}/vendors/booths/${booking.booth.id}`} className="es-vb-iconbtn" aria-label="Change the booth or add-ons" title="Change">
                      <NavIcon name="pencil" size={18} />
                    </Link>
                  )}
                  <button type="button" className="es-vb-iconbtn" onClick={onRelease} disabled={releasing || busy}
                    aria-label={instant ? 'Release this booth' : 'Delete this application'} title={instant ? 'Release' : 'Delete'}>
                    <NavIcon name="trash" size={18} />
                  </button>
                </span>
              </li>
              {booking.addons.map((a) => (
                <li key={a.id} className="es-vb-line es-vb-line--addon">
                  <span className="es-vb-line__thumb es-vb-line__thumb--sm"><NavIcon name="plus" size={16} /></span>
                  <span className="es-vb-line__name fx-min0 fx-break">{a.name}<span className="es-vb-line__sub">{a.kind === 'marketing' ? 'Marketing add-on' : 'Booth add-on'}</span></span>
                  <span className="es-vb-line__price es-nums">{money(a.priceCents)}</span>
                  <span className="es-vb-line__tools" />
                </li>
              ))}
            </ul>
          </section>

          <section className="es-co__card" aria-labelledby="vb-who">
            <h2 id="vb-who" className="es-co__h2 es-co__h2--icon"><NavIcon name="store" size={20} />{booking.business.businessName}</h2>
            <p className="es-co__sub">
              {[booking.business.address, booking.business.city, booking.business.postalCode].filter(Boolean).join(', ')}
              {booking.business.category ? ` · ${booking.business.category}` : ''}
            </p>
            <button type="button" className="es-vb-link" onClick={onBack}>Edit business details</button>
          </section>
        </div>

        <aside className="es-co__side">
          <section className="es-co__total" aria-labelledby="vb-pay">
            {instant && !free && (
              <>
                <h2 id="vb-pay" className="es-vb-paytitle">Choose payment method:</h2>
                {/* One way to pay per booking, so a chosen tile rather than a radio group of one. */}
                <div className="es-vb-methods">
                  <p className="es-vb-method">
                    <span className="es-vb-method__check" aria-hidden="true"><NavIcon name="tick" size={14} /></span>
                    <NavIcon name={card ? 'card' : 'bank'} size={28} />
                    {card ? 'Credit card' : 'Pay the organizer'}
                    <span className="sr-only"> (selected)</span>
                  </p>
                </div>
                <p className="es-vb-paynote">
                  {card
                    ? <><NavIcon name="lock" size={16} />You will enter your card on Stripe’s secure page. Your card details never reach Eventsli.</>
                    : <><NavIcon name="info" size={16} />{booking.program.paymentInstructions || `${ev.organizerName || 'The organizer'} will send you payment details. Your booth is booked when you sign.`}</>}
                </p>
              </>
            )}
            {!instant && <h2 id="vb-pay" className="es-vb-paytitle">Ready to send?</h2>}

            <div className="es-co__total-row">
              <span>Total Price:</span>
              <b className="es-nums">{money(total)}</b>
            </div>
            {!instant && <p className="es-co__secure"><NavIcon name="info" size={16} />Nothing is charged now. If the organizer offers you this booth, you pay then.</p>}

            {instant && !booking.signed && (
              <>
                {booking.program.terms && (
                  <details className="es-vb-terms">
                    <summary>Read the vendor terms</summary>
                    <div className="fx-break whitespace-pre-line">{booking.program.terms}</div>
                  </details>
                )}
                <Field label="Your full name (signing)" name="vb-signer" required maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                <div className="es-co__agree">
                  <label>
                    <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                    <span>I agree to the vendor terms on behalf of {booking.business.businessName}, and to the Eventsli <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy policy</Link>.</span>
                  </label>
                </div>
              </>
            )}
            {booking.signed && <p className="es-co__secure"><NavIcon name="check" size={16} />Terms signed. Finish paying to book your booth.</p>}

            <FormError error={error} />
            <button type="submit" className="es-vb-btn es-vb-btn--sun es-vb-btn--block"
              disabled={busy || expired || (instant && !booking.signed && (!agreed || name.trim().length < 2))} aria-busy={busy || undefined}>
              <NavIcon name={!instant ? 'send' : card && !free ? 'card' : 'check'} size={20} />
              {busy ? 'One moment…' : action}
            </button>
            {instant && !booking.signed && <p className="es-co__secure"><NavIcon name="pencil" size={16} />You will sign to confirm{card && !free ? ', then finish on Stripe' : ''}.</p>}
          </section>
        </aside>
      </form>

      <SignatureDialog
        open={signing && !expired}
        onClose={() => { if (!busy) setSigning(false); }}
        onSign={finish}
        busy={busy}
        error={signError}
        defaultName={name}
        actionLabel={action}
        busyLabel="One moment…"
        legal={<>By signing, you book this vendor space and accept its terms on behalf of {booking.business.businessName}. Your signature is kept with the booking.</>}
      />
    </>
  );
}
