'use client';

import NavIcon from '../shell/NavIcon';
import { formatMoney } from '../../utils/money';

/**
 * One event template as a card (2026-11-19): its picture, name, what it sets
 * up, and the actions the page passes in as `children`. The organizer's
 * library, Eventsli's shared templates and the admin console all draw this.
 */
export function templateFacts(summary = {}) {
  const facts = [];
  if (summary.tiers) facts.push(`${summary.tiers} ticket type${summary.tiers === 1 ? '' : 's'}`);
  if (summary.hasMap) facts.push(`${Number(summary.seats || 0).toLocaleString('en')} seats`);
  else if (summary.admissionType === 'general') facts.push('General admission');
  if (summary.addons) facts.push(`${summary.addons} add-on${summary.addons === 1 ? '' : 's'}`);
  if (summary.areas) facts.push(`${summary.areas} area${summary.areas === 1 ? '' : 's'}`);
  return facts;
}

export default function TemplateCard({ template, badges = [], children, onOpen }) {
  const s = template.summary || {};
  const from = s.lowestPriceCents !== null && s.lowestPriceCents !== undefined && s.currency
    ? (s.lowestPriceCents === 0 ? 'Free tickets' : `From ${formatMoney(s.lowestPriceCents, s.currency)}`)
    : null;

  return (
    <article className="es-tplcard">
      <button type="button" className="es-tplcard__media" onClick={onOpen} aria-label={`Preview ${template.name}`}>
        {template.coverUrl
          // eslint-disable-next-line @next/next/no-img-element -- any https cover an admin set
          ? <img src={template.coverUrl} alt="" loading="lazy" />
          : <span className="es-tplcard__placeholder" aria-hidden="true"><NavIcon name={s.hasMap ? 'map' : 'ticket'} size={30} /></span>}
        {badges.length > 0 && (
          <span className="es-tplcard__badges">
            {badges.map((b) => <span key={b.label} className="es-tplcard__badge" data-tone={b.tone || 'neutral'}>{b.label}</span>)}
          </span>
        )}
      </button>
      <div className="es-tplcard__body">
        <h3 className="es-tplcard__title fx-break">{template.name}</h3>
        {template.description && <p className="es-tplcard__desc">{template.description}</p>}
        <p className="es-tplcard__facts">
          {[...templateFacts(s), from].filter(Boolean).join(' · ') || 'Event details only'}
        </p>
        {template.useCount > 0 && (
          <p className="es-tplcard__meta">Used {template.useCount} time{template.useCount === 1 ? '' : 's'}</p>
        )}
      </div>
      {children && <div className="es-tplcard__actions">{children}</div>}
    </article>
  );
}
