'use client';

import { useMemo } from 'react';
import {
  WORLD, SEAT_RADIUS, tableBody, seatPositions, toWorld, contentBounds, normaliseShape,
} from './seatingGeometry';
import { usePanZoom } from './usePanZoom';
import ZoneShape from './ZoneShape';
import { zoneLabel } from './venueZones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The seat map. One component, two callers: the buyer picks on it, and the
 * organizer's editor (phase 4) draws on the same geometry.
 *
 * Everything positional comes from seatingGeometry.js. Nothing here decides
 * where a seat goes — that is the point of the contract test.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * The default for `zones`, hoisted out of the parameter list.
 *
 * A literal `[]` in a default parameter allocates a NEW ARRAY on every render
 * where the prop is absent — which made `bounds` below a new object each time,
 * and a new bounds object re-frames the viewport, which re-renders, forever.
 * Door sales renders this map without zones and hit exactly that.
 *
 * `usePanZoom` no longer loops on a fresh-but-equal bounds either, so this is
 * now belt as well as brace: it also stops `contentBounds` being recomputed on
 * every render for no reason.
 */
const NO_ZONES = Object.freeze([]);

export default function SeatMapCanvas({
  tables = [],
  seats = [],
  /**
   * The venue's furniture — stage, bar, dance floor. Scenery, never stock.
   *
   * It is here because "which seats face the stage" is the question a buyer is
   * actually answering, and a map of bare tables cannot answer it. They are
   * drawn under the seats and take no pointer events, so nothing about picking
   * a seat changes; `ZoneShape` argues both at length.
   */
  zones = NO_ZONES,
  selectedSeatIds = new Set(),
  selectedTableIds = new Set(),
  // A tier to pick out: its seats stay bright, the rest are dimmed. Never a
  // restriction — dimmed seats are still selectable.
  highlightTierId = null,
  onSelectSeat,
  onSelectTable,
  purchaseMode = 'seat_only',
  className = '',
}) {
  const bounds = useMemo(() => contentBounds(tables, zones), [tables, zones]);
  const { svgRef, view, fit, zoomIn, zoomOut, wasDragged, handlers } = usePanZoom(bounds);

  /**
   * The zones, as a sentence.
   *
   * The drawn ones are `aria-hidden` — forty pieces of furniture in the tab
   * order between a buyer and the seats is an obstacle, not information. But
   * "the stage is at the front" is genuinely useful when choosing a seat, and a
   * screen-reader user loses it entirely if the only place it exists is a
   * picture. So it is said once, in text, and the map stays quiet.
   */
  const zoneSummary = useMemo(() => {
    if (zones.length === 0) return null;
    return zones.map(zoneLabel).join(', ');
  }, [zones]);

  /**
   * Seats grouped by table, once per data change.
   *
   * A `seats.filter()` inside the table loop is O(tables × seats) — 200 tables
   * of 10 is 400,000 comparisons on every single render, and this component
   * re-renders on every frame of a pan.
   */
  const seatsByTable = useMemo(() => {
    const map = new Map();
    for (const seat of seats) {
      if (!seat.tableId) continue;
      const list = map.get(seat.tableId);
      if (list) list.push(seat); else map.set(seat.tableId, [seat]);
    }
    // Seat 1 must be the geometry's index 0, or the numbers on screen do not
    // match the numbers on the ticket. `seat_number` is TEXT in the database.
    for (const list of map.values()) {
      list.sort((a, b) => Number(a.number) - Number(b.number) || String(a.number).localeCompare(String(b.number)));
    }
    return map;
  }, [seats]);

  const canPickSeats = purchaseMode !== 'table_only';
  const canPickTables = purchaseMode !== 'seat_only';

  return (
    <div className={`relative ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        className="block h-full w-full select-none rounded-(--es-radius-lg) border border-border-base bg-bg-sunken"
        // `touch-action: none` is what stops the browser scrolling the page
        // instead of panning the map. Without it a one-finger drag on a phone
        // scrolls past the map and the seats are unreachable.
        style={{ touchAction: 'none', overscrollBehavior: 'contain', cursor: 'grab' }}
        role="group"
        aria-label="Seat map"
        {...handlers}
      >
        {/* ZONES FIRST. SVG has no z-index — paint order is the only thing
            keeping a dance floor from covering the seats around it. */}
        {zones.map((zone) => <ZoneShape key={zone.id} zone={zone} />)}

        {tables.map((table) => (
          <Table
            key={table.id}
            table={table}
            seats={seatsByTable.get(table.id) || []}
            selectedSeatIds={selectedSeatIds}
            isTableSelected={selectedTableIds.has(table.id)}
            highlightTierId={highlightTierId}
            canPickSeats={canPickSeats}
            canPickTables={canPickTables}
            onSelectSeat={onSelectSeat}
            onSelectTable={onSelectTable}
            wasDragged={wasDragged}
          />
        ))}
      </svg>

      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <MapButton onClick={zoomIn} label="Zoom in">+</MapButton>
        <MapButton onClick={zoomOut} label="Zoom out">−</MapButton>
        <MapButton onClick={fit} label="Fit the whole map">⤢</MapButton>
      </div>

      {zoneSummary && (
        <p className="mt-2 text-xs text-subtle">
          Also on this map: {zoneSummary}.
        </p>
      )}
    </div>
  );
}

function MapButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // 40px is not arbitrary: it is the smallest square a thumb hits reliably,
      // and these sit in the corner a right hand covers while panning.
      className="grid h-10 w-10 place-items-center rounded-(--es-radius-md) border border-border-strong bg-surface text-lg text-ink shadow-sm transition-colors hover:bg-bg-sunken"
    >
      {children}
    </button>
  );
}

function Table({
  table, seats, selectedSeatIds, isTableSelected, highlightTierId,
  canPickSeats, canPickTables, onSelectSeat, onSelectTable, wasDragged,
}) {
  const pos = toWorld(table.position);
  const shape = normaliseShape(table.shape);
  const body = tableBody(shape, table.seatCount);
  const layout = seatPositions(shape, table.seatCount);

  // BRD §25 — a table and its seats are two views of ONE piece of stock. Once a
  // single seat sells individually the whole-table option closes, and the API
  // says so with `canBookWhole` rather than leaving it to be inferred.
  const wholeTableAvailable = canPickTables && table.canBookWhole;

  const handleTable = (e) => {
    e.stopPropagation();
    if (wasDragged() || !wholeTableAvailable) return;
    onSelectTable?.(table);
  };

  return (
    <g transform={`translate(${pos.x} ${pos.y}) rotate(${pos.rotation})`}>
      {body.kind !== 'none' && (
        <TableBody
          body={body}
          selected={isTableSelected}
          clickable={wholeTableAvailable}
          onClick={handleTable}
          label={table.label}
        />
      )}

      {layout.map((point, index) => {
        const seat = seats[index];
        // A table whose seat rows have not loaded, or a seat count that changed
        // under a cached map. Drawing the empty position keeps the table's
        // shape honest rather than showing a gap-toothed ring.
        const available = seat ? seat.available : false;
        const selected = seat ? selectedSeatIds.has(seat.id) : false;

        return (
          <Seat
            key={seat?.id || `${table.id}-${index}`}
            point={point}
            number={seat?.number ?? String(index + 1)}
            tableLabel={table.label}
            available={available}
            selected={selected}
            dimmed={isTableSelected}
            outsideFocus={Boolean(highlightTierId && seat && seat.tierId !== highlightTierId)}
            inFocus={Boolean(highlightTierId && seat && seat.tierId === highlightTierId)}
            clickable={canPickSeats && available && seat && !isTableSelected}
            onClick={(e) => {
              e.stopPropagation();
              if (wasDragged() || !seat || !available || isTableSelected) return;
              onSelectSeat?.(seat, table);
            }}
          />
        );
      })}

      {/* Drawn last so it sits above the seats, and non-interactive so it never
          swallows a tap meant for the seat underneath it. */}
      {body.kind !== 'none' && (
        <text
          y={4}
          textAnchor="middle"
          className="fill-ink"
          style={{ fontSize: 14, fontWeight: 500, pointerEvents: 'none' }}
        >
          {table.label}
        </text>
      )}
    </g>
  );
}

function TableBody({ body, selected, clickable, onClick, label }) {
  const fill = selected ? 'var(--es-seat-selected)' : 'var(--es-surface)';
  const stroke = selected ? 'var(--es-accent)' : 'var(--es-border-strong)';

  const common = {
    fill,
    stroke,
    strokeWidth: selected ? 3 : 1.5,
    style: { cursor: clickable ? 'pointer' : 'default' },
    onClick,
    ...(clickable
      ? { role: 'button', tabIndex: 0, 'aria-label': `Book table ${label} whole` }
      : { 'aria-hidden': true }),
  };

  if (body.kind === 'ellipse') {
    return <ellipse rx={body.width / 2} ry={body.height / 2} {...common} />;
  }
  return (
    <rect
      x={-body.width / 2}
      y={-body.height / 2}
      width={body.width}
      height={body.height}
      rx={body.rx}
      {...common}
    />
  );
}

function Seat({
  point, number, tableLabel, available, selected, dimmed, outsideFocus, inFocus, clickable, onClick,
}) {
  const fill = selected
    ? 'var(--es-seat-selected)'
    : available
      ? 'var(--es-seat-available)'
      : 'var(--es-seat-sold)';

  return (
    <g transform={`translate(${point.x} ${point.y})`}>
      {/*
        An invisible hit area, larger than the seat itself.
        SEAT_RADIUS is 9 world units; at a normal zoom that is a target of a few
        millimetres, which no thumb hits. The visible circle stays small — a map
        of fat seats is unreadable — and this one takes the tap.
      */}
      <circle
        r={SEAT_RADIUS * 1.9}
        fill="transparent"
        onClick={onClick}
        /**
         * `.es-seat-hit` is what lets the focus ring be a CIRCLE.
         *
         * The global `:focus-visible` rule draws a 2px outline, and a browser
         * draws an outline around an SVG element's BOUNDING BOX — so tapping a
         * seat on a phone put a hard black rounded SQUARE around it, which is
         * the ugliest thing on the buying path and looked like a rendering
         * fault. The class swaps it for a ring drawn in SVG, on the seat's own
         * circle. See `.es-seat-hit` in globals.css: the outline is replaced,
         * never merely removed.
         */
        className="es-seat-hit"
        style={{ cursor: clickable ? 'pointer' : 'not-allowed' }}
        {...(clickable
          ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': `Seat ${number}, table ${tableLabel}${selected ? ', selected' : ''}`,
            'aria-pressed': selected,
          }
          : { 'aria-hidden': true })}
      />
      {/* THE SELECTED SEAT'S HALO, drawn behind the seat rather than on it.
          A thick stroke on the dot itself reads as a fatter dot; a soft ring
          standing off it reads as "this one is yours" at a glance, and it is
          what the map needed to look finished rather than diagrammatic. */}
      {selected && (
        <circle
          r={SEAT_RADIUS * 1.55}
          fill="none"
          stroke="var(--es-accent)"
          strokeWidth={1.5}
          opacity={0.35}
          style={{ pointerEvents: 'none' }}
        />
      )}
      <circle
        className="es-seat-dot"
        r={SEAT_RADIUS}
        fill={fill}
        // A ring as well as the dimming of everything else, so the picked-out
        // tier does not rely on a difference in brightness alone.
        stroke={selected || (inFocus && available) ? 'var(--es-accent)' : 'none'}
        strokeWidth={selected ? 2.5 : inFocus && available ? 1.5 : 0}
        // Sold and held seats are collapsed to one look on purpose: the API
        // reports only `available`, because whether a seat is held or sold is
        // our business and to a buyer both mean "not yours".
        opacity={dimmed || (outsideFocus && !selected) ? 0.3 : available || selected ? 1 : 0.45}
        style={{ pointerEvents: 'none', transition: 'fill 150ms var(--es-ease-default)' }}
      />
    </g>
  );
}
