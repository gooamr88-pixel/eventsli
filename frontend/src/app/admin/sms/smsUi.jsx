'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import NavIcon from '../../components/shell/NavIcon';
import { COUNTRY_STATUS, MESSAGE_STATUS, CAMPAIGN_STATUS } from '../../lib/smsFormat';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The SMS console's small parts: its section tabs, a switch, status pills, a
 * country badge, a sparkline and a change chip. One file so every SMS page
 * draws them the same way.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const SMS_SECTIONS = [
  { href: '/admin/sms', label: 'Overview', exact: true },
  { href: '/admin/sms/countries', label: 'Countries' },
  { href: '/admin/sms/providers', label: 'Providers' },
  { href: '/admin/sms/senders', label: 'Sender IDs' },
  { href: '/admin/sms/categories', label: 'Categories' },
  { href: '/admin/sms/campaigns', label: 'Campaigns' },
  { href: '/admin/sms/audiences', label: 'Audiences' },
  { href: '/admin/sms/organizers', label: 'Organizers' },
  { href: '/admin/sms/analytics', label: 'Analytics' },
  { href: '/admin/sms/messages', label: 'Delivery log' },
  { href: '/admin/sms/compliance', label: 'Compliance' },
];

export function SmsTabs() {
  const pathname = usePathname() || '';
  const current = SMS_SECTIONS
    .filter((s) => (s.exact ? pathname === s.href : pathname === s.href || pathname.startsWith(`${s.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav aria-label="SMS sections" className="es-smstabs fx-scroll-x">
      <ul>
        {SMS_SECTIONS.map((s) => (
          <li key={s.href}>
            <Link href={s.href} aria-current={current?.href === s.href ? 'page' : undefined}>{s.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The console's switch (`.es-switch`), with the label read out but optionally hidden. */
export function Toggle({ checked, onChange, label, disabled = false, showLabel = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={showLabel ? undefined : label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="es-switch"
    >
      {showLabel && <span className="es-switch__label">{label}</span>}
      <span aria-hidden className="es-switch__track"><span className="es-switch__thumb" /></span>
    </button>
  );
}

export function StatusPill({ status, map = 'message' }) {
  const table = { country: COUNTRY_STATUS, message: MESSAGE_STATUS, campaign: CAMPAIGN_STATUS }[map];
  const entry = table[status] || { label: status, tone: 'muted' };
  return <span className="es-smspill" data-tone={entry.tone}>{entry.label}</span>;
}

export function CountryBadge({ iso2, name, sub }) {
  return (
    <span className="es-smscountry">
      {/* The ISO code, not an emoji flag: Windows has no flag glyphs and would
          draw the same two letters in a box, twice. */}
      <span className="es-smscountry__flag" aria-hidden>{iso2}</span>
      <span className="fx-min0">
        <span className="es-smscountry__name fx-truncate">{name || iso2}</span>
        {sub && <span className="es-smscountry__sub">{sub}</span>}
      </span>
    </span>
  );
}

/** A small trend line. `values` are plotted min→max; empty or flat draws a baseline. */
export function Sparkline({ values = [], label }) {
  const W = 120;
  const H = 36;
  const v = values.length > 1 ? values : [0, ...(values.length ? values : [0])];
  const max = Math.max(...v);
  const min = Math.min(...v);
  const span = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * W, H - 4 - ((y - min) / span) * (H - 8)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="es-smsspark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      <path d={`${line} L${W},${H} L0,${H} Z`} className="es-smsspark__fill" />
      <path d={line} className="es-smsspark__line" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.5" className="es-smsspark__dot" />
    </svg>
  );
}

/** "+12%" in green, "-8%" in red; `inverse` for figures where down is good (cost). */
export function DeltaChip({ value, suffix = '%', inverse = false, absolute = false }) {
  if (value == null) return <span className="es-smsdelta" data-tone="muted">New</span>;
  const up = value > 0;
  const good = value === 0 ? null : (up !== inverse);
  const text = value === 0 ? `0${suffix}` : absolute ? `${up ? '+' : ''}${value}` : `${up ? '+' : ''}${value.toFixed(Math.abs(value) < 10 ? 1 : 0)}${suffix}`;
  return (
    <span className="es-smsdelta" data-tone={good == null ? 'muted' : good ? 'success' : 'danger'}>
      {value !== 0 && <span aria-hidden>{up ? '↑' : '↓'}</span>}
      {text}
    </span>
  );
}

export function StatTile({ icon, value, label, delta, spark, sparkLabel, href }) {
  const inner = (
    <>
      <span className="es-smsstat__icon"><NavIcon name={icon} size={22} /></span>
      <span className="es-smsstat__body">
        <span className="es-smsstat__value">{value}</span>
        <span className="es-smsstat__label">{label}</span>
        <span className="es-smsstat__foot">
          {delta}
          {spark && <Sparkline values={spark} label={sparkLabel || `${label} trend`} />}
        </span>
      </span>
    </>
  );
  return href ? <Link href={href} className="es-smsstat es-smsstat--link">{inner}</Link> : <div className="es-smsstat">{inner}</div>;
}

export function SmsHeader({ title, lede, actions, icon = 'chat' }) {
  return (
    <header className="es-smshead">
      <span className="es-smshead__icon" aria-hidden><NavIcon name={icon} size={26} /></span>
      <div className="es-smshead__main">
        <h1 className="es-smshead__title">{title}</h1>
        {lede && <p className="es-smshead__lede">{lede}</p>}
      </div>
      {actions && <div className="es-smshead__actions">{actions}</div>}
    </header>
  );
}

/** Every SMS page but the overview: the header, the section tabs, the body. */
export function SmsPage({ title, lede, icon, actions, children }) {
  return (
    <div className="fx-stack">
      <SmsHeader title={title} lede={lede} icon={icon} actions={actions} />
      <SmsTabs />
      {children}
    </div>
  );
}
