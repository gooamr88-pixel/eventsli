import { useId } from 'react';

/**
 * An empty state with a picture: the art on the left, a rule, then a heading,
 * a sentence and (optionally) the one thing to do. Stacked and centred on a
 * phone. Used where a page's empty state is the organizer's FIRST look at the
 * section — Orders, Table categories — and a bare "Nothing here" box would be
 * a dead end.
 *
 * `art` is decorative and must be `aria-hidden`; the heading says it in words.
 */
/**
 * The same three parts stacked and centred — picture over heading over
 * sentence over action. For a section further down a page (Door sales,
 * Commission), where the side-by-side version would be a second hero.
 */
export function StackedEmpty({ art, title, children, action }) {
  const id = useId();
  return (
    <section className="es-dcard es-stack-empty" aria-labelledby={id}>
      <div className="es-stack-empty__art">{art}</div>
      <h2 id={id} className="es-stack-empty__title">{title}</h2>
      {children && <p className="es-stack-empty__text">{children}</p>}
      {action}
    </section>
  );
}

export default function SplitEmpty({ art, title, children, action }) {
  const id = useId();
  return (
    <section className="es-dcard es-split-empty" aria-labelledby={id}>
      <div className="es-split-empty__art">{art}</div>
      <div className="es-split-empty__text">
        <h2 id={id} className="es-split-empty__title">{title}</h2>
        {children && <p className="es-split-empty__lede">{children}</p>}
        {action}
      </div>
    </section>
  );
}
