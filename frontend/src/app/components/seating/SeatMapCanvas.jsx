'use client';

import { useEffect, useMemo } from 'react';
import {
  worldOf, SEAT_RADIUS, tableBody, seatPositions, toWorld, contentBounds, normaliseShape, tableScale, tableLabelSize,
} from './seatingGeometry';
import { usePanZoom } from './usePanZoom';
import { useBadgeScale } from './useBadgeScale';
import ZoneShape from './ZoneShape';
import { BoothDefs } from './BoothShape';
import MapGestureHint from './MapGestureHint';
import { SectionPlates, SectionBadges } from './MapOverlays';
import { paintOrder, zoneLabel } from './venueZones';
import { formatMoney } from '../../utils/money';
import TableBodyShape from './TableBodyShape';
import {
  inkOn, lookFont, tablePaint, CHAIR, CHAIR_EDGE, CHAIR_FADED_OPACITY,
} from './mapStyle';

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
  // { key, tierIds }: glide to the seats of these ticket types (see below).
  frameRequest = null,
  // The organizer's map look (mapStyle.readLook): floor, table and label
  // colours. Absent: the map's plain default.
  look = null,
  // Vendor booths become tappable (2026-11-23): the page shows the booth and,
  // while vendors are being taken, "Reserve this booth". Absent: scenery.
  onSelectBooth = null,
  // `(table) => colour | null`: the table's category or ticket-type colour
  // (venueModel.tableTint). Absent: tables take their own colour or the look.
  tableTint = null,
  // A PRIVATE TABLE (owner, 2026-11-24) is drawn for everyone, marked
  // Private, and pressing it — or any of its chairs — calls this with the
  // table so the page can ask for its password. A table the buyer has
  // unlocked arrives without `locked` and is chosen like any other.
  onLockedTable = null,
}) {
  const bounds = useMemo(() => contentBounds(tables, zones, world), [tables, zones, world]);
  const focusTiers = useMemo(
    () => (highlightTierIds?.size ? highlightTierIds : highlightTierId ? new Set([highlightTierId]) : null),
    [highlightTierIds, highlightTierId],
  );
  const {
    svgRef, view, fit, frameTo, zoomIn, zoomOut, wasDragged, handlers, hint, touchAction,
  } = usePanZoom(bounds);

  /**
   * "TAKE ME TO THESE SEATS" (owner, 2026-11-17). A ticked ticket category
   * used only dimmed the others, so a buyer still had to find its seats in a
   * room of a thousand. `frameRequest` ({ key, tierIds }) glides the map to the
   * tables holding seats of those types; a new `key` is a new request, and no
   * tier ids frames the whole room again.
   */
  const frameTiers = (ids) => {
    if (!ids || ids.size === 0) { frameTo(bounds); return; }
    const holding = new Set(seats.filter((s) => ids.has(s.tierId) && s.tableId).map((s) => s.tableId));
    const target = tables.filter((t) => holding.has(t.id));
    if (target.length === 0) return;
    frameTo(contentBounds(target, [], world));
  };
  /** The "Show these seats" button: the highlighted ticket types' seats. */
  const showFocused = () => frameTiers(focusTiers);
  useEffect(() => {
    if (!frameRequest) return;
    frameTiers(frameRequest.tierIds);
    // Only a new request moves the map — not every re-render of the seats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest?.key]);
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
    // Walls are the room's outline, not something to find; a hidden name is hidden.
    // Vendor booths are counted, not read out one code at a time.
    const named = zones.filter((z) => z.kind !== 'wall' && z.kind !== 'booth' && z.showLabel !== false);
    const booths = zones.filter((z) => z.kind === 'booth').length;
    const parts = [
      ...named.map(zoneLabel),
      ...(booths ? [`${booths} vendor booth${booths === 1 ? '' : 's'}`] : []),
    ];
    return parts.length ? parts.join(', ') : null;
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
        // `pan-x pan-y` (usePanZoom, cooperative touch, 2026-11-19): one
        // finger scrolls the page and taps seats, two fingers move the map.
        // It was `none`, and a swipe over the map trapped the page.
        style={{ touchAction, cursor: 'grab', ...(look?.floor ? { background: look.floor } : {}) }}
        role="group"
        aria-label="Seat map"
        {...handlers}
      >
        {/* ZONES FIRST. SVG has no z-index — paint order is the only thing
            keeping a dance floor from covering the seats around it. */}
        <BoothDefs />
        <SectionPlates plates={plates} />
        {paintOrder(zones).map((zone) => {
          const tappable = !!onSelectBooth && zone.kind === 'booth';
          return (
            <ZoneShape
              key={zone.id} zone={zone} showcase={showcase} world={world} look={look}
              interactive={tappable}
              onClick={tappable ? () => { if (!wasDragged()) onSelectBooth(zone); } : null}
            />
          );
        })}

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
            look={look}
            tint={tableTint ? tableTint(table) : null}
            onLockedTable={onLockedTable}
          />
        ))}
      </svg>
      <MapGestureHint hint={hint} />

      {/* "Show these seats" (2026-11-19). Ticking a ticket category used to
          glide the map there by itself (2026-11-17); the owner found a map
          that moves on its own annoying. It moves when this is pressed. */}
      {focusTiers && (
        <button type="button" className="es-mapfocus" onClick={() => showFocused()}>
          Show these seats
        </button>
      )}

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
        {canPickTables && tables.some((t) => t.canBookWhole) && (
          <>Tap a table to book the whole table{canPickSeats ? ', or tap seats to book them one by one' : ''}. </>
        )}
        {onLockedTable && tables.some((t) => t.locked) && (
          <>Tables marked Private need a password: tap one to enter it. </>
        )}
        Use + and − to zoom. Drag with the mouse, or with two fingers on a phone, to move around.
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
  canPickSeats, canPickTables, onSelectSeat, onSelectTable, wasDragged, currency, seatFill, pickAny, world, look,
  tint = null, onLockedTable = null,
}) {
  const pos = toWorld(table.position, world);
  const shape = normaliseShape(table.shape);
  const body = tableBody(shape, table.seatCount, table.style);
  const layout = seatPositions(shape, table.seatCount, table.style);
  const hasBody = body.kind !== 'none';
  // The table's colour (mapStyle.js, THE MAP'S COLOUR RULES): its own, then
  // its category's or ticket type's (`tint`), then the look's.
  const paint = tablePaint(table, look, { fill: tint });
  const font = lookFont(look);

  /**
   * PRIVATE, NOT HIDDEN (owner, 2026-11-24). A private table the buyer has
   * not unlocked is on the map like any other, marked Private, its chairs
   * faded. Pressing it asks for the password (`onLockedTable`); nothing at it
   * can be chosen until then, and the hold refuses it without the key anyway.
   */
  const locked = table.locked === true && !pickAny;
  const unlockable = locked && !!onLockedTable;
  // Nothing left to choose here — sold, held, or marked unavailable by the
  // organizer — so the whole table reads as out of play, not just its chairs.
  const allGone = hasBody && !locked && !pickAny && seats.length > 0 && seats.every((s) => !s.available)
    && !seats.some((s) => selectedSeatIds.has(s.id));

  // BRD §25 — a table and its seats are two views of ONE piece of stock. Once a
  // single seat sells individually the whole-table option closes, and the API
  // says so with `canBookWhole` rather than leaving it to be inferred.
  const wholeTableAvailable = canPickTables && table.canBookWhole && !locked;
  // Written under the name when the table can be booked whole and is big
  // enough to hold a second line (a high-top is not).
  const wholePrice = wholeTableAvailable && currency && table.priceCents !== null && table.priceCents !== undefined
    && body.width >= 44 && body.height >= 36
    ? (table.priceCents === 0 ? 'Free' : formatMoney(table.priceCents, currency))
    : null;
  const subline = locked ? 'Private' : wholePrice || (allGone && body.width >= 44 && body.height >= 36 ? 'Unavailable' : null);

  // A key press is never a drag, so it skips that guard. The flag is left set
  // by the last pointer gesture, and sharing the click path made Enter on a
  // seat do nothing after any pan of the map.
  const pressTable = (e) => {
    e.stopPropagation();
    if (unlockable) { onLockedTable(table); return; }
    if (!wholeTableAvailable) return;
    onSelectTable?.(table);
  };
  const handleTable = (e) => {
    if (wasDragged()) { e.stopPropagation(); return; }
    pressTable(e);
  };

  return (
    // scale(): the organizer's table size (tableScale) — seats, body and name
    // shrink or grow together, and the hit areas with them.
    <g transform={`translate(${pos.x} ${pos.y}) rotate(${pos.rotation}) scale(${tableScale(table.style)})`}>
      {hasBody && (
        <TableBody
          body={body}
          selected={isTableSelected}
          clickable={wholeTableAvailable || unlockable}
          locked={locked}
          faded={allGone}
          onClick={handleTable}
          onPress={pressTable}
          paint={paint}
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
        // A chair at a locked table opens the password prompt, like the table.
        const opensLock = unlockable && !!seat;
        /**
         * The colour (THE MAP'S COLOUR RULES). The organizer's holds view
         * (pickAny) paints availability and wins everywhere. A chair at a
         * table is black. A seat in a row carries its own colour, then its
         * category's or ticket type's, then the look's.
         */
        const chair = hasBody && !pickAny;
        const fill = pickAny
          ? (seat && seatFill ? seatFill(seat) : null)
          : chair
            ? null
            : available
              ? paint.seat || paint.tint || (seat && seatFill ? seatFill(seat) : null) || look?.seat || null
              : null;

        return (
          <Seat
            key={seat?.id || `${table.id}-${index}`}
            point={point}
            number={seat?.number ?? String(index + 1)}
            tableLabel={table.label}
            price={seatPrice(seat, currency)}
            available={available}
            reason={locked ? 'private' : seat?.reason || null}
            chair={chair}
            fill={fill}
            selected={selected}
            dimmed={isTableSelected}
            outsideFocus={Boolean(focusTiers && seat && !focusTiers.has(seat.tierId))}
            inFocus={Boolean(focusTiers && seat && focusTiers.has(seat.tierId))}
            faint={hideTaken && !available && !locked}
            clickable={Boolean((canPickSeats && pressable) || opensLock)}
            onClick={(e) => {
              e.stopPropagation();
              if (wasDragged()) return;
              if (opensLock) { onLockedTable(table); return; }
              if (!pressable) return;
              onSelectSeat?.(seat, table);
            }}
            onPress={(e) => {
              e.stopPropagation();
              if (opensLock) { onLockedTable(table); return; }
              if (!pressable) return;
              onSelectSeat?.(seat, table);
            }}
          />
        );
      })}

      {/* Drawn last so it sits above the seats, and non-interactive so it never
          swallows a tap meant for the seat underneath it. */}
      {hasBody && (
        <text
          // Upright whatever way the table is turned, as on a printed plan.
          transform={`translate(0 ${body.labelY || 0}) rotate(${-pos.rotation})`}
          y={subline ? -1 : 4}
          textAnchor="middle"
          className={isTableSelected || paint.label || paint.fill ? undefined : 'fill-ink'}
          fill={isTableSelected ? '#ffffff' : paint.label || inkOn(paint.fill) || undefined}
          style={{ fontSize: tableLabelSize(shape, body, table.style), fontWeight: font.fontWeight, fontFamily: font.fontFamily, pointerEvents: 'none' }}
        >
          {table.label}
          {/* THE WHOLE-TABLE PRICE, written on the table (owner, 2026-11-19:
              "how to sell whole table … and write whole table"). It was only
              in a hover tooltip, which a phone never shows, so nothing on the
              map said a table could be booked whole or what it cost. A
              private table says Private there instead (2026-11-24). */}
          {subline && (
            <tspan x={0} dy={13} style={{ fontSize: 9.5, fontWeight: 700 }}>{subline}</tspan>
          )}
        </text>
      )}

      {/* The lock, above the table and upright — what "Private" means at a
          glance, on a table too small to write the word on. */}
      {locked && (
        <g
          transform={`translate(0 ${hasBody ? -(body.height / 2) - SEAT_RADIUS * 2.6 : -SEAT_RADIUS * 2.4}) rotate(${-pos.rotation})`}
          style={{ pointerEvents: 'none' }}
          aria-hidden="true"
        >
          <LockBadge />
        </g>
      )}
    </g>
  );
}

/** A small round padlock badge, drawn in SVG (an emoji renders per platform). */
export function LockBadge({ r = 8.5 }) {
  return (
    <g>
      <circle r={r} fill={CHAIR} stroke={CHAIR_EDGE} strokeWidth={1.25} />
      <path d="M -2.6 -0.6 v -1.7 a 2.6 2.6 0 0 1 5.2 0 v 1.7" fill="none" stroke="#ffffff" strokeWidth={1.3} strokeLinecap="round" />
      <rect x={-3.6} y={-0.8} width={7.2} height={5} rx={1} fill="#ffffff" />
    </g>
  );
}

/**
 * Why a seat cannot be chosen, in a buyer's words (TECH-AUDIT-LOG S-07). The
 * public map now marks a seat unavailable for more than being held or sold —
 * its ticket type off sale or sold out — and "taken" would be untrue for those.
 */
export const UNAVAILABLE = {
  taken: 'taken', not_on_sale: 'not on sale', sold_out: 'sold out', private: 'private — needs the password',
};

/** The seat's price as text, or null when it is not known to this map. */
function seatPrice(seat, currency) {
  if (!seat || !currency || seat.priceCents === null || seat.priceCents === undefined) return null;
  return seat.priceCents === 0 ? 'Free' : formatMoney(seat.priceCents, currency);
}

function TableBody({
  body, selected, clickable, locked = false, faded = false, onClick, onPress, label, price, paint = {},
}) {
  // Selected is the accent, not the old near-black: the chairs round it are
  // black now, and a black table among black chairs was a hole in the map.
  const fill = selected ? 'var(--es-accent)' : paint.fill || 'var(--es-surface)';
  const stroke = selected ? 'var(--es-accent)' : paint.stroke || (paint.fill ? 'none' : 'var(--es-border-strong)');

  const common = {
    fill,
    stroke,
    strokeWidth: selected ? 3 : paint.strokeWidth ?? 1.5,
    // Faded, not recoloured: a private or sold table keeps its colour, so the
    // room's colour plan still reads; it simply steps back.
    opacity: faded ? 0.45 : locked ? 0.72 : 1,
    style: { cursor: clickable ? 'pointer' : 'default' },
    onClick,
    ...(clickable
      ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': locked
          ? `Private table ${label}. Enter its password to book it`
          : `Book table ${label} whole${price ? `, ${price}` : ''}`,
        ...(locked ? { 'aria-haspopup': 'dialog' } : { 'aria-pressed': selected }),
        onKeyDown: pressOnKey(onPress),
      }
      : { 'aria-hidden': true }),
  };
  const tip = locked
    ? <title>{`Table ${label} — private. Enter the password to book it.`}</title>
    : clickable ? <title>{`Table ${label} — book the whole table${price ? ` · ${price}` : ''}`}</title> : null;

  return <TableBodyShape body={body} {...common}>{tip}</TableBodyShape>;
}

function Seat({
  point, number, tableLabel, price, available, reason = null, chair = false, fill: paint, selected, dimmed, outsideFocus, inFocus, faint, clickable, onClick, onPress,
}) {
  // A chair at a table is always black (mapStyle.CHAIR); its state is the
  // ring and the fade. A seat in a row takes `paint` (its own, category,
  // ticket-type or look colour, or the organizer's availability view).
  const fill = chair
    ? CHAIR
    : selected
      ? 'var(--es-seat-selected)'
      : paint || (available
        ? 'var(--es-seat-available)'
        : 'var(--es-seat-sold)');
  const ring = selected || (inFocus && available);
  const opacity = faint ? (chair ? 0.1 : 0.14)
    : dimmed || (outsideFocus && !selected) ? 0.3
      : available || selected ? 1
        : chair ? CHAIR_FADED_OPACITY : 0.45;

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
            // A chair at a private table opens the password prompt, and says so.
            ...(reason === 'private'
              ? { 'aria-label': `Seat ${number}, private table ${tableLabel}. Enter its password to book`, 'aria-haspopup': 'dialog' }
              : { 'aria-label': `Seat ${number}, table ${tableLabel}${price ? `, ${price}` : ''}${selected ? ', selected' : ''}`, 'aria-pressed': selected }),
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
        // tier does not rely on a difference in brightness alone. A chair
        // carries a thin light edge otherwise, so black reads on a dark floor.
        stroke={ring ? 'var(--es-accent)' : chair ? CHAIR_EDGE : 'none'}
        strokeWidth={selected ? (chair ? 3 : 2.5) : ring ? 1.5 : chair ? 1 : 0}
        // Sold and held seats are collapsed to one look on purpose: the API
        // reports only `available`, because whether a seat is held or sold is
        // our business and to a buyer both mean "not yours".
        opacity={opacity}
        style={{ pointerEvents: 'none', transition: 'fill 150ms var(--es-ease-default)' }}
      />
    </g>
  );
}
