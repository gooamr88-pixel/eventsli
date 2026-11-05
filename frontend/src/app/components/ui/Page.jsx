import NavIcon from '../shell/NavIcon';
import { Kpi } from './Kpi';

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

export function PageHeader({ eyebrow, title, lede, actions, art, icon }) {
  return (
    <header className="es-page-head">
      <div className="fx-stack fx-stack--sm fx-min0 gap-2">
        {eyebrow && <p className="es-eyebrow">{eyebrow}</p>}
        <h1 className="es-page-head__title fx-break">
          {/* `icon`: a glyph before the title, as on Sign-in & security. */}
          {icon && <span className="es-section-title__icon" aria-hidden="true"><NavIcon name={icon} size={36} /></span>}
          {title}
        </h1>
        {lede && <p className="es-page-head__lede">{lede}</p>}
      </div>
      {actions && <div className="es-page-head__actions">{actions}</div>}
      {/* `art`: a decorative picture on the right (components/ui/Illustrations). */}
      {art && <div className="es-page-head__art" aria-hidden="true">{art}</div>}
    </header>
  );
}

/**
 * The title of one section of an event — Ticket types, Orders, Door list.
 *
 * IT IS THE PAGE'S <h1> NOW. It used to be an <h2> under the event's title,
 * which the event layout printed as the h1 above every section. Since 2026-11
 * the layout's head on a section is the breadcrumb and the event's status
 * (the event is named in the breadcrumb), so the section's own name is the
 * page's heading — which is also what the sidebar has lit up.
 */
export function SectionHeader({ title, lede, actions, icon, iconTile = false, art }) {
  return (
    <div className="es-page-head es-page-head--section">
      <div className="fx-stack fx-stack--sm gap-1 fx-min0">
        <h1 className="es-section-title fx-break">
          {/* `icon`: a glyph before the name, as on Door sales. Decorative.
              `iconTile` sets it on a soft square, as on Door team. */}
          {icon && (
            <span className={`es-section-title__icon${iconTile ? ' es-icontile es-icontile--lg' : ''}`} aria-hidden="true">
              <NavIcon name={icon} size={iconTile ? 30 : 36} />
            </span>
          )}
          {title}
        </h1>
        {lede && <p className="es-page-head__lede">{lede}</p>}
      </div>
      {actions && <div className="es-page-head__actions">{actions}</div>}
      {/* `art`: a decorative picture on the right, hidden below md. */}
      {art && <div className="es-page-head__art" aria-hidden="true">{art}</div>}
    </div>
  );
}

/**
 * One number. `value` arrives formatted — only the caller knows the currency.
 * With `href` the whole card is the link to where that number comes from.
 *
 * The same tile as `Kpi` since the 2026-11 redesign: a dashboard's figures
 * and a section's figures were two different cards for one idea. Kept as its
 * own export so the call sites read as they did.
 */
export function StatCard({ label, value, note, icon, href }) {
  return <Kpi icon={icon} label={label} value={value} note={note} href={href} />;
}

/**
 * A titled card section. `description` is one supporting line under the title;
 * `icon` puts the section's glyph beside both, as the redesigned screens do.
 */
export function Panel({ title, description, action, icon, iconTile = false, children, className = '' }) {
  return (
    <section className={`es-card es-panel ${className}`}>
      {(title || action) && (
        <div className="es-panel-head">
          <div className={`fx-min0${icon ? ' es-panel-head__main' : ''}`}>
            {/* `iconTile`: the glyph on a soft square, as on Door team. */}
            {icon && <span className={`es-panel-head__icon${iconTile ? ' es-icontile' : ''}`} aria-hidden="true"><NavIcon name={icon} size={iconTile ? 24 : 22} /></span>}
            <div className="fx-min0">
              {title && <h2 className="es-panel-head__title">{title}</h2>}
              {description && <p className="es-panel-head__desc">{description}</p>}
            </div>
          </div>
          {action && <div className="es-panel-head__action">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
