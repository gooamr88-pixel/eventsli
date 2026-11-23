'use client';

import VenueMapThumb from './VenueMapThumb';
import { kindLabel, mapFacts, placeLine } from './venueMapData';

/**
 * One venue map as a card (2026-11-24): the room's sketch, the venue, the
 * layout's name, its figures, and the actions the page passes as `children`.
 * The admin library, the organizer's Templates page and the Venue Builder's
 * picker all draw it (the picker in its `compact` form).
 */
export default function VenueMapCard({ template, badges = [], children, onOpen, compact = false }) {
  const v = template.venue || {};
  const facts = mapFacts(template.summary);
  const place = placeLine(v);
  return (
    <article className={`es-tplcard es-vmcard${compact ? ' es-vmcard--compact' : ''}`}>
      <button type="button" className="es-tplcard__media es-vmcard__media" onClick={onOpen} aria-label={`Preview ${v.name} — ${template.name}`}>
        <VenueMapThumb sketch={template.summary?.sketch} label={`Sketch of ${v.name}`} />
        {badges.length > 0 && (
          <span className="es-tplcard__badges">
            {badges.map((b) => <span key={b.label} className="es-tplcard__badge" data-tone={b.tone || 'neutral'}>{b.label}</span>)}
          </span>
        )}
      </button>
      <div className="es-tplcard__body">
        <p className="es-vmcard__kind">{kindLabel(v.kind)}{place ? ` · ${place}` : ''}</p>
        <h3 className="es-tplcard__title fx-break">{v.name}</h3>
        <p className="es-vmcard__layout fx-break">{template.name}</p>
        {facts.length > 0 && <p className="es-tplcard__facts">{facts.join(' · ')}</p>}
        {!compact && template.useCount > 0 && (
          <p className="es-tplcard__meta">Used {template.useCount} time{template.useCount === 1 ? '' : 's'}</p>
        )}
      </div>
      {children && <div className="es-tplcard__actions">{children}</div>}
    </article>
  );
}
