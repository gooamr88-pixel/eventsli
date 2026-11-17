'use client';

import { useCallback } from 'react';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import { COUNTRY_NAMES } from '../../lib/markets';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A COMMISSION INVOICE, AS A DOCUMENT — on screen, printed, or saved as a PDF.
 *
 * Everything on it was frozen when the invoice was issued (20261123100000):
 * who issued it (Eventsli's details from Settings), who it is for (the
 * organizer's legal name, country and email), the sales it covers, the
 * commission, the tax on it, and anything carried over. Later edits to either
 * party never rewrite an invoice already sent.
 *
 * "Download PDF" is the browser's print dialog with "Save as PDF" — the same
 * approach the tickets use: every browser can do it, nothing is generated on
 * the server, and the PDF matches the page exactly.
 *
 * What this document is NOT: a receipt. "Paid" below means an Eventsli admin
 * RECORDED a payment, not that the bank has confirmed it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STATUS_LABEL = {
  open: 'Unpaid', submitted: 'Receipt under review', overdue: 'Overdue', paid: 'Paid',
  waived: 'Waived', void: 'Cancelled (void)',
};

export default function InvoiceDocument({ invoice, event, instructions = null, backHref = null }) {
  const money = (c) => formatMoney(c, invoice.currency);
  const tz = event?.timezone;
  const issuer = invoice.issuer || {};
  const recipient = invoice.recipient || {};
  const lines = invoice.lines;
  const partlyPaid = invoice.paidCents > 0 && invoice.balanceCents > 0;
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

      <article className="es-invdoc" aria-label={`Invoice ${invoice.number}`}>
        <header className="es-invdoc__head">
          <div>
            <p className="es-invdoc__title">Commission invoice</p>
            <p className="es-invdoc__number es-nums">{invoice.number}</p>
          </div>
          <p className="es-invdoc__status">{STATUS_LABEL[invoice.status] || invoice.status}</p>
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
            <p className="es-invdoc__label">Bill to</p>
            <p className="es-invdoc__strong">{recipient.legal_name || recipient.display_name || 'Organizer'}</p>
            {recipient.legal_name && recipient.display_name && recipient.display_name !== recipient.legal_name && (
              <p>Trading as {recipient.display_name}</p>
            )}
            {recipient.country && <p>{COUNTRY_NAMES[recipient.country] || recipient.country}</p>}
            {recipient.email && <p>{recipient.email}</p>}
          </div>
          <dl className="es-invdoc__meta">
            <div><dt>Issued</dt><dd>{formatEventTime(invoice.issuedAt, tz, { time: false })}</dd></div>
            <div><dt>Due</dt><dd>{invoice.dueAt ? formatEventTime(invoice.dueAt, tz) : '—'}</dd></div>
            <div><dt>Currency</dt><dd>{invoice.currency}</dd></div>
            {event?.title && <div><dt>Event</dt><dd>{event.title}</dd></div>}
            {invoice.coversTo && (
              <div>
                <dt>Sales period</dt>
                <dd>{invoice.coversFrom ? `${formatEventTime(invoice.coversFrom, tz, { time: false })} – ` : 'Up to '}{formatEventTime(invoice.coversTo, tz, { time: false })}</dd>
              </div>
            )}
          </dl>
        </section>

        <table className="es-invdoc__lines">
          <thead><tr><th scope="col">Description</th><th scope="col" className="es-invdoc__num">Amount</th></tr></thead>
          <tbody>
            {lines ? (
              <>
                <tr className="es-invdoc__info">
                  <td>Sales covered: {lines.salesCount} {lines.salesCount === 1 ? 'sale' : 'sales'} taken outside card checkout (door sales and payments made to you directly), {money(lines.salesGrossCents)} paid by buyers</td>
                  <td className="es-invdoc__num">—</td>
                </tr>
                <tr><td>Eventsli commission on those sales</td><td className="es-invdoc__num es-nums">{money(lines.commissionCents)}</td></tr>
                <tr><td>Tax on commission</td><td className="es-invdoc__num es-nums">{money(lines.commissionTaxCents)}</td></tr>
                {lines.adjustmentCents !== 0 && (
                  <tr>
                    <td>{lines.adjustmentCents < 0 ? 'Credit: commission on earlier sales that were voided or refunded' : 'Balance carried forward from earlier sales'}</td>
                    <td className="es-invdoc__num es-nums">{money(lines.adjustmentCents)}</td>
                  </tr>
                )}
              </>
            ) : (
              <tr>
                <td>Commission on {invoice.orderCount} {invoice.orderCount === 1 ? 'sale' : 'sales'} (issued before invoices were itemised)</td>
                <td className="es-invdoc__num es-nums">{money(invoice.amountCents)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="es-invdoc__total"><th scope="row">Total</th><td className="es-invdoc__num es-nums">{money(invoice.amountCents)}</td></tr>
            {invoice.paidCents > 0 && <tr><th scope="row">Payments recorded</th><td className="es-invdoc__num es-nums">−{money(invoice.paidCents)}</td></tr>}
            {invoice.writtenOffCents > 0 && <tr><th scope="row">Waived</th><td className="es-invdoc__num es-nums">−{money(invoice.writtenOffCents)}</td></tr>}
            <tr className="es-invdoc__total"><th scope="row">{invoice.status === 'void' ? 'Nothing due (cancelled)' : 'Balance due'}</th><td className="es-invdoc__num es-nums">{money(invoice.status === 'void' ? 0 : invoice.balanceCents)}</td></tr>
          </tfoot>
        </table>

        {invoice.status !== 'void' && invoice.balanceCents > 0 && (
          <section className="es-invdoc__pay">
            <p className="es-invdoc__label">How to pay</p>
            {instructions
              ? <p className="whitespace-pre-line">{instructions}</p>
              : <p>Payment details have not been published yet — contact Eventsli before paying.</p>}
            <p>Use <b className="es-nums">{invoice.number}</b> as the payment reference.{partlyPaid ? ' Part of this invoice has already been paid; pay the balance due.' : ''}</p>
          </section>
        )}

        <footer className="es-invdoc__foot">
          <p>
            Commission owed to Eventsli on ticket sales the organizer took outside card checkout. Card sales are not
            included — their commission was taken at the time of payment.
          </p>
          <p>&ldquo;Payments recorded&rdquo; are payments an Eventsli administrator has entered; this document is not a receipt.</p>
        </footer>
      </article>
    </div>
  );
}

/**
 * The page's print rules, mounted with it (the tickets do the same): only the
 * invoice prints, on white, without the buttons.
 */
function InvoicePrintStyles() {
  return (
    <style>{`
      .es-invdoc { background: #fff; color: #111018; border: 1px solid var(--es-border, #e5e5e5); border-radius: 12px; padding: clamp(1rem, 3vw, 2.5rem); display: flex; flex-direction: column; gap: 1.5rem; font-size: 0.9rem; line-height: 1.5; }
      .es-invdoc__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; border-bottom: 2px solid #111018; padding-bottom: 1rem; }
      .es-invdoc__title { font-family: var(--es-font-display); font-size: 1.5rem; font-weight: 800; margin: 0; }
      .es-invdoc__number { font-size: 1rem; margin: 0.25rem 0 0; }
      .es-invdoc__status { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.8rem; margin: 0; }
      .es-invdoc__parties { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1.25rem; }
      .es-invdoc__parties p { margin: 0; overflow-wrap: anywhere; }
      .es-invdoc .es-invdoc__label, .es-invdoc__parties .es-invdoc__label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #4a4a55; margin: 0 0 0.25rem; }
      .es-invdoc__strong { font-weight: 700; }
      .es-invdoc__meta { display: grid; gap: 0.25rem; margin: 0; }
      .es-invdoc__meta div { display: flex; justify-content: space-between; gap: 1rem; }
      .es-invdoc__meta dt { color: #4a4a55; }
      .es-invdoc__meta dd { margin: 0; text-align: right; }
      .es-invdoc__lines { width: 100%; border-collapse: collapse; }
      .es-invdoc__lines th, .es-invdoc__lines td { padding: 0.55rem 0.25rem; border-bottom: 1px solid #e5e5e5; text-align: left; vertical-align: top; }
      .es-invdoc__lines thead th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: #4a4a55; }
      .es-invdoc__lines .es-invdoc__num { text-align: right; white-space: nowrap; }
      .es-invdoc__info td { color: #4a4a55; }
      .es-invdoc__total th, .es-invdoc__total td { font-weight: 800; border-bottom: 2px solid #111018; }
      .es-invdoc__pay { border: 1px solid #e5e5e5; border-radius: 8px; padding: 1rem; }
      .es-invdoc__pay p, .es-invdoc__foot p { margin: 0 0 0.35rem; }
      .es-invdoc__foot { font-size: 0.75rem; color: #4a4a55; border-top: 1px solid #e5e5e5; padding-top: 0.75rem; }
      @media print {
        @page { margin: 14mm; }
        body * { visibility: hidden; }
        .es-invdoc, .es-invdoc * { visibility: visible; }
        .es-invdoc { position: absolute; inset-inline-start: 0; top: 0; width: 100%; border: 0; border-radius: 0; padding: 0; }
        .es-invdoc-wrap .es-invdoc__tools { display: none; }
        * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    `}</style>
  );
}
