'use client';

import { useMemo } from 'react';
import {
  worldOf, SEAT_RADIUS, tableBody, seatPositions, toWorld, contentBounds, normaliseShape,
} from './seatingGeometry';
import { usePanZoom } from './usePanZoom';
import { useBadgeScale } from './useBadgeScale';
import ZoneShape from './ZoneShape';
import { SectionPlates, SectionBadges } from './MapOverlays';
import { zoneLabel } from './venueZones';
import { formatMoney } from '../../utils/money';

/**
 * Enter and Space press a focused SVG "button" (TECH-AUDIT-LOG T-035).
 *
 * The seats and table bodies carry role="button" and tabIndex, so a keyboard
 * reached them and a screen reader announced them as buttons — and then
 * nothing happened, because an SVG element fires no click for a key. A buyer
 * who cannot use a mouse could not choose a single seat.
 */
function pressOnKey(handler) {
  return (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    handler(e);
  };
}

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

/**
 * THE MAP OPENS FITTED, AT EVERY SIZE (owner, 2026-11-10).
 *
 * On a touch screen it used to open zoomed in on the stage end, so a seat was
 * big enough to tap first time — but a buyer opening the map could not see the
 * room, and section names grew into banners. Now every screen opens on the
 * whole venue, the way the owner wants it: see everything, then pinch or press
 * + to enlarge the part you want. The "−  100%  +" pill starts at 100%, which
 * is the whole room.
 */

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
  // Several tiers to pick out at once; wins over `highlightTierId`.
  highlightTierIds = null,
  // Taken seats drawn almost invisible, so the open ones stand out.
  hideTaken = false,
  // Section shapes drawn behind the seats: [{ key, d, color }] (world units).
  plates = NO_ZONES,
  // The buyer's zone look (ZoneShape); the editor and print keep outlines.
  showcase = false,
  onSelectSeat,
  onSelectTable,
  purchaseMode = 'seat_only',
  // For the price on each seat's label. Optional: the door-sales map passes
  // none, and a seat without a known price simply does not state one.
  currency = null,
  // Venue Studio additions, all optional: `seatFill(seat)` colours a seat,
  // `badges` name sections, `pickAny` lets a taken seat be pressed (holds).
  seatFill = null,
  badges = NO_ZONES,
  pickAny = false,
  // The map's world (seatingGeometry.worldOf of the layout). Absent: the default.
  world = worldOf(null),
  className = '',
}) {
  const bounds = useMemo(() => contentBounds(tables, zones, world), [tables, zones, world]);
  const focusTiers = useMemo(
    () => (highlightTierIds?.size ? highlightTierIds : highlightTierId ? new Set([highlightTierId]) : null),
    [highlightTierIds, highlightTierId],
  );
  const {
    svgRef, view, fit, zoomIn, zoomOut, wasDragged, handlers,
  } = usePanZoom(bounds);
  // Section names capped at a readable size on screen (useBadgeScale.js).
  const badgeScale = useBadgeScale(svgRef, view, world);

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
    // The caption is a SIBLING of the sized box, not a child. Inside it, a box
    // with a fixed height (the caller's className) pushed the line out of the
    // bottom of the map, where the frame clipped it — the zones sentence had
    // been half-hidden that way since it was written.
    <div className="fx-stack fx-stack--sm gap-2">
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
        <SectionPlates plates={plates} />
        {zones.map((zone) => <ZoneShape key={zone.id} zone={zone} showcase={showcase} world={world} />)}

        {/* SECTION NAMES UNDER THE SEATS (owner, 2026-11-10). Drawn on top, a
            dark pill at each section's centre hid the seats beneath it, and a
            buyer read the gap as "no seats here". Under them, every seat stays
            visible and tappable and the name shows through the gaps, like a
            label painted on the floor. */}
        <SectionBadges badges={badges} scale={badgeScale} under />

        {tables.map((table) => (
          <Table
            key={table.id}
            table={table}
            seats={seatsByTable.get(table.id) || []}
            selectedSeatIds={selectedSeatIds}
            isTableSelected={selectedTableIds.has(table.id)}
            focusTiers={focusTiers}
            hideTaken={hideTaken}
            canPickSeats={canPickSeats}
            canPickTables={canPickTables}
            onSelectSeat={onSelectSeat}
            onSelectTable={onSelectTable}
            wasDragged={wasDragged}
            currency={currency}
            seatFill={seatFill}
            pickAny={pickAny}
            world={world}
          />
        ))}
      </svg>

      {/* TOP corner, not bottom. On the buyer's page the selection bar is
          sticky at the bottom of the screen and covered zoom-out and fit —
          the two controls somebody needs after zooming in to choose. */}
      {/* As in the owner's mockup (2026-11-10): one "− 100% +" pill and the
          fit button beside it, rather than a column of three squares. The
          percentage is the whole room = 100%, the same scale the editor uses. */}
      <div className="es-mapzoom">
        <div className="es-mapzoom__pill">
          <MapButton onClick={zoomOut} label="Zoom out">−</MapButton>
          <span className="es-mapzoom__pct es-nums" aria-live="polite">{Math.round((bounds.width / Math.max(view.width, 1)) * 100)}%</span>
          <MapButton onClick={zoomIn} label="Zoom in">+</MapButton>
        </div>
        <MapButton onClick={fit} label="Fit the whole map" boxed>⤢</MapButton>
      </div>
    </div>

      {/* How to move around, said once. Nothing on the map said it could be
          zoomed, and a phone opened it too small to choose from. */}
      <p className="text-xs text-subtle">
        Pinch or use + and − to zoom, and drag to move around.
        {/* For screen readers only (2026-11-10): drawn, the zones are on the
            map for everyone else, and as visible text they were a run-on
            sentence of twenty names under every map. */}
        {zoneSummary && <span className="sr-only"> Also on this map: {zoneSummary}.</span>}
      </p>
    </div>
  );
}

function MapButton({ onClick, label, boxed = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // 40px is not arbitrary: it is the smallest square a thumb hits reliably,
      // and these sit in the corner a right hand covers while panning. Inside
      // the pill they lose their own border; `boxed` is the lone fit button.
      className={`grid h-10 w-10 place-items-center rounded-(--es-radius-md) text-lg text-ink transition-colors hover:bg-bg-sunken ${boxed ? 'border border-border-strong bg-surface shadow-sm' : 'bg-transparent'}`}
    >
      {children}
    </button>
  );
}

function Table({
  table, seats, selectedSeatIds, isTableSelected, focusTiers, hideTaken,
  canPickSeats, canPickTables, onSelectSeat, onSelectTable, wasDragged, currency, seatFill, pickAny, world,
}) {
  const pos = toWorld(table.position, world);
  const shape = normaliseShape(table.shape);
  const body = tableBody(shape, table.seatCount);
  const layout = seatPositions(shape, table.seatCount);

  // BRD §25 — a table and its seats are two views of ONE piece of stock. Once a
  // single seat sells individually the whole-table option closes, and the API
  // says so with `canBookWhole` rather than leaving it to be inferred.
  const wholeTableAvailable = canPickTables && table.canBookWhole;

  // A key press is never a drag, so it skips that guard. The flag is left set
  // by the last pointer gesture, and sharing the click path made Enter on a
  // seat do nothing after any pan of the map.
  const pressTable = (e) => {
    e.stopPropagation();
    if (!wholeTableAvailable) return;
    onSelectTable?.(table);
  };
  const handleTable = (e) => {
    if (wasDragged()) { e.stopPropagation(); return; }
    pressTable(e);
  };

  return (
    <g transform={`translate(${pos.x} ${pos.y}) rotate(${pos.rotation})`}>
      {body.kind !== 'none' && (
        <TableBody
          body={body}
          selected={isTableSelected}
          clickable={wholeTableAvailable}
          onClick={handleTable}
          onPress={pressTable}
          label={table.label}
          price={currency && table.priceCents !== null && table.priceCents !== undefined
            ? formatMoney(table.priceCents, currency) : null}
        />
      )}

      {layout.map((point, index) => {
        const seat = seats[index];
        // A table whose seat rows have not loaded, or a seat count that changed
        // under a cached map. Drawing the empty position keeps the table's
        // shape honest rather than showing a gap-toothed ring.
        const available = seat ? seat.available : false;
        const selected = seat ? selectedSeatIds.has(seat.id) : false;
        const pressable = seat && (available || pickAny) && !isTableSelected;

        return (
          <Seat
            key={seat?.id || `${table.id}-${index}`}
            point={point}
            number={seat?.number ?? String(index + 1)}
            tableLabel={table.label}
            price={seatPrice(seat, currency)}
            available={available}
            reason={seat?.reason || null}
            fill={seat && seatFill ? seatFill(seat) : null}
            selected={selected}
            dimmed={isTableSelected}
            outsideFocus={Boolean(focusTiers && seat && !focusTiers.has(seat.tierId))}
            inFocus={Boolean(focusTiers && seat && focusTiers.has(seat.tierId))}
            faint={hideTaken && !available}
            clickable={Boolean(canPickSeats && pressable)}
            onClick={(e) => {
              e.stopPropagation();
              if (wasDragged() || !pressable) return;
              onSelectSeat?.(seat, table);
            }}
            onPress={(e) => {
              e.stopPropagation();
              if (!pressable) return;
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

/**
 * Why a seat cannot be chosen, in a buyer's words (TECH-AUDIT-LOG S-07). The
 * public map now marks a seat unavailable for more than being held or sold —
 * its ticket type off sale or sold out — and "taken" would be untrue for those.
 */
export const UNAVAILABLE = { taken: 'taken', not_on_sale: 'not on sale', sold_out: 'sold out' };

/** The seat's price as text, or null when it is not known to this map. */
function seatPrice(seat, currency) {
  if (!seat || !currency || seat.priceCents === null || seat.priceCents === undefined) return null;
  return seat.priceCents === 0 ? 'Free' : formatMoney(seat.priceCents, currency);
}

function TableBody({ body, selected, clickable, onClick, onPress, label, price }) {
  const fill = selected ? 'var(--es-seat-selected)' : 'var(--es-surface)';
  const stroke = selected ? 'var(--es-accent)' : 'var(--es-border-strong)';

  const common = {
    fill,
    stroke,
    strokeWidth: selected ? 3 : 1.5,
    style: { cursor: clickable ? 'pointer' : 'default' },
    onClick,
    ...(clickable
      ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': `Book table ${label} whole${price ? `, ${price}` : ''}`,
        'aria-pressed': selected,
        onKeyDown: pressOnKey(onPress),
      }
      : { 'aria-hidden': true }),
  };
  const tip = clickable ? <title>{`Table ${label} — book the whole table${price ? ` · ${price}` : ''}`}</title> : null;

  if (body.kind === 'ellipse') {
    return <ellipse rx={body.width / 2} ry={body.height / 2} {...common}>{tip}</ellipse>;
  }
  return (
    <rect
      x={-body.width / 2}
      y={-body.height / 2}
      width={body.width}
      height={body.height}
      rx={body.rx}
      {...common}
    >
      {tip}
    </rect>
  );
}

function Seat({
  point, number, tableLabel, price, available, reason = null, fill: paint, selected, dimmed, outsideFocus, inFocus, faint, clickable, onClick, onPress,
}) {
  // `paint` (seatFill) colours an available seat; an organizer's availability
  // view also paints unavailable ones, so it wins there too when given.
  const fill = selected
    ? 'var(--es-seat-selected)'
    : paint || (available
      ? 'var(--es-seat-available)'
      : 'var(--es-seat-sold)');

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
            'aria-label': `Seat ${number}, table ${tableLabel}${price ? `, ${price}` : ''}${selected ? ', selected' : ''}`,
            'aria-pressed': selected,
            onKeyDown: pressOnKey(onPress),
          }
          : { 'aria-hidden': true })}
      >
        {/* The price on hover. Seats of every ticket type look alike, so
            without this a buyer had to select a seat to learn what it cost. */}
        <title>
          {`Table ${tableLabel} · seat ${number}${available || selected ? (price ? ` · ${price}` : '') : ` · ${UNAVAILABLE[reason] || 'taken'}`}`}
        </title>
      </circle>
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
        opacity={faint ? 0.14 : dimmed || (outsideFocus && !selected) ? 0.3 : available || selected ? 1 : 0.45}
        style={{ pointerEvents: 'none', transition: 'fill 150ms var(--es-ease-default)' }}
      />
    </g>
  );
}
