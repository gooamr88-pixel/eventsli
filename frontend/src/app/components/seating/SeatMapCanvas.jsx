'use client';

import { useMemo } from 'react';
import {
  WORLD, SEAT_RADIUS, tableBody, seatPositions, toWorld, contentBounds, normaliseShape,
} from './seatingGeometry';
import { usePanZoom } from './usePanZoom';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The seat map. One component, two callers: the buyer picks on it, and the
 * organizer's editor (phase 4) draws on the same geometry.
 *
 * Everything positional comes from seatingGeometry.js. Nothing here decides
 * where a seat goes — that is the point of the contract test.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SeatMapCanvas({
  tables = [],
  seats = [],
  selectedSeatIds = new Set(),
  selectedTableIds = new Set(),
  onSelectSeat,
  onSelectTable,
  purchaseMode = 'seat_only',
  className = '',
}) {
  const bounds = useMemo(() => contentBounds(tables), [tables]);
  const { svgRef, view, fit, zoomIn, zoomOut, wasDragged, handlers } = usePanZoom(bounds);

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
        className="block h-full w-full select-none rounded-[--es-radius-lg] border border-border-base bg-bg-sunken"
        // `touch-action: none` is what stops the browser scrolling the page
        // instead of panning the map. Without it a one-finger drag on a phone
        // scrolls past the map and the seats are unreachable.
        style={{ touchAction: 'none', overscrollBehavior: 'contain', cursor: 'grab' }}
        role="group"
        aria-label="Seat map"
        {...handlers}
      >
        {tables.map((table) => (
          <Table
            key={table.id}
            table={table}
            seats={seatsByTable.get(table.id) || []}
            selectedSeatIds={selectedSeatIds}
            isTableSelected={selectedTableIds.has(table.id)}
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
      className="grid h-10 w-10 place-items-center rounded-[--es-radius-md] border border-border-strong bg-surface text-lg text-ink shadow-sm transition-colors hover:bg-bg-sunken"
    >
      {children}
    </button>
  );
}

function Table({
  table, seats, selectedSeatIds, isTableSelected,
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

function Seat({ point, number, tableLabel, available, selected, dimmed, clickable, onClick }) {
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
      <circle
        r={SEAT_RADIUS}
        fill={fill}
        stroke={selected ? 'var(--es-accent)' : 'none'}
        strokeWidth={selected ? 2.5 : 0}
        // Sold and held seats are collapsed to one look on purpose: the API
        // reports only `available`, because whether a seat is held or sold is
        // our business and to a buyer both mean "not yours".
        opacity={dimmed ? 0.35 : available || selected ? 1 : 0.45}
        style={{ pointerEvents: 'none', transition: 'fill 150ms var(--es-ease-default)' }}
      />
    </g>
  );
}
