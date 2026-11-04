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
export function KpiRow({ children, label }) {
  return <div className="es-kpirow" role="group" aria-label={label}>{children}</div>;
}

export function Kpi({ icon, label, value, note, tone, href }) {
  const body = (
    <>
      <span className="es-kpi__icon" data-tone={tone}><NavIcon name={icon} size={26} /></span>
      <span className="es-kpi__body">
        <span className="es-kpi__label">{label}</span>
        <span className="es-kpi__value">{value}</span>
        {note && <span className="es-kpi__note">{note}</span>}
      </span>
    </>
  );
  if (href) return <Link href={href} className="es-kpi es-kpi--link">{body}</Link>;
  return <div className="es-kpi">{body}</div>;
}
