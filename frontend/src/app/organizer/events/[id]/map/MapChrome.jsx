'use client';

import NavIcon from '../../../../components/shell/NavIcon';
import { useEventContext } from '../EventContext';
import { MAX_TABLES } from './useMapDraft';
import { MAX_ZONES } from '../../../../components/seating/venueZones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Around the canvas: the page's head and the one line of advice above it.
 * The canvas, its toolbar and the panels stay in MapEditor.
 *
 * PREVIEW opens the buyer's own seat picker (`/e/<slug>/seats`) — only once
 * the event is on sale, because before that the public route answers 404. It
 * shows the map as SAVED; the "Unsaved changes" chip says when that differs.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function MapHeader({ tables, zones, seatTotal, soldTotal, dirty, saving, canSave, onSave, onExport }) {
  const event = useEventContext()?.event;
  const live = event?.status === 'published' && event?.slug;
  return (
    <div className="es-page-head es-page-head--section">
      <div className="fx-stack fx-stack--sm fx-min0 gap-1">
        {/* The page's <h1>: the event layout's head is the breadcrumb (see layout.jsx). */}
        <h1 className="es-section-title">Seating map</h1>
        <p className="es-page-head__lede">Design your venue&apos;s layout and assign ticket types to seats, rows and tables.</p>
        {/* What the room holds, as figures an organizer plans by — seats, not
            just tables. The limits appear only when they are close. */}
        <ul className="es-mapsum" aria-label="This room">
          <li>
            <b className="es-nums">{tables.length}</b>
            {tables.length === 1 ? ' table' : ' tables'}
            {tables.length >= MAX_TABLES * 0.8 && <span className="text-subtle"> of {MAX_TABLES}</span>}
          </li>
          <li><b className="es-nums">{seatTotal}</b>{seatTotal === 1 ? ' seat' : ' seats'}</li>
          {zones.length > 0 && (
            <li>
              <b className="es-nums">{zones.length}</b>
              {zones.length === 1 ? ' zone' : ' zones'}
              {zones.length >= MAX_ZONES * 0.8 && <span className="text-subtle"> of {MAX_ZONES}</span>}
            </li>
          )}
          {soldTotal > 0 && <li><b className="es-nums">{soldTotal}</b> sold or held</li>}
          {dirty && <li className="es-mapsum__dirty">Unsaved changes</li>}
        </ul>
      </div>
      <div className="es-page-head__actions">
        {live ? (
          <a href={`/e/${event.slug}/seats`} target="_blank" rel="noreferrer" className="es-btn es-btn--secondary">
            <NavIcon name="eye" size={18} />Preview<span className="sr-only"> the buyer&apos;s seat picker (opens in a new tab)</span>
          </a>
        ) : (
          <span className="es-btn es-btn--secondary" aria-disabled="true" title="The buyer's seat picker opens once the event is on sale.">
            <NavIcon name="eye" size={18} />Preview
          </span>
        )}
        <button type="button" onClick={onExport} disabled={tables.length === 0 && zones.length === 0} className="es-btn es-btn--secondary es-mapexport">
          <NavIcon name="printer" size={18} />Print / export
        </button>
        <button type="button" onClick={onSave} disabled={!canSave} className="es-btn es-btn--primary">
          <NavIcon name="tick" size={18} />{saving ? 'Saving…' : 'Save map'}
        </button>
      </div>
    </div>
  );
}

/**
 * Tables with no way to price their seats. A seat's price resolves seat
 * override → table → ticket type, so a table with none of the three is the
 * dangerous one. 0 is a price (free); only a missing value counts.
 */
export function countUnpriced(tables) {
  const none = (v) => v === null || v === undefined || v === '';
  return tables.filter((t) => !t.tierId && none(t.priceCents) && none(t.seatPriceCents)).length;
}

/** The one piece of advice that is true right now, counted from the draft. */
export function MapBanner({ tables }) {
  const unpriced = countUnpriced(tables);
  const [title, text, tone] = tables.length === 0
    ? ['Start with the room', 'Add rows of seats, tables and areas from the panel on the right, or double-click the floor to drop a table.', 'info']
    : unpriced > 0
      ? ['Link seats to ticket types', `${unpriced} ${unpriced === 1 ? 'table has' : 'tables have'} no ticket type or price yet. Select ${unpriced === 1 ? 'it' : 'them'}, then choose a ticket type in the panel.`, 'warning']
      : ['Every table has a price', 'Each seat sells at its ticket type, unless a table or seat sets its own price.', 'info'];
  return (
    <section className="es-payintro" data-tone={tone} aria-labelledby="map-advice">
      <span className="es-payintro__icon" aria-hidden="true"><NavIcon name={tone === 'warning' ? 'alert' : 'info'} size={24} /></span>
      <div className="fx-min0">
        <h2 id="map-advice" className="es-payintro__title">{title}</h2>
        <p className="es-payintro__text">{text}</p>
      </div>
    </section>
  );
}
