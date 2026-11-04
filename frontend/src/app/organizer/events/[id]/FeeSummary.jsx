import { formatMoney } from '../../../utils/money';
import NavIcon from '../../../components/shell/NavIcon';

/**
 * Every amount an organizer bears on one event, read-only (BRD §04–§06, §21).
 *
 * One component because the same list is shown in two places that must never
 * disagree: beside the terms an organizer is about to accept, and on the
 * overview of an event that is already on sale. It used to be written out in
 * the overview only — two screens away from the button that agreed to it.
 *
 * `rich` is the Event details card: the same rows, each with an icon and its
 * value as a pill. Same list, same numbers — only the drawing differs.
 */
export default function FeeSummary({ event, compact = false, rich = false }) {
  const fees = event.fees || {};
  const rows = [
    {
      term: 'Eventsli commission',
      icon: 'percent',
      value: `${fees.commissionPct}%`,
      note: compact ? null : 'Of the ticket price. Always borne by you.',
    },
    ...(fees.commissionTaxPct > 0 ? [{ term: 'Tax on commission', icon: 'receipt', value: `${fees.commissionTaxPct}%` }] : []),
    {
      term: 'Payment fee',
      icon: 'card',
      value: fees.paymentFeeMode === 'auto'
        ? 'Matched to the card cost'
        : `${fees.paymentFeePct}% + ${formatMoney(fees.paymentFeeFixedCents, event.currency)}`,
      note: fees.feeBearer === 'buyer' ? 'Added to the buyer’s total.' : 'Taken from your proceeds.',
    },
    ...(fees.eventTaxPct > 0 ? [{
      term: 'Event tax',
      icon: 'receipt',
      value: `${fees.eventTaxPct}%`,
      note: compact ? null : 'Added to the buyer’s total. You remit it.',
    }] : []),
  ];

  if (rich) {
    return (
      <dl className="es-charges">
        {rows.map((row) => (
          <div key={row.term} className="es-charges__row">
            <span className="es-charges__icon" aria-hidden="true"><NavIcon name={row.icon} size={20} /></span>
            <dt className="fx-min0">
              <span className="block font-semibold text-ink">{row.term}</span>
              {row.note && <span className="block text-xs text-muted">{row.note}</span>}
            </dt>
            <dd className="es-charges__value">{row.value}</dd>
          </div>
        ))}
      </dl>
    );
  }

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
