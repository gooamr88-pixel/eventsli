'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FloorPlanFigure from './FloorPlanFigure';
import { SectionHeading, TableIndex, ZoneIndex, TableCards } from './PackSections';
import { buildTableIndex, buildZoneIndex, packSummary, chunk } from './packRoster';
import { PAPERS, PAPER_KEYS, PAGE_MARGIN_MM, paperBox } from './packGeometry';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EVENT-DAY PACK — what somebody actually carries on the night.
 *
 * Four parts, and each one answers a different question that gets asked at a
 * real door:
 *
 *   1. FLOOR PLAN — the room to scale, every table carrying its name and its
 *      seats. This is what an usher walks with. One page, as large as the paper
 *      allows.
 *
 *   2. TABLE INDEX — sorted by NAME, not by position. Somebody is handed a
 *      table name and needs to know how many seats it has and how many are
 *      still free; a list ordered by where the table sits in the room cannot
 *      answer that in under a minute.
 *
 *   3. VENUE ZONES — the furniture list, for whoever sets the room up hours
 *      before any of the above matters.
 *
 *   4. TABLE CARDS — one per table, set large, to cut out and stand on the
 *      table itself.
 *
 * PRINTING IS THE BROWSER'S JOB. There is no PDF library here and there should
 * not be: every browser already has a print engine that paginates flowing
 * content, honours `@page`, and offers "Save as PDF" in the same dialog. A
 * library would mean re-implementing pagination in order to produce a worse
 * version of what the Print button already does.
 *
 * WHAT MAKES THE PREVIEW HONEST. The sheet is sized in real millimetres and the
 * `@page` rule is given the same size, so what is on screen is the printed page
 * scaled by a zoom and nothing else. `print-color-adjust: exact` is what stops
 * the browser helpfully dropping the light zone washes, which are the only
 * thing distinguishing floor from furniture once the plan is in grey.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SeatingPackModal({ eventTitle, tables, zones, categories, dirty, onClose }) {
  const [paper, setPaper] = useState('a4');
  const [orientation, setOrientation] = useState('landscape');
  const [zoom, setZoom] = useState(0.55);
  const [showSeats, setShowSeats] = useState(true);
  const [showSold, setShowSold] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showCards, setShowCards] = useState(false);
  const closeRef = useRef(null);

  // Escape closes, and focus moves into the dialog so Tab stays here rather
  // than walking the editor underneath it.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const box = paperBox(paper, orientation);
  const tableRows = useMemo(() => buildTableIndex(tables, categories), [tables, categories]);
  const zoneRows = useMemo(() => buildZoneIndex(zones), [zones]);
  const summary = useMemo(() => packSummary(tables, zones), [tables, zones]);

  // Cards are laid out by arithmetic rather than by flow: each is a fixed
  // fraction of the sheet, so how many fit is decided here and not by where the
  // text happens to run out.
  const cardColumns = orientation === 'landscape' ? 3 : 2;
  const cardRows = orientation === 'landscape' ? 2 : 3;
  const cardPages = useMemo(
    () => chunk(tableRows, cardColumns * cardRows),
    [tableRows, cardColumns, cardRows],
  );

  const printedAt = useMemo(() => new Date().toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }), []);

  /**
   * A portal needs a DOM to go into.
   *
   * A `mounted` state flag set from an effect is the usual spelling of this and
   * is both slower — a render that draws nothing, then a second one — and
   * rejected by React's compiler, which treats setState in an effect body as
   * the cascading render it is. The guard is enough: this modal is only ever
   * rendered after a click, so on the server the branch is never reached.
   */
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="es-pack-root">
      <style>{printCss(box)}</style>

      <header className="es-pack-chrome fx-row fx-row--between flex-wrap gap-3 border-b border-border-base bg-surface px-4 py-3">
        <div className="fx-min0">
          <h2 className="text-lg">Print / export</h2>
          <p className="text-sm text-muted">
            {summary.tables} tables · {summary.seats} seats · {summary.free} free
            {summary.zones > 0 && ` · ${summary.zones} zones`}
          </p>
        </div>
        <div className="fx-row flex-wrap gap-2">
          <button type="button" onClick={() => window.print()} className="es-btn es-btn--primary">
            Print or save as PDF
          </button>
          <button ref={closeRef} type="button" onClick={onClose} className="es-btn es-btn--ghost">
            Close
          </button>
        </div>
      </header>

      <div className="es-pack-body flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <aside className="es-pack-chrome fx-stack fx-stack--sm w-full shrink-0 overflow-y-auto border-border-base bg-surface p-4 md:w-72 md:border-r">
          {dirty && (
            <p className="rounded-(--es-radius-md) bg-warning/10 px-3 py-2 text-xs text-muted">
              This prints the map as it is on screen, including changes you have not saved.
            </p>
          )}

          <Choice
            label="Paper" value={paper} onChange={setPaper}
            options={PAPER_KEYS.map((k) => [k, PAPERS[k].label])}
          />
          <Choice
            label="Orientation" value={orientation} onChange={setOrientation}
            options={[['landscape', 'Landscape'], ['portrait', 'Portrait']]}
          />

          <Toggle checked={showSeats} onChange={setShowSeats} label="Draw each seat" />
          <Toggle
            checked={showSold} onChange={setShowSold}
            label="Mark taken seats"
            hint="Filled circles are sold or held — the one distinction that survives a photocopier."
          />
          <Toggle checked={showZones} onChange={setShowZones} label="Include the zone list" disabled={zoneRows.length === 0} />
          <Toggle
            checked={showCards} onChange={setShowCards}
            label="Table cards"
            hint={`One per table to cut out — ${cardPages.length} extra ${cardPages.length === 1 ? 'page' : 'pages'}.`}
          />

          <div className="fx-stack fx-stack--sm gap-1.5">
            <label htmlFor="es-pack-zoom" className="text-sm text-ink">Preview size</label>
            <input
              id="es-pack-zoom" type="range" min={25} max={110} step={5}
              value={Math.round(zoom * 100)}
              onChange={(e) => setZoom(Number(e.target.value) / 100)}
            />
            <p className="text-xs text-subtle">
              {Math.round(zoom * 100)}% — the sheet is {box.label}, {box.width}×{box.height}mm. Only the
              preview scales; the print is always full size.
            </p>
          </div>
        </aside>

        <div className="es-pack-scroll min-h-0 flex-1 overflow-auto p-6">
          <div
            className="es-pack-doc"
            // The zoom scales, rather than re-widths, so the document's own
            // millimetre geometry is never touched by it — the preview and the
            // print are the same boxes, one of them looked at from further away.
            // Passed as a NUMBER for the stylesheet to use, not as a finished
            // `transform`: an inline transform could only be overridden for
            // print with `!important`. See `printCss`.
            style={{ width: `${box.width}mm`, '--es-pack-zoom': zoom }}
          >
            <Sheet box={box} fixedHeight>
              <Letterhead
                eventTitle={eventTitle} printedAt={printedAt} summary={summary} title="Floor plan"
              />
              <div className="es-pack-plan">
                <FloorPlanFigure
                  tables={tables}
                  zones={zones}
                  widthMm={box.inner.width}
                  // The letterhead takes its share off the top; the plan gets
                  // the rest of the page, which is the whole point of giving it
                  // a page of its own.
                  heightMm={box.inner.height - 26}
                  showSeats={showSeats}
                  showSold={showSold}
                />
              </div>
            </Sheet>

            <Sheet box={box}>
              <Letterhead eventTitle={eventTitle} printedAt={printedAt} summary={summary} title="Tables" />
              <SectionHeading
                title="Table index"
                note="Sorted by name. Taken counts seats that are sold or held."
              />
              <TableIndex rows={tableRows} />

              {showZones && zoneRows.length > 0 && (
                <div style={{ marginTop: '10mm' }}>
                  <SectionHeading title="Venue zones" note="Furniture and areas — never sold or ticketed." />
                  <ZoneIndex rows={zoneRows} />
                </div>
              )}
            </Sheet>

            {showCards && cardPages.map((page, i) => (
              <Sheet key={page[0]?.key || i} box={box} fixedHeight>
                <TableCards rows={page} columns={cardColumns} rowsPerPage={cardRows} />
              </Sheet>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One sheet of paper.
 *
 * `fixedHeight` is for the pages that ARE a page — the floor plan and the
 * cards, which fill their sheet by design. Everything else is left to flow and
 * let the browser paginate, because a roster with a fixed height is a roster
 * that silently drops its last rows, which is the failure this whole pack was
 * rebuilt to remove.
 */
function Sheet({ box, fixedHeight, children }) {
  return (
    <section
      className="es-pack-sheet"
      style={{
        width: `${box.width}mm`,
        minHeight: `${box.height}mm`,
        ...(fixedHeight ? { height: `${box.height}mm` } : {}),
        padding: `${PAGE_MARGIN_MM}mm`,
        boxSizing: 'border-box',
        background: '#ffffff',
        color: '#101215',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {children}
    </section>
  );
}

/** The letterhead. Deliberately quiet: it is provenance, not decoration, and
 *  the page below it is the document. */
function Letterhead({ eventTitle, printedAt, summary, title }) {
  return (
    <header
      style={{
        borderBottom: '1.4px solid #101215',
        paddingBottom: '2.5mm',
        marginBottom: '4mm',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: '4mm',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: '2.8mm', letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.65, margin: 0 }}>
          {title}
        </p>
        <h1 style={{ fontSize: '5.6mm', fontWeight: 700, margin: '0.6mm 0 0' }}>
          {eventTitle || 'Seating pack'}
        </h1>
      </div>
      <p style={{ fontSize: '2.8mm', opacity: 0.7, textAlign: 'right', margin: 0, whiteSpace: 'nowrap' }}>
        {summary.tables} tables · {summary.seats} seats<br />
        Printed {printedAt}
      </p>
    </header>
  );
}

function Choice({ label, value, onChange, options }) {
  const id = `es-pack-${label.toLowerCase()}`;
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      <select id={id} className="es-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`fx-row items-start gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox" className="mt-0.5" checked={checked && !disabled} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-ink">{label}</span>
        {hint && <span className="block text-xs text-subtle">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * The modal's own layout, and the print rules that undo it.
 *
 * SCOPED TO THIS COMPONENT rather than added to globals.css, and that is the
 * argued choice: these are not tokens and nothing else shares them. One of them
 * hides the entire application, and a rule that can hide the whole app must not
 * be able to reach a page that is not this one. Mounted with the modal and gone
 * when it unmounts, it cannot.
 *
 * AND NOT ONE `!important`, which took some doing and was worth it — the
 * project's check refuses them and is right to: the platform this was ported
 * from had 366, and the only way to find out which rule won was devtools. Two
 * techniques replace them.
 *
 * First, the modal's own frame is declared HERE rather than in utility classes,
 * so the print rules that undo it sit in the same stylesheet, later. Same
 * specificity, later wins, no escalation needed.
 *
 * Second — and this is the one that would otherwise have forced it — the
 * preview zoom is a CUSTOM PROPERTY, not an inline `transform`. An inline style
 * can be beaten by nothing except `!important`, so a component that writes
 * `transform: scale(0.55)` onto an element has already decided that its print
 * rule will need one. Writing the NUMBER inline and the transform in CSS leaves
 * the declaration where a later rule can simply replace it.
 *
 * The `@page` size matches the sheet exactly. Without it the browser prints an
 * A4 page containing a Letter-sized box, or the reverse, and the margins the
 * preview showed are not the margins that come out.
 */
function printCss(box) {
  return `
    .es-pack-root {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: flex;
      flex-direction: column;
      background: rgba(15, 29, 58, 0.6);
    }
    .es-pack-doc {
      transform: scale(var(--es-pack-zoom, 1));
      transform-origin: top center;
      margin: 0 auto;
    }
    .es-pack-sheet {
      box-shadow: 0 6px 26px rgba(0, 0, 0, 0.22);
      margin: 0 auto 8mm;
    }
    .es-pack-plan {
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    @media print {
      @page { size: ${box.width}mm ${box.height}mm; margin: 0; }

      /* The app behind the modal is still in the DOM and would otherwise print
         underneath it. An element selector alongside the class puts this above
         any single utility class without escalating. */
      body > *:not(.es-pack-root) { display: none; }

      .es-pack-root {
        position: static;
        inset: auto;
        display: block;
        background: #ffffff;
      }
      .es-pack-root .es-pack-chrome { display: none; }
      .es-pack-root .es-pack-body { display: block; overflow: visible; }
      .es-pack-root .es-pack-scroll { overflow: visible; padding: 0; }

      /* The zoom is a screen affordance. On paper the sheet is the sheet, at
         the size the printer was told. */
      .es-pack-root .es-pack-doc { transform: none; width: auto; margin: 0; }

      .es-pack-root .es-pack-sheet { break-after: page; box-shadow: none; }
      .es-pack-root .es-pack-sheet:last-child { break-after: auto; }

      /* Without this the browser drops the light washes that are the only thing
         telling floor from furniture once the plan is in grey. */
      * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  `;
}
