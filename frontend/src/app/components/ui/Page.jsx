import Link from 'next/link';
import NavIcon from '../shell/NavIcon';

/**
 * The top of every dashboard and console page, the number cards under it, and
 * the titled card every section sits in. Server components: no state.
 *
 * ONE header shape for both products. The organizer dashboard and the admin
 * console used to agree on the component and disagree on everything passed to
 * it — eyebrows read "Console", "Administration" or nothing, and panels wrote
 * their own `<h2>` at three sizes. The eyebrow is now the nav group the page
 * belongs to, and a panel's heading is always `.es-panel-head`.
 */

export function PageHeader({ eyebrow, title, lede, actions }) {
  return (
    <header className="es-page-head">
      <div className="fx-stack fx-stack--sm fx-min0 gap-2">
        {eyebrow && <p className="es-eyebrow">{eyebrow}</p>}
        <h1 className="es-page-head__title fx-break">{title}</h1>
        {lede && <p className="es-page-head__lede">{lede}</p>}
      </div>
      {actions && <div className="es-page-head__actions">{actions}</div>}
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
        <h2 className="es-section-title fx-break">{title}</h2>
        {lede && <p className="es-page-head__lede">{lede}</p>}
      </div>
      {actions && <div className="es-page-head__actions">{actions}</div>}
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

/** A titled card section. `description` is one supporting line under the title. */
export function Panel({ title, description, action, children, className = '' }) {
  return (
    <section className={`es-card es-panel ${className}`}>
      {(title || action) && (
        <div className="es-panel-head">
          <div className="fx-min0">
            {title && <h2 className="es-panel-head__title">{title}</h2>}
            {description && <p className="es-panel-head__desc">{description}</p>}
          </div>
          {action && <div className="es-panel-head__action">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
