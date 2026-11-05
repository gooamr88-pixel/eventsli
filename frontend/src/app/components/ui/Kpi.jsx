import Link from 'next/link';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The figure strip at the top of an event section — "4 ticket types",
 * "320 checked in" — in the same card the dashboard uses (`.es-kpi`).
 *
 * `value` arrives formatted: only the caller knows the currency. `note` is one
 * short line under it. With `href` the whole card goes where the number comes
 * from. Every figure is the page's own data; a strip never shows a number the
 * page could not also show in its table.
 *
 * `KpiRow` packs as many as fit — two to five tiles, never a lone orphan
 * stretched across a row the way a fixed four-column grid strands a fifth.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * `tiles`: the larger card — the icon on a soft square and a toned value
 * ("Working" in the accent). Opt-in per page, so the strips already shipped
 * elsewhere do not change under them.
 */
export function KpiRow({ children, label, tiles = false }) {
  return <div className={`es-kpirow ${tiles ? 'es-kpirow--tiles' : ''}`} role="group" aria-label={label}>{children}</div>;
}

/**
 * `featured`: the one figure the page is about, tinted and lifted. One per row.
 * `sub`: a small line under the label — the window a figure covers ("Last
 * 30 days"), so the label itself can stay a plain noun.
 * `iconTone`: colours the icon only — a red cross beside "Rejected" without
 * printing the count itself in alarm red. Falls back to `tone`.
 */
export function Kpi({ icon, label, sub, value, note, tone, iconTone, href, featured = false }) {
  const body = (
    <>
      {icon && <span className="es-kpi__icon" data-tone={iconTone || tone}><NavIcon name={icon} size={26} /></span>}
      <span className="es-kpi__body">
        <span className="es-kpi__label">{label}</span>
        {sub && <span className="es-kpi__sub">{sub}</span>}
        <span className="es-kpi__value" data-tone={tone}>{value}</span>
        {note && <span className="es-kpi__note">{note}</span>}
      </span>
    </>
  );
  const cls = `es-kpi ${featured ? 'es-kpi--featured' : ''}`;
  if (href) return <Link href={href} className={`${cls} es-kpi--link`}>{body}</Link>;
  return <div className={cls}>{body}</div>;
}
