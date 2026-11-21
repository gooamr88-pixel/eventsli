'use client';

import NavIcon from '../../../../components/shell/NavIcon';
import { describeError, messageFor } from '../../../../utils/errors';
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
export function MapHeader({ tables, zones, soldTotal, blockedTotal = 0, dirty, saving, canSave, onSave, onExport }) {
  const event = useEventContext()?.event;
  const live = event?.status === 'published' && event?.slug;
  return (
    <div className="es-page-head es-page-head--section es-maphead">
      <div className="fx-stack fx-stack--sm fx-min0 gap-1">
        {/* The page's <h1>: the event layout's head is the breadcrumb (see layout.jsx). */}
        <h1 className="es-section-title">Seating map</h1>
        <p className="es-page-head__lede">Design the room, see it in 3D and 360°, and preview what buyers get.</p>
        {/* STATE, not statistics (2026-11-21). The room's figures are in the
            bar under the canvas and on the Layout tab; up here is only what
            changes what the organizer may do next: whether the work is saved,
            the stock buyers already hold, and a limit coming close. */}
        <ul className="es-mapsum" aria-label="Map status">
          <li className={dirty ? 'es-mapsum__dirty' : 'es-mapsum__saved'}>
            <NavIcon name={dirty ? 'pencil' : 'tick'} size={14} />
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}
          </li>
          {/* Buyers' seats and the organizer's own blocks, apart (S-08): only
              the first stop a table being moved, shrunk or removed. */}
          {soldTotal > 0 && <li><b className="es-nums">{soldTotal}</b> sold or held</li>}
          {blockedTotal > 0 && <li><b className="es-nums">{blockedTotal}</b> blocked</li>}
          {tables.length >= MAX_TABLES * 0.8 && <li><b className="es-nums">{tables.length}</b> of {MAX_TABLES} tables</li>}
          {zones.length >= MAX_ZONES * 0.8 && <li><b className="es-nums">{zones.length}</b> of {MAX_ZONES} areas</li>}
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
 * Tables that cannot be sold the way this event sells — counted EXACTLY as the
 * server counts them (TECH-AUDIT-LOG S-04).
 *
 * A seat's price is its own seat price, else its ticket type's price. The
 * table's whole-table price is NOT in that chain: it is what booking the whole
 * table costs, and nothing else. This used to count a whole-table price as
 * pricing the seats, so the editor said "Every table has a price" over seats
 * the submission check then refused and a live map could not sell.
 *
 * Selling whole tables only, the table price IS the product, so that is the
 * one that has to be there. 0 is a price (free); only a missing value counts.
 */
export function countUnpriced(tables, purchaseMode = 'seat_only') {
  const none = (v) => v === null || v === undefined || v === '';
  if (purchaseMode === 'table_only') return tables.filter((t) => none(t.priceCents)).length;
  return tables.filter((t) => !t.tierId && none(t.seatPriceCents)).length;
}

/** The same rule as `countUnpriced`, for one table. */
export function isUnpriced(table, purchaseMode = 'seat_only') {
  return countUnpriced([table], purchaseMode) === 1;
}

/**
 * The one piece of advice that is true right now, counted from the draft —
 * and, since 2026-11-21, the button that acts on it: "Select them" selects
 * exactly the tables that cannot be sold, so the inspector beside the map is
 * already open on them with the ticket-type picker ready.
 */
export function MapBanner({ tables, purchaseMode = 'seat_only', onSelectUnpriced = null }) {
  const unpriced = countUnpriced(tables, purchaseMode);
  // Nothing to fix, nothing to say: the owner's mockup has no card here, and
  // "Every seat has a price" was one on every visit to a finished map.
  if (tables.length > 0 && unpriced === 0) return null;
  const them = unpriced === 1 ? 'it' : 'them';
  const [title, text, tone] = tables.length === 0
    ? ['Start with the room', 'Add a seating section, table or row — from Add to layout, or the Add button on the map’s toolbar.', 'info']
    : purchaseMode === 'table_only'
      ? ['Price every table', `${unpriced} ${unpriced === 1 ? 'table has' : 'tables have'} no whole-table price yet, so buyers can’t book ${them}.`, 'warning']
      : ['Link seats to ticket types', `${unpriced} ${unpriced === 1 ? 'table has' : 'tables have'} seats with no ticket type yet, so ${unpriced === 1 ? 'they aren’t' : 'those seats aren’t'} on sale. A whole-table price doesn’t price the seats.`, 'warning'];
  return (
    <section className="es-payintro es-mapbanner" data-tone={tone} aria-labelledby="map-advice">
      <span className="es-payintro__icon" aria-hidden="true"><NavIcon name={tone === 'warning' ? 'alert' : 'info'} size={24} /></span>
      <div className="fx-min0 flex-1">
        <h2 id="map-advice" className="es-payintro__title">{title}</h2>
        <p className="es-payintro__text">{text}</p>
      </div>
      {unpriced > 0 && onSelectUnpriced && (
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={onSelectUnpriced}>
          Select {them}
        </button>
      )}
    </section>
  );
}

/**
 * A save refusal is usually about STOCK, not about the map: a table with sold
 * seats cannot be deleted, and a table cannot be shrunk past its booked seats.
 * The API names which ones, and that message is the useful part — so it is
 * shown rather than replaced with a generic sentence.
 */
export function SaveError({ error, onReload }) {
  const { title } = describeError(error);
  // S-03: someone saved this map from another tab or device after this copy
  // was opened. Saving over them would delete their work, so the way forward
  // is to load what is there now — offered as a button, not a sentence.
  const stale = error?.code === 'MAP_STALE';
  return (
    <div role="alert" className="rounded-(--es-radius-md) bg-danger/10 px-4 py-3">
      <p className="text-sm font-medium text-ink">{title}</p>
      {stale && onReload && (
        <button type="button" onClick={onReload} className="es-btn es-btn--secondary es-btn--sm mt-2">
          Reload the map
        </button>
      )}
      {/* `messageFor` keeps the server's sentence where it is worth showing —
          "table 12 has 3 seats sold" is the useful part — and replaces only
          what never was, like a dropped connection's "Failed to fetch". */}
      <p className="text-sm text-muted">{messageFor(error)}</p>
      <p className="mt-1 text-xs text-subtle">
        Nothing was saved — the whole change was rolled back, so the map is exactly as it
        was.
      </p>
    </div>
  );
}

/**
 * Everything the editor has to SAY above the canvas, in one place: what stops
 * a save before the round trip, why the last save failed, what it could not
 * do, and which lists failed to load. Split out of MapEditor (2026-11-10).
 */
export function MapNotices({ problems, saveError, saveNote, lookupFailed, dirty, onReload }) {
  return (
    <>
      {/* Refused BEFORE the round trip. The API's messages for these are
          accurate but arrive after a save that looked like it was working. */}
      {problems.length > 0 && (
        <ul className="fx-stack fx-stack--sm rounded-(--es-radius-md) bg-warning/10 px-4 py-3 text-sm text-muted">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      {saveError && <SaveError error={saveError} onReload={onReload} />}

      {/* The save landed, but a buyer got to some of the blocked seats first. */}
      {saveNote && (
        <p role="status" className="rounded-(--es-radius-md) bg-warning/10 px-4 py-3 text-sm text-muted">{saveNote}</p>
      )}

      {/* S-17: an empty list because the read failed is not "you have none". */}
      {lookupFailed.length > 0 && (
        <p role="status" className="rounded-(--es-radius-md) bg-warning/10 px-4 py-3 text-sm text-muted">
          Your {lookupFailed.join(' and ')} could not be loaded, so {lookupFailed.length === 1 ? 'that list is' : 'those lists are'} empty
          below.{' '}
          {/* A reload replaces the draft, so it is offered only while there is
              nothing unsaved to lose. */}
          {dirty ? 'Save your changes, then reload the page' : (
            <button type="button" onClick={onReload} className="text-accent underline">Try again</button>
          )}
          {' '}before assigning {lookupFailed.includes('ticket types') ? 'ticket types' : 'categories'}.
        </p>
      )}
    </>
  );
}
