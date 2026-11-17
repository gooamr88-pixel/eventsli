'use client';

import { useCallback } from 'react';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import { COUNTRY_NAMES } from '../../lib/markets';
import NavIcon from '../shell/NavIcon';
import { InvoicePrintStyles } from './InvoiceDocument';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A CREDIT NOTE, AS A DOCUMENT (20261123110000) — on screen, printed, or saved
 * as a PDF, the same way as the invoice it corrects.
 *
 * Issued by the database when a sale an invoice already covered is voided or
 * refunded. It is for the commission and the tax on it, and carries the same
 * issuer and recipient as that invoice — frozen, like the invoice.
 *
 * "How it was used" is every allocation, in order: taken off an invoice's
 * balance, a waiver reduced instead, released when an invoice was voided,
 * netted on a later invoice, or paid back to the organizer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CreditNoteDocument({ creditNote: n, event, invoiceNumber = null, backHref = null, admin = false }) {
  const money = (c) => formatMoney(c, n.currency);
  const tz = event?.timezone;
  const issuer = n.issuer || {};
  const recipient = n.recipient || {};
  const download = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }, []);

  return (
    <div className="es-invdoc-wrap fx-stack">
      <InvoicePrintStyles />
      <div className="es-invdoc__tools fx-row fx-row--between">
        {backHref ? <a href={backHref} className="es-btn es-btn--ghost es-btn--sm">← Back</a> : <span />}
        <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={download}>
          <NavIcon name="download" size={16} /> Download PDF
        </button>
      </div>
      <p className="es-invdoc__tools text-xs text-subtle">Download PDF opens your browser&rsquo;s print dialog — choose &ldquo;Save as PDF&rdquo;.</p>

      <article className="es-invdoc" aria-label={`Credit note ${n.number}`}>
        <header className="es-invdoc__head">
          <div>
            <p className="es-invdoc__title">Credit note</p>
            <p className="es-invdoc__number es-nums">{n.number}</p>
          </div>
          <p className="es-invdoc__status">{n.remainingCents > 0 ? 'Credit available' : 'Fully used'}</p>
        </header>

        <section className="es-invdoc__parties">
          <div>
            <p className="es-invdoc__label">From</p>
            <p className="es-invdoc__strong">{issuer.legal_name || 'Eventsli'}</p>
            {issuer.address && <p className="whitespace-pre-line">{issuer.address}</p>}
            {issuer.tax_id && <p>Business / tax no. {issuer.tax_id}</p>}
            {issuer.email && <p>{issuer.email}</p>}
          </div>
          <div>
            <p className="es-invdoc__label">To</p>
            <p className="es-invdoc__strong">{recipient.legal_name || recipient.display_name || 'Organizer'}</p>
            {recipient.billing_address
              ? <p className="whitespace-pre-line">{recipient.billing_address}</p>
              : recipient.country && <p>{COUNTRY_NAMES[recipient.country] || recipient.country}</p>}
            {recipient.tax_status === 'registered' && recipient.tax_id && <p>Tax no. {recipient.tax_id}</p>}
            {recipient.tax_status === 'not_registered' && <p>Not registered for tax</p>}
            {recipient.email && <p>{recipient.email}</p>}
          </div>
          <dl className="es-invdoc__meta">
            <div><dt>Issued</dt><dd>{formatEventTime(n.issuedAt, tz, { time: false })}</dd></div>
            <div><dt>Currency</dt><dd>{n.currency}</dd></div>
            {invoiceNumber && <div><dt>Corrects invoice</dt><dd className="es-nums">{invoiceNumber}</dd></div>}
            {event?.title && <div><dt>Event</dt><dd>{event.title}</dd></div>}
          </dl>
        </section>

        <table className="es-invdoc__lines">
          <thead><tr><th scope="col">Description</th><th scope="col" className="es-invdoc__num">Amount</th></tr></thead>
          <tbody>
            <tr className="es-invdoc__info">
              <td>One sale {n.kind === 'refund' ? 'refunded to the buyer' : 'voided (recorded in error)'} after its commission was invoiced{n.reason ? ` — ${n.reason}` : ''}</td>
              <td className="es-invdoc__num">—</td>
            </tr>
            <tr><td>Eventsli commission on that sale</td><td className="es-invdoc__num es-nums">−{money(n.commissionCents)}</td></tr>
            <tr><td>Tax on that commission</td><td className="es-invdoc__num es-nums">−{money(n.commissionTaxCents)}</td></tr>
          </tbody>
          <tfoot>
            <tr className="es-invdoc__total"><th scope="row">Total credited</th><td className="es-invdoc__num es-nums">−{money(n.amountCents)}</td></tr>
          </tfoot>
        </table>

        <section>
          <p className="es-invdoc__label">How it was used</p>
          <table className="es-invdoc__lines">
            <tbody>
              {n.allocations.map((a, i) => (
                <tr key={`${a.at}-${i}`}>
                  <td>
                    {formatEventTime(a.at, tz, { time: false })} · {describe(a, admin)}
                  </td>
                  <td className="es-invdoc__num es-nums">{a.kind === 'released' ? '+' : '−'}{money(a.amountCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="es-invdoc__total">
                <th scope="row">{n.remainingCents > 0 ? 'Credit still available' : 'Nothing left on this credit note'}</th>
                <td className="es-invdoc__num es-nums">{money(n.remainingCents)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <footer className="es-invdoc__foot">
          <p>
            A credit still available comes off the next commission invoice for this event, or Eventsli pays it back.
            It is never both.
          </p>
        </footer>
      </article>
    </div>
  );
}

function describe(a, admin) {
  const inv = a.invoiceNumber ? `invoice ${a.invoiceNumber}` : 'an invoice';
  if (a.kind === 'applied') return a.fromWriteOff ? `Reduced the amount waived on ${inv}` : `Taken off the balance of ${inv}`;
  if (a.kind === 'released') return `Given back: ${inv} was voided`;
  if (a.kind === 'netted') return `Deducted on ${inv}`;
  return `Paid back to the organizer${a.method ? ` by ${a.method}` : ''}${admin && a.reference ? ` (ref. ${a.reference})` : ''}`;
}
