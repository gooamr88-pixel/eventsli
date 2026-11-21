'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { get, post } from '../../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../../utils/errors';
import { useApi } from '../../../../../hooks/useApi';
import { useCountdown } from '../../../../../hooks/useCountdown';
import { useConfirm } from '../../../../../components/ui/Confirm';
import { useToast } from '../../../../../components/ui/Toast';
import { Loading, ErrorNotice } from '../../../../../components/Feedback';
import NavIcon from '../../../../../components/shell/NavIcon';
import HoldBar from '../../../../../checkout/[reservationId]/HoldBar';
import BusinessStep from './BusinessStep';
import CheckoutStep from './CheckoutStep';

const NOUN = { one: 'booth', many: 'booth', they: 'it' };

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A VENDOR BOOKING IN PROGRESS (owner's reference, 2026-11-21): two steps on
 * one page, under the cart timer when a booth is held.
 *
 *   1  Business details   business information, social links, questions,
 *                         documents
 *   2  Checkout (instant) or Review (apply)
 *
 * Only a draft or a live hold is filled in here. Anything further along —
 * sent, booked, paid — lives in Account › Vendor bookings, so this page sends
 * the vendor there; a hold that ran out says so and offers the booth again.
 * Coming back from Stripe without paying lands on step 2: the details are
 * done and the terms are already signed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function BookingFlow({ appId, slug }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const api = useApi(`/partner/vendors/bookings/${appId}`);
  const [override, setOverride] = useState(null);
  const [step, setStep] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const [lapsed, setLapsed] = useState(false);
  const booking = override?.id === appId ? override : api.data;
  const { expired, remaining } = useCountdown(booking?.stage === 'held' ? booking.holdExpiresAt : null, { onExpire: () => setLapsed(true) });
  // Sent, booked or closed: that booking's own page in the account.
  const elsewhere = booking && !['draft', 'held', 'expired'].includes(booking.stage);
  useEffect(() => {
    if (elsewhere) router.replace(`/account/vendors/${appId}`);
  }, [elsewhere, appId, router]);

  if (api.error && !booking) return <div className="es-co-narrow"><ErrorNotice error={api.error} onRetry={api.reload} /></div>;
  if (!booking || elsewhere) return <div className="es-co-narrow"><Loading variant="card" label="Loading your booking" /></div>;
  if (booking.stage === 'expired') return <Released booking={booking} slug={slug} />;
  if (booking.stage === 'held' && (lapsed || expired || !booking.holdLive)) return <Released booking={booking} slug={slug} />;

  const instant = booking.mode === 'instant';
  const current = step ?? (booking.signed ? 'checkout' : 'details');
  const ev = booking.event;

  async function refresh(next) {
    if (next) { setOverride(next); return; }
    setOverride(await get(`/partner/vendors/bookings/${appId}`, { cache: 'no-store', noRedirect: true }));
  }

  async function release() {
    const ok = await confirm({
      title: instant ? 'Release this booth?' : 'Delete this application?',
      tone: 'danger',
      confirmLabel: instant ? 'Release booth' : 'Delete',
      body: <p>{instant ? 'Another vendor can book it straight away. Nothing has been charged.' : 'Your details and files for it are removed. Nothing was sent to the organizer.'}</p>,
    });
    if (!ok) return;
    setReleasing(true);
    try {
      await post(`/partner/vendors/bookings/${appId}/release`, {}, { noRedirect: true });
      router.push(`/e/${slug}/vendors`);
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
      setReleasing(false);
    }
  }

  return (
    <div className="es-co es-vb-flow">
      {booking.stage === 'held' && <HoldBar expired={expired} remaining={remaining} noun={NOUN} />}

      <nav aria-label="Breadcrumb" className="es-co__crumbs">
        <Link href="/events">Events</Link>
        <span aria-hidden>/</span>
        <Link href={`/e/${ev.slug}`} className="fx-truncate">{ev.title}</Link>
        <span aria-hidden>/</span>
        <Link href={`/e/${ev.slug}/vendors#booths`}>Booths</Link>
        <span aria-hidden>/</span>
        <span aria-current="page" className="es-co__crumbs-here">{current === 'details' ? 'Business details' : instant ? 'Checkout' : 'Review'}</span>
      </nav>
      <h1 className="es-co__title">{current === 'details' ? 'Your business' : instant ? 'Checkout' : 'Review and send'}</h1>

      <ol className="es-vb-steps es-vb-steps--flow" aria-label="Booking steps">
        <li>
          <button type="button" className="es-vb-steps__step" aria-current={current === 'details' ? 'step' : undefined}
            onClick={() => setStep('details')} disabled={booking.signed}>
            <span className="es-vb-steps__num" aria-hidden="true">{current === 'details' ? '1' : <NavIcon name="tick" size={14} />}</span>
            Business details
          </button>
        </li>
        <li>
          <button type="button" className="es-vb-steps__step" aria-current={current === 'checkout' ? 'step' : undefined}
            onClick={() => booking.missing.length === 0 && setStep('checkout')} disabled={booking.missing.length > 0}>
            <span className="es-vb-steps__num" aria-hidden="true">2</span>
            {instant ? 'Checkout' : 'Review & send'}
          </button>
        </li>
      </ol>

      {current === 'details' ? (
        <BusinessStep
          booking={booking}
          nextLabel={instant ? 'Continue to checkout' : 'Continue to review'}
          onBooking={(b) => refresh(b)}
          onSaved={(b) => {
            setOverride(b);
            if (b.missing.length === 0) { setStep('checkout'); window.scrollTo({ top: 0 }); }
            else toast.error(`Still needed: ${b.missing.join(', ')}.`, { title: 'Almost there' });
          }}
        />
      ) : (
        <CheckoutStep booking={booking} expired={expired} onBack={() => setStep('details')} onRelease={release} releasing={releasing} />
      )}
    </div>
  );
}

function Released({ booking, slug }) {
  return (
    <div className="es-co-narrow">
      <section className="es-vb-card es-vb-released" aria-labelledby="vb-released">
        <span className="es-vb-released__icon" aria-hidden="true"><NavIcon name="clock" size={32} /></span>
        <h1 id="vb-released" className="es-vb-card__title">Your booth was released</h1>
        <p className="es-vb-card__lede">
          It was held for you for a limited time, and that time ran out. Nothing was charged. If it is still free you can reserve it again —
          your business details are remembered.
        </p>
        <div className="fx-row gap-2">
          {booking.booth && <Link className="es-vb-btn es-vb-btn--sun" href={`/e/${slug}/vendors/booths/${booking.booth.id}`}>Choose it again</Link>}
          <Link className="es-vb-btn es-vb-btn--outline" href={`/e/${slug}/vendors`}>All booths</Link>
        </div>
      </section>
    </div>
  );
}
