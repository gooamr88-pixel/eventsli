'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { get, post } from '../../../utils/apiClient';
import { describeError } from '../../../utils/errors';
import { formatMoney } from '../../../utils/money';
import { formatEventTime } from '../../../lib/eventTime';
import { useNowMinute } from '../../../hooks/useNowMinute';
import { useConfirm } from '../../../components/ui/Confirm';
import NavIcon from '../../../components/shell/NavIcon';
import { Loading, Notice } from '../../../components/Feedback';
import ReceiptUpload from './ReceiptUpload';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PAY THE ORGANIZER (phase 2) — the page the buyer lands on after reserving,
 * and the one the email links back to.
 *
 * Laid out as three numbered steps (owner, 2026-11-24: "make this page very
 * professional", and the payment method "red and bold so they can see it
 * clearly"): 1 send the amount by the organizer's method — its name in red —
 * to the details shown; 2 put the reference in the payment note; 3 upload the
 * receipt. Above them, how long the seats are held, counting down; below, what
 * happens next and the way out.
 *
 * The instructions are the organizer's own, as they were when the buyer
 * reserved. Refreshed every 30 seconds while unpaid, so the moment the
 * organizer marks it paid the page says so and links to the tickets.
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
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

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

  // The buyer's last step (owner, 2026-11-24: "at the end put a confirm … that
  // ends the payment and booking process"). Asks once if there is no receipt.
  async function markSent() {
    if (!payment.proof) {
      const ok = await confirm({
        title: 'Finish without a receipt?',
        body: <p>A photo or screenshot of your transfer helps the organizer confirm faster. You can still add one after this.</p>,
        confirmLabel: 'Yes, I’ve sent it',
        cancelLabel: 'Go back',
      });
      if (!ok) return;
    }
    setSending(true);
    setSendError(null);
    try {
      setPayment(await post(`/public/offline-payments/${id}/sent?token=${encodeURIComponent(token)}`, undefined, { noRedirect: true }));
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSendError(describeError(err).title || 'That did not go through. Try again.');
    } finally {
      setSending(false);
    }
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
  const org = payment.organizer?.name || 'the organizer';
  const method = payment.method?.label || 'the organizer’s method';

  return (
    <div className="es-op">
      <nav aria-label="Breadcrumb" className="es-co__crumbs">
        <Link href="/events">Events</Link>
        <span aria-hidden>/</span>
        {ev.slug && <Link href={`/e/${ev.slug}`} className="fx-truncate">{ev.title}</Link>}
      </nav>

      {payment.status === 'awaiting' && !payment.sentAt && (
        <>
          <header className="es-op__head">
            <p className="es-op__status"><span className="es-op__pulse" aria-hidden="true" /> Awaiting your payment</p>
            <h1 className="es-op__title">Pay {org} to get your tickets</h1>
            <p className="es-op__lede">
              Your tickets are reserved. They are issued as soon as {org} confirms your payment — this page updates by itself.
            </p>
          </header>

          <Deadline dueAt={payment.dueAt} timezone={tz} />

          <EventSummary ev={ev} amount={amount} timezone={tz} />

          <ol className="es-op__steps" aria-label="How to pay">
            <li className="es-op__step">
              <span className="es-op__num" aria-hidden="true">1</span>
              <section className="es-op__card es-op__card--method" aria-labelledby="op-method">
                <p className="es-op__eyebrow">Send <b className="es-nums">{amount}</b> with</p>
                <h2 id="op-method" className="es-op__method">{method}</h2>
                {payment.method?.instructions && (
                  <div className="es-op__sendto">
                    <div className="es-op__sendto-head">
                      <span className="es-op__label">Send to</span>
                      <CopyButton text={payment.method.instructions} label="Copy details" />
                    </div>
                    <p className="es-op__sendto-text">{payment.method.instructions}</p>
                  </div>
                )}
                <p className="es-op__hint"><NavIcon name="info" size={16} /> Send the exact amount, {amount}, so it matches your reservation.</p>
              </section>
            </li>

            <li className="es-op__step">
              <span className="es-op__num" aria-hidden="true">2</span>
              <section className="es-op__card" aria-labelledby="op-ref">
                <h2 id="op-ref" className="es-op__h2">Add your reference to the payment note</h2>
                <div className="es-op__ref">
                  <b className="es-op__ref-code es-nums">{payment.reference}</b>
                  <CopyButton text={payment.reference} label="Copy" />
                </div>
                <p className="es-op__hint">This is how {org} matches your payment to your tickets.</p>
              </section>
            </li>

            <li className="es-op__step">
              <span className={`es-op__num${payment.proof ? ' es-op__num--done' : ''}`} aria-hidden="true">
                {payment.proof ? <NavIcon name="check" size={16} /> : '3'}
              </span>
              <ReceiptUpload id={id} token={token} proof={payment.proof} timezone={tz} onUploaded={setPayment} className="es-op__card" />
            </li>
          </ol>

          <section className="es-op__finish" aria-labelledby="op-finish">
            <h2 id="op-finish" className="es-op__h2">Sent the payment?</h2>
            <p>Press this once you have sent <b className="es-nums">{amount}</b>. {org} is told to check, and your tickets are emailed as soon as they confirm.</p>
            <button type="button" className="es-btn es-btn--primary es-op__finish-btn" disabled={sending} onClick={markSent}>
              <NavIcon name="check" size={20} /> {sending ? 'Sending…' : 'I’ve sent the payment'}
            </button>
            {sendError && <p role="alert" className="es-op__error">{sendError}</p>}
          </section>

          <section className="es-op__next" aria-labelledby="op-next">
            <h2 id="op-next" className="es-op__h3">What happens next</h2>
            <ul>
              <li><NavIcon name="check" size={16} /> {org} checks the payment and confirms it.</li>
              <li><NavIcon name="mail" size={16} /> Your tickets are emailed to you, and appear on this page.</li>
              <li><NavIcon name="clock" size={16} /> Not confirmed by {formatEventTime(payment.dueAt, tz)}? The reservation ends and the seats go back on sale.</li>
            </ul>
            <p className="es-op__trust"><NavIcon name="shield" size={16} /> Eventsli never takes this payment — it goes straight to {org}.</p>
          </section>

          <div className="es-op__foot">
            <button type="button" className="es-op__cancel" disabled={busy} onClick={cancel}>
              {busy ? 'Cancelling…' : 'Cancel my reservation'}
            </button>
          </div>
        </>
      )}

      {payment.status === 'awaiting' && payment.sentAt && (
        <>
          <section className="es-op__result es-op__result--ok" aria-labelledby="op-result">
            <span className="es-op__result-icon" aria-hidden="true"><NavIcon name="check" size={28} /></span>
            <p className="es-op__status"><span className="es-op__pulse" aria-hidden="true" /> Waiting for {org} to confirm</p>
            <h1 id="op-result" className="es-op__title">Payment sent — you’re all set</h1>
            <p className="es-op__lede">
              {org} has been told to check for your payment of <b className="es-nums">{amount}</b>. Your tickets are emailed as soon as they confirm — this page updates by itself.
            </p>
            <dl className="es-op__recap">
              <div><dt>Paid with</dt><dd className="es-op__recap-method">{method}</dd></div>
              <div><dt>Reference</dt><dd className="es-nums">{payment.reference}</dd></div>
              <div><dt>Sent</dt><dd>{formatEventTime(payment.sentAt, tz)}</dd></div>
            </dl>
            <EventSummary ev={ev} amount={amount} timezone={tz} />
            <Link href="/events" className="es-btn es-btn--secondary">Browse more events</Link>
          </section>

          {!payment.proof && (
            <ReceiptUpload id={id} token={token} proof={payment.proof} timezone={tz} onUploaded={setPayment} className="es-op__card" />
          )}

          <p className="es-op__note"><NavIcon name="clock" size={16} /> Not confirmed by {formatEventTime(payment.dueAt, tz)}? The reservation ends and the seats go back on sale. Eventsli never takes this payment.</p>

          <div className="es-op__foot">
            <button type="button" className="es-op__cancel" disabled={busy} onClick={cancel}>
              {busy ? 'Cancelling…' : 'Cancel my reservation'}
            </button>
          </div>
        </>
      )}

      {payment.status === 'paid' && (
        <section className="es-op__result es-op__result--ok" aria-labelledby="op-result">
          <span className="es-op__result-icon" aria-hidden="true"><NavIcon name="check" size={28} /></span>
          <h1 id="op-result" className="es-op__title">Payment confirmed — your tickets are ready.</h1>
          <p className="es-op__lede">{org} confirmed {amount}. Your tickets were emailed to you.</p>
          {payment.orderToken && (
            <Link className="es-btn es-btn--primary" href={`/t/${encodeURIComponent(payment.orderToken)}`}>
              <NavIcon name="ticket" size={18} /> Open my tickets
            </Link>
          )}
          <EventSummary ev={ev} amount={amount} timezone={tz} />
        </section>
      )}

      {['expired', 'cancelled', 'voided', 'refunded'].includes(payment.status) && (
        <section className="es-op__result" aria-labelledby="op-result">
          <span className="es-op__result-icon" aria-hidden="true"><NavIcon name="ban" size={26} /></span>
          <h1 id="op-result" className="es-op__title">{{
            expired: 'This reservation expired before the payment was confirmed.',
            cancelled: 'This reservation was cancelled.',
            voided: 'This order was voided by the organizer.',
            refunded: 'This order was refunded by the organizer.',
          }[payment.status]}</h1>
          <p className="es-op__lede">
            {payment.status === 'expired' || payment.status === 'cancelled'
              ? 'The seats went back on sale. If you already sent a payment, contact the organizer to get it back.'
              : 'Its tickets no longer work at the door.'}
          </p>
          {ev.slug && <Link href={`/e/${ev.slug}`} className="es-btn es-btn--secondary">Back to the event</Link>}
        </section>
      )}
    </div>
  );
}

/** How long the seats are held: the deadline, and the time left to the minute. */
function Deadline({ dueAt, timezone }) {
  const now = useNowMinute();
  const left = now == null || !dueAt ? null : new Date(dueAt).getTime() - now;
  const urgent = left != null && left < 60 * 60_000;
  return (
    <div className={`es-op__deadline${urgent ? ' es-op__deadline--urgent' : ''}`}>
      <NavIcon name="clock" size={20} />
      <p>Reserved until <b>{formatEventTime(dueAt, timezone)}</b></p>
      {left != null && <span className="es-op__left" role="timer">{timeLeft(left)}</span>}
    </div>
  );
}

/** "1 day 4 h left", "3 h 12 min left", "12 min left", "Time is up". */
export function timeLeft(ms) {
  if (ms <= 0) return 'Time is up';
  const mins = Math.max(1, Math.floor(ms / 60_000));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days) return `${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours} h` : ''} left`;
  if (hours) return `${hours} h${m ? ` ${m} min` : ''} left`;
  return `${m} min left`;
}

/** The event this reservation is for, and its total. */
function EventSummary({ ev, amount, timezone }) {
  if (!ev.title) return null;
  const details = [ev.startsAt ? formatEventTime(ev.startsAt, timezone) : null, ev.venueName].filter(Boolean);
  return (
    <section className="es-op__summary" aria-label="Your reservation">
      <span className="es-op__summary-icon" aria-hidden="true"><NavIcon name="ticket" size={20} /></span>
      <div className="es-op__summary-body">
        <p className="es-op__summary-title">{ev.title}</p>
        {details.length > 0 && <p className="es-op__summary-meta">{details.join(' · ')}</p>}
      </div>
      <div className="es-op__summary-total">
        <span className="es-op__label">Total</span>
        <b className="es-nums">{amount}</b>
      </div>
    </section>
  );
}

/** Copies `text`; says "Copied" for two seconds. On failure the text is on screen to copy by hand. */
function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch { /* shown on screen to copy by hand */ }
  }
  return (
    <button type="button" className="es-op__copy" onClick={copy} data-copied={copied ? 'true' : undefined}>
      <NavIcon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : label}
    </button>
  );
}
