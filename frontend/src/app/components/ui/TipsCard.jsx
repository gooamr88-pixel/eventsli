import { useId } from 'react';
import NavIcon from '../shell/NavIcon';

/**
 * A soft card of short "good to know" points, each with an icon tile — the
 * side column beside an empty list on My tickets and Orders.
 *
 * Statements, not links or steps: nothing here is clickable and the order
 * claims nothing, so it is a plain list.
 *
 * `EmptyWithTips` is the pairing those pages use: the empty state on the left,
 * this beside it from lg, stacked beneath it below that.
 */
export function TipsCard({ icon = 'info', title, tips }) {
  const id = useId();
  return (
    <section className="es-tipscard" aria-labelledby={id}>
      <h2 id={id} className="es-tipscard__title">
        <span className="es-icontile" aria-hidden="true"><NavIcon name={icon} size={24} /></span>
        {title}
      </h2>
      <ul className="es-tipscard__list">
        {tips.map((tip) => (
          <li key={tip.key}>
            <span className="es-icontile" aria-hidden="true"><NavIcon name={tip.icon} size={24} /></span>
            <span className="fx-min0">
              <b>{tip.title}</b>
              <span className="es-tipscard__text">{tip.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EmptyWithTips({ empty, tips }) {
  return <div className="es-empty-tips">{empty}{tips}</div>;
}
