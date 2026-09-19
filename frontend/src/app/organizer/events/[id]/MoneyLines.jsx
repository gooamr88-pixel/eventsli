'use client';

import { formatMoney } from '../../../utils/money';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A TICKET DOES TO THE MONEY, one ticket type at a time.
 *
 * THE TWO NUMBERS THE ORGANIZER IS ACTUALLY ASKING FOR are "what does the buyer
 * pay" and "what do I get", and they are the two in bold. Everything between
 * them is the arithmetic that connects the two, in the order it happens, so the
 * gap is explained rather than asserted.
 *
 * NOTHING HERE IS CALCULATED. Every cents figure arrives from the preview
 * endpoint, which ran the same function that prices a real sale. This file
 * chooses which rows to show and formats them — it never adds two of them
 * together, because the moment it does, the screen and the charge can differ.
 *
 * ROWS WORTH NOTHING ARE LEFT OUT. A "Tax $0.00" line on an event with no tax
 * is a line an organizer has to read and dismiss; the fee summary below still
 * states every rate, including the ones at zero, so nothing is hidden.
 *
 * STRIPE IS SHOWN AS A COST INSIDE THE PAYMENT FEE, not as a separate deduction
 * — because it is. The payment fee is what is charged; Stripe's cut is what it
 * covers. Listing them as two subtractions would double-count and make the
 * bottom line wrong by exactly the card cost.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function MoneyLines({ lines, fees, currency, isFree, listingOnly }) {
  if (listingOnly) {
    return (
      <p className="text-sm text-muted">
        This event is listed for information only. Nothing is sold through Eventsli, so no fee
        applies to it.
      </p>
    );
  }

  if (!lines || lines.length === 0) {
    return (
      <p className="text-sm text-danger">
        This event has no ticket types yet. Add at least one before submitting — Eventsli has
        nothing to review otherwise.
      </p>
    );
  }

  const buyerPaysFee = fees.feeBearer === 'buyer';

  return (
    <div className="fx-stack fx-stack--sm">
      {lines.map((line) => (
        <div key={`${line.kind}-${line.label}-${line.faceCents}`} className="es-money">
          <div className="es-money__head">
            <span className="fx-min0 text-ink">{line.label}</span>
            <span className="es-nums text-ink">
              {line.isFree ? 'Free' : formatMoney(line.faceCents, currency)}
            </span>
          </div>
          {line.detail && <p className="es-money__detail">{line.detail}</p>}

          {line.isFree ? (
            <p className="es-money__detail">
              Free tickets carry no commission and no payment fee. You receive nothing and are
              charged nothing.
            </p>
          ) : (
            <dl className="es-money__rows">
              <Row term="Ticket price" cents={line.faceCents} currency={currency} />
              {line.eventTaxCents > 0 && (
                <Row term={`Event tax (${fees.eventTaxPct}%)`} cents={line.eventTaxCents} currency={currency}
                  note="Added to the buyer’s total. You remit it." />
              )}
              {buyerPaysFee && line.paymentFeeCents > 0 && (
                <Row term="Service fee" cents={line.paymentFeeCents} currency={currency}
                  note="Added to the buyer’s total, because you chose buyer-paid fees." />
              )}
              <Row term="The buyer pays" cents={line.buyerTotalCents} currency={currency} strong />

              <Row term={`Eventsli commission (${fees.commissionPct}%)`} cents={-line.commissionCents} currency={currency} />
              {line.commissionTaxCents > 0 && (
                <Row term={`Tax on commission (${fees.commissionTaxPct}%)`} cents={-line.commissionTaxCents} currency={currency}
                  note="Collected with the commission. Eventsli remits it." />
              )}
              {!buyerPaysFee && line.paymentFeeCents > 0 && (
                <Row term="Payment processing fee" cents={-line.paymentFeeCents} currency={currency}
                  note="Taken from your proceeds, because you chose to absorb it." />
              )}
              <Row
                term="You receive"
                cents={line.organizerNetCents}
                currency={currency}
                strong
                note={`Of the ${formatMoney(line.platformTakeCents, currency)} deducted, `
                  + `${formatMoney(line.stripeCostCents, currency)} is what the card network and Stripe charge.`}
              />
            </dl>
          )}
        </div>
      ))}

      <p className="text-xs text-subtle">
        Figures are for an order of one ticket. The fixed part of the payment fee is charged once
        per order, not per ticket, so a larger order costs proportionally less.
      </p>

      <dl className="es-deflist">
        <div className="es-deflist__row">
          <dt className="fx-min0">
            <span className="block text-ink">Eventsli commission</span>
            <span className="block text-xs text-subtle">Of the ticket price. Always borne by you.</span>
          </dt>
          <dd className="es-nums text-right text-ink">{fees.commissionPct}%</dd>
        </div>
        <div className="es-deflist__row">
          <dt className="fx-min0">
            <span className="block text-ink">Tax on commission</span>
            <span className="block text-xs text-subtle">On Eventsli&rsquo;s commission, not on your ticket.</span>
          </dt>
          <dd className="es-nums text-right text-ink">{fees.commissionTaxPct}%</dd>
        </div>
        <div className="es-deflist__row">
          <dt className="fx-min0">
            <span className="block text-ink">Payment fee</span>
            <span className="block text-xs text-subtle">
              {buyerPaysFee ? 'Added to the buyer’s total.' : 'Taken from your proceeds.'}
            </span>
          </dt>
          <dd className="es-nums text-right text-ink">
            {fees.paymentFeeMode === 'auto'
              ? 'Matched to the card cost'
              : `${fees.paymentFeePct}% + ${formatMoney(fees.paymentFeeFixedCents, currency)}`}
          </dd>
        </div>
        <div className="es-deflist__row">
          <dt className="fx-min0">
            <span className="block text-ink">Card cost (Stripe)</span>
            <span className="block text-xs text-subtle">
              What Stripe bills on each charge. The payment fee above is what covers it.
            </span>
          </dt>
          <dd className="es-nums text-right text-ink">
            {fees.stripe.pct}% + {formatMoney(fees.stripe.fixedCents, currency)}
          </dd>
        </div>
        <div className="es-deflist__row">
          <dt className="fx-min0">
            <span className="block text-ink">Event tax</span>
            <span className="block text-xs text-subtle">Added to the buyer&rsquo;s total. You remit it.</span>
          </dt>
          <dd className="es-nums text-right text-ink">{fees.eventTaxPct}%</dd>
        </div>
      </dl>

      {isFree && (
        <p className="text-xs text-subtle">
          Every ticket on this event is free, so no fee of any kind is charged on it.
        </p>
      )}
    </div>
  );
}

/**
 * One line of the breakdown. A negative amount is a deduction and is written as
 * one — "−$4.00" — rather than as a positive number the reader has to know to
 * subtract.
 */
function Row({ term, cents, currency, note, strong = false }) {
  const negative = cents < 0;
  return (
    <div className="es-money__row" data-strong={strong || undefined}>
      <dt className="fx-min0">
        <span className="block">{term}</span>
        {note && <span className="block text-xs text-subtle">{note}</span>}
      </dt>
      <dd className="es-nums shrink-0 text-right">
        {negative ? `−${formatMoney(-cents, currency)}` : formatMoney(cents, currency)}
      </dd>
    </div>
  );
}
