import { formatMoney } from '../../../utils/money';

/**
 * Every amount an organizer bears on one event, read-only (BRD §04–§06, §21).
 *
 * One component because the same list is shown in two places that must never
 * disagree: beside the terms an organizer is about to accept, and on the
 * overview of an event that is already on sale. It used to be written out in
 * the overview only — two screens away from the button that agreed to it.
 */
export default function FeeSummary({ event, compact = false }) {
  const fees = event.fees || {};
  const rows = [
    {
      term: 'Eventsli commission',
      value: `${fees.commissionPct}%`,
      note: compact ? null : 'Of the ticket price. Always borne by you.',
    },
    ...(fees.commissionTaxPct > 0 ? [{ term: 'Tax on commission', value: `${fees.commissionTaxPct}%` }] : []),
    {
      term: 'Payment fee',
      value: fees.paymentFeeMode === 'auto'
        ? 'Matched to the card cost'
        : `${fees.paymentFeePct}% + ${formatMoney(fees.paymentFeeFixedCents, event.currency)}`,
      note: fees.feeBearer === 'buyer' ? 'Added to the buyer’s total.' : 'Taken from your proceeds.',
    },
    ...(fees.eventTaxPct > 0 ? [{
      term: 'Event tax',
      value: `${fees.eventTaxPct}%`,
      note: compact ? null : 'Added to the buyer’s total. You remit it.',
    }] : []),
  ];

  return (
    <dl className="es-deflist">
      {rows.map((row) => (
        <div key={row.term} className="es-deflist__row">
          <dt className="fx-min0">
            <span className="block text-ink">{row.term}</span>
            {row.note && <span className="block text-xs text-subtle">{row.note}</span>}
          </dt>
          <dd className="es-nums text-right text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
