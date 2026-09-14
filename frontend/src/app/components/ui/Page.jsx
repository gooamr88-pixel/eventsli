import Link from 'next/link';
import NavIcon from '../shell/NavIcon';

/**
 * The top of every dashboard and console page, and the number cards under it.
 * Server components: no state.
 */

export function PageHeader({ eyebrow, title, lede, actions }) {
  return (
    <header className="es-page-head">
      <div className="fx-stack fx-stack--sm fx-min0">
        {eyebrow && <p className="es-eyebrow">{eyebrow}</p>}
        <h1 className="es-page-head__title fx-break">{title}</h1>
        {lede && <p className="es-page-head__lede">{lede}</p>}
      </div>
      {actions && <div className="fx-row">{actions}</div>}
    </header>
  );
}

/**
 * A section inside a page that already has its <h1> — every page under one
 * event, where the event's title is the h1 in the event layout. Same shape as
 * PageHeader, one heading level down.
 */
export function SectionHeader({ title, lede, actions }) {
  return (
    <div className="es-page-head">
      <div className="fx-stack fx-stack--sm gap-1 fx-min0">
        <h2 className="fx-break text-xl text-ink">{title}</h2>
        {lede && <p className="es-page-head__lede">{lede}</p>}
      </div>
      {actions && <div className="fx-row">{actions}</div>}
    </div>
  );
}

/**
 * One number. `value` arrives formatted — only the caller knows the currency.
 * With `href` the whole card is the link to where that number comes from.
 */
export function StatCard({ label, value, note, icon, href }) {
  const body = (
    <>
      <span className="es-stat__head">
        <span className="es-stat__label">{label}</span>
        {icon && <span className="es-stat__icon"><NavIcon name={icon} size={16} /></span>}
      </span>
      <span className="es-stat__value">{value}</span>
      {note && <span className="es-stat__note">{note}</span>}
    </>
  );

  if (href) {
    return <Link href={href} className="es-stat es-stat--link">{body}</Link>;
  }
  return <div className="es-stat">{body}</div>;
}

/** A titled card section. */
export function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`es-card fx-stack fx-stack--sm p-5 ${className}`}>
      {(title || action) && (
        <div className="fx-row fx-row--between">
          {title && <h2 className="text-lg text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
