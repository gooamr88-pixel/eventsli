import NavIcon from '../../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One section of Page & branding: an icon, a title, a line of explanation, and
 * the editor under them.
 *
 * `collapsible` is for the long, list-shaped sections — schedule, sponsors,
 * policies. Folded, each is still a row with its name and how many items it
 * has, so nothing disappears: the screen's rule is that a section an
 * organizer does not yet know about must stay in view, and a folded row with a
 * name keeps it in view while the page stays one screen tall. A native
 * <details>, so the keyboard and screen readers get open/closed for free.
 *
 * `action` stays out of the fold's <summary> on purpose: a button inside a
 * summary is a control inside a control, which announces badly and toggles the
 * fold when it is pressed. Folded, the row says what is there; open, the
 * action sits at the top of the body.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ContentCard({
  id, icon, title, description, action, count, collapsible = false, defaultOpen = false, children,
}) {
  const head = (
    <span className="es-ovcard__head fx-min0">
      <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name={icon} size={22} /></span>
      <span className="fx-min0">
        <span className="es-dcard__title">{title}</span>
        {description && <span className="es-ovcard__desc block">{description}</span>}
      </span>
    </span>
  );

  if (collapsible) {
    return (
      <details id={id} className="es-dcard es-pbfold" open={defaultOpen || undefined}>
        <summary className="es-pbfold__summary">
          {head}
          <span className="es-pbfold__end">
            {count !== undefined && count !== null && <span className="es-pbfold__count">{count}</span>}
            <span className="es-pbfold__chev" aria-hidden="true"><NavIcon name="chevronDown" size={20} /></span>
          </span>
        </summary>
        <div className="es-pbfold__body">
          {action && <div className="es-pbfold__action">{action}</div>}
          {children}
        </div>
      </details>
    );
  }

  return (
    <section id={id} className="es-dcard">
      <div className="es-dcard__head">
        {head}
        {(action || count !== undefined) && (
          <span className="es-pbfold__end">
            {count !== undefined && count !== null && <span className="es-pbfold__count">{count}</span>}
            {action}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
