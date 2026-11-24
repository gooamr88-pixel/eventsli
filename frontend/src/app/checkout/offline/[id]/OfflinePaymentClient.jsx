'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { get, post } from '../../../utils/apiClient';
import { describeError } from '../../../utils/errors';
import { formatMoney } from '../../../utils/money';
import { formatEventTime } from '../../../lib/eventTime';
import { useConfirm } from '../../../components/ui/Confirm';
import NavIcon from '../../../components/shell/NavIcon';
import { Loading, Notice } from '../../../components/Feedback';
import ReceiptUpload from './ReceiptUpload';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PAY THE ORGANIZER (phase 2) — the page the buyer lands on after reserving,
 * and the one the email links back to.
 *
 * Everything needed to pay, in the order it is needed: how much, how (the
 * organizer's own instructions, as they were when the buyer reserved), the
 * reference to quote, and the deadline after which the seats go back on sale.
 * Refreshed every 30 seconds while unpaid, so the moment the organizer marks
 * it paid the page says so and links to the tickets.
 *
 * Keyed by the token in the URL; without it the reservation is "not found".
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OfflinePaymentClient({ id }) {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const confirm = useConfirm();
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await get(`/public/offline-payments/${id}?token=${encodeURIComponent(token)}`, { cache: 'no-store', noRedirect: true });
      setPayment(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id, token]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const tick = async () => {
      try {
        const data = await get(`/public/offline-payments/${id}?token=${encodeURIComponent(token)}`, { cache: 'no-store', noRedirect: true });
        if (cancelled) return;
        setPayment(data);
        setError(null);
        if (data.status === 'awaiting') timer = setTimeout(tick, 30000);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [id, token]);

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(payment.reference);
      setCopied(true);
    } catch { /* the reference is on screen to copy by hand */ }
  }

  async function cancel() {
    const ok = await confirm({
      title: 'Cancel your reservation?',
      tone: 'danger',
      body: <p>Your tickets are released for someone else. If you already sent the payment, contact the organizer to get it back.</p>,
      confirmLabel: 'Cancel reservation',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await post(`/public/offline-payments/${id}/cancel?token=${encodeURIComponent(token)}`, undefined, { noRedirect: true });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (error && !payment) {
    return (
      <Notice tone="danger" title="We could not find that reservation.">
        <p>{describeError(error).recovery || 'Open the link from your email again.'}</p>
      </Notice>
    );
  }
  if (!payment) return <Loading variant="card" label="Loading your reservation" />;

  const ev = payment.event || {};
  const tz = ev.timezone;
  const amount = formatMoney(payment.amountCents, payment.currency);

  return (
    <div className="fx-stack">
      <nav aria-label="Breadcrumb" className="es-co__crumbs">
        <Link href="/events">Events</Link>
        <span aria-hidden>/</span>
        {ev.slug && <Link href={`/e/${ev.slug}`} className="fx-truncate">{ev.title}</Link>}
      </nav>

      {payment.status === 'awaiting' && (
        <>
          <h1 className="es-co__title">Pay {payment.organizer?.name || 'the organizer'} to get your tickets</h1>
          <p className="text-muted">
            Your tickets are reserved until <b className="text-ink">{formatEventTime(payment.dueAt, tz)}</b>.
            {' '}They are issued as soon as the organizer confirms your payment — this page updates by itself.
          </p>

          <section className="es-co__card" aria-labelledby="pay-amount">
            <h2 id="pay-amount" className="es-co__h2">Amount to pay</h2>
            <p className="es-nums text-2xl font-medium text-ink">{amount}</p>

            <h2 className="es-co__h2 mt-4">Your reference</h2>
            <p className="fx-row items-center gap-2">
              <b className="es-nums text-xl tracking-wider text-ink">{payment.reference}</b>
              <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={copyReference}>
                <NavIcon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </p>
            <p className="text-sm text-subtle">Put this in the payment note so the organizer can match your payment.</p>

            <h2 className="es-co__h2 mt-4">How to pay — {payment.method?.label}</h2>
            <p className="fx-break whitespace-pre-line text-ink">{payment.method?.instructions}</p>
          </section>

          {/* Proof of payment (2026-11-24): the transfer receipt, to the organizer. */}
          <ReceiptUpload id={id} token={token} proof={payment.proof} timezone={tz} onUploaded={setPayment} />

          <Notice tone="warning" title="Pay before the deadline.">
            <p>
              If the payment is not confirmed by {formatEventTime(payment.dueAt, tz)}, the reservation ends and the seats go back on sale.
              Eventsli never takes this payment — it goes straight to the organizer.
            </p>
          </Notice>

          <div>
            <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy} onClick={cancel}>
              {busy ? 'Cancelling…' : 'Cancel my reservation'}
            </button>
          </div>
        </>
      )}

      {payment.status === 'paid' && (
        <Notice tone="info" title="Payment confirmed — your tickets are ready.">
          <p>The organizer confirmed {amount}. Your tickets were emailed to you.</p>
          {payment.orderToken && (
            <p className="mt-2"><Link className="es-btn es-btn--primary es-btn--sm" href={`/t/${encodeURIComponent(payment.orderToken)}`}>Open my tickets</Link></p>
          )}
        </Notice>
      )}

      {['expired', 'cancelled', 'voided', 'refunded'].includes(payment.status) && (
        <Notice tone="neutral" title={{
          expired: 'This reservation expired before the payment was confirmed.',
          cancelled: 'This reservation was cancelled.',
          voided: 'This order was voided by the organizer.',
          refunded: 'This order was refunded by the organizer.',
        }[payment.status]}
        >
          <p>
            {payment.status === 'expired' || payment.status === 'cancelled'
              ? 'The seats went back on sale. If you already sent a payment, contact the organizer to get it back.'
              : 'Its tickets no longer work at the door.'}
          </p>
          {ev.slug && <p className="mt-2"><Link href={`/e/${ev.slug}`} className="text-accent underline">Back to the event</Link></p>}
        </Notice>
      )}

      {ev.title && (
        <p className="text-sm text-subtle">
          {ev.title}{ev.startsAt ? ` · ${formatEventTime(ev.startsAt, tz)}` : ''}{ev.venueName ? ` · ${ev.venueName}` : ''}
        </p>
      )}
    </div>
  );
}
