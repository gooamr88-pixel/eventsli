'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import VenueExperience from '../../../components/venue/VenueExperience';
import { readStudio, sectionIndex, tierPalette } from '../../../components/venue/venueModel';
import { readZones } from '../../../components/seating/layoutZones';
import { boothsToZones } from '../../../components/seating/boothZones';
import { worldOf } from '../../../components/seating/seatingGeometry';
import UnlockTableDialog from './UnlockTableDialog';
import { get } from '../../../utils/apiClient';
import { describeError, isSelectionLost } from '../../../utils/errors';
import { useReservation, TABLE_ACCESS_HEADER } from '../../../hooks/useReservation';
import { useTableAccess } from './useTableAccess';
import SeatMapSkeleton, { MAP_FRAME, MAP_BOX } from './SeatMapSkeleton';
import SelectionBar from './SelectionBar';
import ExtrasList from '../tickets/ExtrasList';
import { useExtras, attachExtras } from '../tickets/useExtras';
import { TicketCategories, Basket, CategoryChips, TrustCard } from './SeatSidePanels';
import VenueInfoCard from '../../../components/venue/VenueInfoCard';
import TierDetailsDialog, { hasDetails } from '../../../components/tickets/TierDetailsDialog';
import { pickSeats } from './pickSeats';
import { cartItemFor, withMyHolds, selectionFromCart } from './cartSeats';
import { useCart, refreshCart } from '../../../hooks/useCart';
import { useToast } from '../../../components/ui/Toast';
import BoothPickCard from '../../../components/vendors/BoothPickCard';

/**
 * The buyer's half of the seat map: selection, the private-table gate, and the
 * hold that turns a selection into 35 minutes of exclusivity.
 *
 * Nothing here prices anything. The running total shown while choosing is the
 * SUM OF SEAT PRICES and is labelled as such — the real total comes back from
 * the quote after the hold, with tax and fees the client is in no position to
 * compute.
 */
export default function SeatPicker({
  slug, currency, purchaseMode, maxPerOrder, payments = null, addons = [], organizerName = null,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hold } = useReservation();
  const toast = useToast();
  const { header: accessHeader, add: addTableToken } = useTableAccess(slug);

  /**
   * PRIVATE TABLES ARE ON THE MAP (owner, 2026-11-24), marked Private and
   * locked until their password is entered. Pressing one — or any of its
   * chairs — opens the password prompt (`unlockFor`). The organizer's
   * invitation link (`?table=<id>`) still opens it for that table straight
   * away. See useTableAccess.js for how the key travels.
   */
  const invitedTableId = searchParams.get('table');
  const tierParam = searchParams.get('tier');

  const [rawMap, setMap] = useState(null);
  const [showAllTiers, setShowAllTiers] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [selectedSeats, setSelectedSeats] = useState([]);
  // A vendor booth tapped on the map (2026-11-23): shown under it, with
  // "Reserve this booth" while the event is taking vendors (BoothPickCard).
  const [pickedBooth, setPickedBooth] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [unlockDismissed, setUnlockDismissed] = useState(false);
  // A private table the buyer pressed on the map: { id, label }.
  const [unlockFor, setUnlockFor] = useState(null);
  // What the password interrupted (2026-11-24): { tableId, seatId }. Chosen
  // as soon as the map comes back with that table unlocked — one step, not
  // "unlock, then find the seat again and tap it".
  const [pendingPick, setPendingPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  /**
   * THE CART (2026-11-17). If this event is already in the buyer's cart, its
   * seats are drawn as theirs and the page starts with them selected — so
   * "Update cart" can add seats or drop some (cartSeats.js). Everything below
   * reads `map`, which is the server's map with that one adjustment.
   */
  const { items: cartItems, count: cartCount } = useCart();
  const cartItem = cartItemFor(cartItems, slug);
  const map = useMemo(() => withMyHolds(rawMap, cartItem), [rawMap, cartItem]);
  const [seededFor, setSeededFor] = useState(null);
  if (map && cartItem && seededFor !== cartItem.reservationId) {
    setSeededFor(cartItem.reservationId);
    if (selectedSeats.length === 0 && !selectedTable) {
      const start = selectionFromCart(map, cartItem);
      setSelectedSeats(start.seats);
      setSelectedTable(start.table);
    }
  }

  const loadMap = useCallback(async () => {
    try {
      const data = await get(`/public/events/${encodeURIComponent(slug)}/seat-map`, {
        // Never cached, at any layer. Availability is the whole payload.
        cache: 'no-store',
        noRedirect: true,
        headers: accessHeader ? { [TABLE_ACCESS_HEADER]: accessHeader } : undefined,
      });
      setMap(data);
      setLoadError(null);
      return data;
    } catch (err) {
      setLoadError(err);
      return null;
    }
  }, [slug, accessHeader]);

  /**
   * The fetch is inlined rather than written as `loadMap()` so every setState
   * lands after an await — React 19 rejects a synchronous setState in an effect
   * body, and it is right to: that is a render the component immediately throws
   * away.
   *
   * It re-runs when a table key is added, which is what makes an unlocked table
   * appear: the server decides visibility from the header, so the map has to be
   * asked again rather than patched locally.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get(`/public/events/${encodeURIComponent(slug)}/seat-map`, {
          cache: 'no-store',
          noRedirect: true,
          headers: accessHeader ? { [TABLE_ACCESS_HEADER]: accessHeader } : undefined,
        });
        if (!cancelled) { setMap(data); setLoadError(null); }
      } catch (err) {
        if (!cancelled) setLoadError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, accessHeader]);

  // The dialog opens when an invitation link names a table this session has no
  // key for yet, and stays closed once the map comes back with it unlocked.
  const invitedTable = invitedTableId ? map?.tables?.find((t) => t.id === invitedTableId) || null : null;
  const invitedUnlocked = Boolean(invitedTable && !invitedTable.locked);
  const showInvite = Boolean(invitedTableId) && !invitedUnlocked && !unlockDismissed && Boolean(map);
  // A table pressed on the map wins over the link; it closes once unlocked.
  const pressedLocked = unlockFor ? map?.tables?.find((t) => t.id === unlockFor.id) : null;
  const unlockTarget = unlockFor && pressedLocked?.locked !== false
    ? unlockFor
    : showInvite ? { id: invitedTableId, label: invitedTable?.label || null } : null;

  const seatById = useMemo(
    () => new Map((map?.seats || []).map((s) => [s.id, s])),
    [map],
  );

  /**
   * The venue's furniture — stage, bar, dance floor — read out of the map's
   * layout blob.
   *
   * Parsed rather than trusted: `layout_json` has no schema behind it, so
   * `readZones` drops anything it cannot draw. That matters more here than in
   * the editor. This is the buyer's page, and a malformed zone that reached a
   * renderer would take down the map somebody is trying to buy from.
   */
  const zones = useMemo(() => {
    const base = readZones(map?.map?.layout);
    // Vendor booths drawn on this map (2026-11-22, boothZones.js): where the
    // stands are, beside the seats — scenery to a buyer, never selectable.
    const vb = map?.vendorBooths;
    if (!vb?.plan) return base;
    const booths = boothsToZones(vb.plan, worldOf(map?.map?.layout), {
      withState: { states: vb.booths || {}, boothTypes: vb.boothTypes || [] },
    });
    return [...base, ...booths];
  }, [map]);

  // Section names and ticket-type colours: the same ones every view draws.
  const sections = useMemo(() => sectionIndex(readStudio(map?.map?.layout).sections), [map]);
  const palette = useMemo(() => tierPalette(map?.tiers, map?.seats), [map]);
  const tableLabels = useMemo(() => new Map((map?.tables || []).map((t) => [t.id, t.label])), [map]);
  /**
   * A seat of a section row is ADDRESSED by its section and row (S-19): its
   * own `section` differs from its table's label. An older map, saved before
   * that, still says (label, 'A'), so the Studio's sections are the fallback,
   * looked up by the TABLE's label.
   */
  const nameFor = useCallback((seat) => {
    const label = tableLabels.get(seat.tableId);
    if (seat.section && label && seat.section !== label) {
      return `Section ${seat.section} · Row ${seat.row} · Seat ${seat.number}`;
    }
    const where = sections.get(label) || sections.get(seat.section);
    return where ? `Section ${where.section} · Row ${where.row} · Seat ${seat.number}` : null;
  }, [sections, tableLabels]);

  /**
   * `?tier=` — the buyer followed a ticket-type link from the organizer's
   * Share & QR. Only a tier that is in THIS map's payload counts; anything else
   * is ignored. Its seats stay bright and every other seat is dimmed, but
   * nothing is made unselectable: the link is a pointer, not a restriction.
   */
  const focusTier = tierParam ? (map?.tiers || []).find((t) => t.id === tierParam) || null : null;

  /**
   * WHAT EACH KIND OF SEAT COSTS, said on the page.
   *
   * Every seat is drawn in the same colour whatever its ticket type, so a room
   * of $120 VIP seats and $50 standard ones looked uniform, and the only way to
   * learn a price was to select a seat and read the bar. The legend lists the
   * types that have seats on THIS map, with their price, and pressing one
   * picks its seats out with the same dimming a `?tier=` link uses.
   */
  // Categories the buyer ticked to pick out (none ticked shows every seat),
  // and whether taken seats are drawn at all.
  const [pickedTiers, setPickedTiers] = useState(() => new Set());
  const [showTaken, setShowTaken] = useState(true);
  /**
   * Ticking a category brightens its seats and dims the rest. It does NOT move
   * the map or scroll the page any more (owner, 2026-11-19: a map that moves
   * by itself is annoying); "Show these seats" on the map takes the buyer
   * there when they ask. The 2026-11-17 version glided there on every tick.
   */
  const togglePickedTier = (id) => {
    const next = new Set(pickedTiers);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPickedTiers(next);
  };
  const priceGuide = useMemo(() => {
    const byTier = new Map();
    for (const seat of map?.seats || []) {
      if (!seat.tierId) continue;
      const entry = byTier.get(seat.tierId) || { min: Infinity, max: -Infinity, free: 0 };
      if (seat.priceCents !== null && seat.priceCents !== undefined) {
        entry.min = Math.min(entry.min, seat.priceCents);
        entry.max = Math.max(entry.max, seat.priceCents);
      }
      if (seat.available) entry.free += 1;
      byTier.set(seat.tierId, entry);
    }
    return (map?.tiers || [])
      .filter((t) => byTier.has(t.id))
      .map((t) => ({ ...t, ...byTier.get(t.id) }))
      .sort((a, b) => b.max - a.max);
  }, [map]);

  const highlightTierIds = useMemo(() => {
    if (pickedTiers.size) return pickedTiers;
    return focusTier && !showAllTiers ? new Set([focusTier.id]) : null;
  }, [pickedTiers, focusTier, showAllTiers]);

  const selectedIds = useMemo(() => new Set(selectedSeats.map((s) => s.id)), [selectedSeats]);
  const selectedTableIds = useMemo(
    () => new Set(selectedTable ? [selectedTable.id] : []),
    [selectedTable],
  );

  /**
   * THE TICKET TYPE'S DETAILS CARD (owner request 2026-11-10).
   *
   * Opened from "What's included" beside a category, or — when the organizer
   * ticked "show before buying" — by the first tap on one of that type's seats,
   * once per visit. Its "Add to cart" asks for N tickets; `pickSeats` turns
   * that into N seats side by side (beside the tapped one, when there is one),
   * which land in the same selection a tap would, to be checked or changed.
   */
  const [details, setDetails] = useState(null);          // { tierId, anchor }
  const openDetails = (tierId, anchor = null) => { setActionError(null); setDetails({ tierId, anchor }); };

  const toggleSeat = useCallback((seat) => {
    setActionError(null);
    setSelectedTable(null);

    // Read from state rather than from an updater callback. An updater must be
    // pure — React calls it twice in development to prove that it is — so a
    // setState inside one fires twice and, worse, is a state update happening
    // during a state update.
    if (selectedSeats.some((s) => s.id === seat.id)) {
      setSelectedSeats(selectedSeats.filter((s) => s.id !== seat.id));
      return;
    }

    const seatTier = (map?.tiers || []).find((t) => t.id === seat.tierId);
    // Every tap, until a seat of this type is in the selection. It used to
    // open once per visit, so a buyer who closed it could not get it back
    // (owner, 2026-11-10: "it open one only").
    if (seatTier?.details?.showBeforeBuying && hasDetails(seatTier)
      && !selectedSeats.some((s) => s.tierId === seatTier.id)) {
      setDetails({ tierId: seatTier.id, anchor: seat });
      return;
    }

    // BRD §11. Refused here as well as by the API, because being told at the
    // hold that the eleventh seat was one too many means re-picking all ten.
    if (selectedSeats.length >= maxPerOrder) {
      setActionError({ code: 'PURCHASE_LIMIT_EXCEEDED' });
      return;
    }
    // A ticket type's own limit, which the hold now enforces too (S-06).
    const cap = (map?.tiers || []).find((t) => t.id === seat.tierId)?.maxPerOrder;
    if (cap && selectedSeats.filter((s) => s.tierId === seat.tierId).length >= cap) {
      setActionError({ code: 'PURCHASE_LIMIT_EXCEEDED' });
      return;
    }

    setSelectedSeats([...selectedSeats, seat]);
  }, [selectedSeats, maxPerOrder, map]);

  const chooseTable = useCallback((table) => {
    setActionError(null);
    setSelectedSeats([]);
    setSelectedTable((current) => (current?.id === table.id ? null : table));
  }, []);

  // THE TAP THE PASSWORD INTERRUPTED, finished (2026-11-24). Adjusted during
  // render, React's way to respond to new data: once the refetched map has
  // the table unlocked, its tapped seat (or, sold by the table, the table) is
  // chosen, through the same rules as any tap — limits, details card and all.
  if (pendingPick && map) {
    const unlocked = (map.tables || []).find((t) => t.id === pendingPick.tableId);
    if (!unlocked || !unlocked.locked) {
      setPendingPick(null);
      const seat = unlocked && pendingPick.seatId ? (map.seats || []).find((s) => s.id === pendingPick.seatId) : null;
      if (unlocked && purchaseMode === 'table_only') {
        if (unlocked.canBookWhole && selectedTable?.id !== unlocked.id) chooseTable(unlocked);
      } else if (seat?.available && !selectedSeats.some((s) => s.id === seat.id)) {
        toggleSeat(seat);
      }
    }
  }

  const subtotal = useMemo(() => {
    if (selectedTable) return selectedTable.priceCents ?? null;
    return selectedSeats.reduce((sum, s) => {
      const price = seatById.get(s.id)?.priceCents;
      // One unpriced seat makes the whole running total a guess, so it becomes
      // null rather than silently counting as free.
      return sum === null || price === null || price === undefined ? null : sum + price;
    }, 0);
  }, [selectedSeats, selectedTable, seatById]);

  const count = selectedTable ? (selectedTable.seatCount || 1) : selectedSeats.length;
  // The add-ons, chosen with the seats before checkout (owner, 2026-11-22).
  const extras = useExtras(addons, count);
  const total = subtotal === null ? null : subtotal + extras.cents;

  /**
   * HOLD, INTO THE CART — then stay (`cart`) or go straight to paying (`checkout`).
   *
   * The whole selection is sent; with this event already in the cart it
   * REPLACES that hold (the server releases the old one in the same request),
   * so the cart always holds exactly what the map shows as selected.
   */
  async function onContinue(mode = 'checkout') {
    setBusy(true);
    setActionError(null);
    try {
      // The keys gate the PURCHASE as well as the map — a whole private table
      // and a seat at one alike, so they go with both (TECH-AUDIT-LOG S-01).
      // Sending the whole header covers two invitations in one session; the
      // API works out which one applies.
      const reservation = await hold(slug, selectedTable
        ? { tableId: selectedTable.id, tableToken: accessHeader }
        : { seatIds: selectedSeats.map((s) => s.id), tableToken: accessHeader },
      { replaces: cartItem ? { reservationId: cartItem.reservationId, reservationToken: cartItem.reservationToken } : null });
      await attachExtras(reservation, extras.lines);

      if (mode === 'cart') {
        toast.success(cartItem ? 'Your cart is updated. The seats are held for you.' : 'Added to your cart. The seats are held for you.', {
          title: cartItem ? 'Cart updated' : 'Added to cart',
        });
        setSeededFor(reservation.reservationId);
        await Promise.all([loadMap(), refreshCart()]);
        setBusy(false);
        return;
      }
      router.push(`/checkout/${reservation.reservationId}`);
    } catch (err) {
      // A refused replace put the original hold back; the cart shows it again.
      if (err?.meta?.restored) refreshCart();
      setActionError(err);
      // Someone else took a seat between the render and the hold. The map on
      // screen is now a lie, so it is reloaded and the selection dropped —
      // leaving the old selection highlighted would invite a second attempt at
      // exactly the seats that just failed.
      if (isSelectionLost(err?.code)) {
        setSelectedSeats([]);
        setSelectedTable(null);
        await loadMap();
      }
      setBusy(false);
    }
  }

  if (loadError) {
    const { title, recovery } = describeError(loadError);
    return (
      <Panel tone="danger">
        <p className="font-medium text-ink">{title}</p>
        <p className="text-sm text-muted">{recovery}</p>
        <button type="button" onClick={loadMap} className="mt-3 text-sm text-accent">
          Try again
        </button>
      </Panel>
    );
  }

  // Waiting for the map, in the shape of the map — same frame, same height, so
  // the arrival fills the box rather than redrawing it. `SeatMapSkeleton.jsx`
  // owns `MAP_FRAME` and `MAP_BOX` and argues why all three states read them
  // from one place.
  if (!map) {
    return (
      <div className="fx-stack">
        <SeatMapSkeleton />
      </div>
    );
  }

  /**
   * No map at all, or a map with nothing on it a buyer can see.
   *
   * "Nothing visible" is NOT "no map" when every table is private: a gala of
   * invitation-only tables returned zero visible tables, so the buyer holding
   * a perfectly good invitation link was told the event had no seat map, and
   * the unlock dialog — rendered further down — was never reached.
   */
  if (!map.map || (map.tables.length === 0 && !(map.hiddenTableCount > 0))) {
    /**
     * A WAY OUT, not just a statement.
     *
     * This branch said "This event has no seat map yet." and nothing else — no
     * link, no button, nothing. The page it sits on is reached from the two
     * payment-failure screens, so a buyer could arrive here straight from a
     * declined card and find a sentence with no way forward.
     *
     * A general-admission event is now redirected to the ticket picker before
     * this component ever mounts (see the page's own note), so reaching this is
     * a reserved event whose organizer has not drawn the room yet. Either way
     * the event page is where the reader can find out what IS on offer.
     */
    return (
      <Panel>
        <div className="fx-stack fx-stack--sm items-start">
          <p className="text-muted">
            This event has no seat map yet, so seats cannot be chosen here.
          </p>
          <Link href={`/e/${slug}`} className="es-btn es-btn--primary">
            Back to the event
          </Link>
        </div>
      </Panel>
    );
  }

  const studio = readStudio(map.map?.layout);
  const tierOf = (seat) => {
    const tier = (map.tiers || []).find((t) => t.id === seat.tierId);
    return tier ? { name: tier.name, color: palette.get(tier.id) } : null;
  };
  const clear = () => { setSelectedSeats([]); setSelectedTable(null); setActionError(null); };

  // The open details card, and the most it may add: seats of its type still
  // free, its own per-order cap, and the event's cap — net of what is chosen.
  const detailTier = details ? priceGuide.find((t) => t.id === details.tierId)
    || (map.tiers || []).find((t) => t.id === details.tierId) : null;
  let detailMax = 0;
  let detailUnavailable = null;
  /**
   * A SEAT TAPPED AT A TABLE BUYS AT THAT TABLE (owner, 2026-11-17). The most
   * the card offers is the free seats of this type at THAT table — not every
   * free seat of the type in the room, which let a buyer ask for ten at a
   * table with five left and have the rest land at other tables (pickSeats
   * now stays at the table, and this keeps the stepper honest about it).
   */
  const anchorTable = details?.anchor?.tableId
    ? (map.tables || []).find((t) => t.id === details.anchor.tableId) || { id: details.anchor.tableId }
    : null;
  let tableLeft = null;
  if (detailTier) {
    const base = selectedTable ? [] : selectedSeats;
    const mine = base.filter((s) => s.tierId === detailTier.id).length;
    const free = Math.max(0, (detailTier.free ?? 0) - mine);
    const ownCap = detailTier.maxPerOrder ? detailTier.maxPerOrder - mine : Infinity;
    if (anchorTable) {
      const chosen = new Set(base.map((s) => s.id));
      tableLeft = (map.seats || []).filter((s) => s.tableId === anchorTable.id && s.tierId === detailTier.id
        && s.available && !chosen.has(s.id)).length;
    }
    detailMax = Math.max(0, Math.min(free, ownCap, maxPerOrder - base.length, tableLeft ?? Infinity));
    if (detailTier.soldOut || free === 0) detailUnavailable = 'Sold out — every seat of this type is taken.';
    else if (detailTier.onSale === false) detailUnavailable = 'Not on sale right now.';
    else if (tableLeft === 0) detailUnavailable = 'Every seat at this table is taken. Choose another table on the map.';
    else if (detailMax === 0) detailUnavailable = `You already have the most allowed in one order (${maxPerOrder}).`;
  }
  // "VIP 3" reads as a name already; a bare "4" needs the word "table".
  const tableName = !anchorTable?.label ? 'this table'
    : /table|^vip|[a-z]{3,}/i.test(anchorTable.label) ? anchorTable.label : `table ${anchorTable.label}`;
  const detailFootnote = anchorTable
    ? `${tableLeft} ${tableLeft === 1 ? 'seat is' : 'seats are'} free at ${tableName}. Starting with the seat you tapped — you can change them on the map.`
    : details?.anchor
      ? 'Starting with the seat you tapped, then the seats beside it. You can change them on the map.'
      : 'We pick the best seats side by side. You can change them on the map before checkout.';
  const closeDetails = () => setDetails(null);
  const addFromDetails = (qty) => {
    const base = selectedTable ? [] : selectedSeats;
    const picked = pickSeats(map.seats, detailTier.id, qty, new Set(base.map((s) => s.id)), details.anchor);
    setSelectedTable(null);
    setSelectedSeats([...base, ...picked]);
    setDetails(null);
    // Fewer than asked only when seats went between render and click: the
    // card's maximum is the free count. Said in the words a lost seat gets.
    setActionError(picked.length < qty ? { code: 'SEAT_UNAVAILABLE' } : null);
  };

  /**
   * THREE COLUMNS ON A WIDE SCREEN (2026-11-09): categories and the venue on
   * the left, the room in the middle, the basket on the right — every fact a
   * buyer weighs while choosing, in view while they choose. Below `xl` it is
   * one column: category chips above the map and the sticky SelectionBar.
   */
  return (
    <div className="es-seatpage">
      <aside className="es-seatpage__side" aria-label="Ticket categories and venue">
        {priceGuide.length > 0 && (
          <TicketCategories
            tiers={priceGuide} palette={palette} currency={currency}
            picked={pickedTiers} onToggle={togglePickedTier}
            showTaken={showTaken} onShowTaken={setShowTaken}
            onDetails={(id) => openDetails(id)}
          />
        )}
        <VenueInfoCard venue={studio.venue} tables={map.tables} zones={zones} />
      </aside>

      <div className="es-seatpage__main fx-stack">
        {focusTier && (
          <div className="es-notice es-notice--info fx-row fx-row--between" role="status">
            <span className="fx-min0">
              {showAllTiers
                ? <>Showing every seat. You came here for <strong>{focusTier.name}</strong>.</>
                : <>Showing <strong>{focusTier.name}</strong> seats. Other seats are dimmed but you can still choose them.</>}
            </span>
            <button
              type="button"
              className="es-btn es-btn--ghost es-btn--sm"
              onClick={() => setShowAllTiers((v) => !v)}
              aria-pressed={!showAllTiers}
            >
              {showAllTiers ? `Highlight ${focusTier.name}` : 'Show every seat'}
            </button>
          </div>
        )}

        {/* Phones and tablets: the categories as chips, the same toggles. */}
        {/* One type with a details card still gets its chip: it is the only
            way back to the card on a phone. */}
        {(priceGuide.length > 1 || priceGuide.some(hasDetails)) && (
          <CategoryChips tiers={priceGuide} palette={palette} currency={currency} picked={pickedTiers} onToggle={togglePickedTier} onDetails={(id) => openDetails(id)} />
        )}

        {/* 2D, 3D and 360° over ONE selection: a seat chosen in any view is in
            the same basket, under the same per-order limit (VenueExperience.jsx). */}
        <VenueExperience
          frameClassName={MAP_FRAME}
          boxClassName={MAP_BOX}
          tables={map.tables}
          seats={map.seats}
          zones={zones}
          layout={map.map?.layout}
          tiers={map.tiers || []}
          categories={map.categories || []}
          eventTitle={map.event?.title || ''}
          selectedSeatIds={selectedIds}
          selectedTableIds={selectedTableIds}
          highlightTierIds={highlightTierIds}
          hideTaken={!showTaken}
          showVenueInfo={false}
          purchaseMode={purchaseMode}
          currency={currency}
          onSelectSeat={toggleSeat}
          // A locked private table never reaches this: pressing it calls
          // `onLockedTable` instead, which asks for its password.
          onSelectTable={chooseTable}
          onLockedTable={(table, seat) => { setActionError(null); setUnlockFor({ id: table.id, label: table.label, seatId: seat?.id || null }); }}
          onSelectBooth={map.vendorBooths ? setPickedBooth : null}
        />

        {pickedBooth && map.vendorBooths && (
          <BoothPickCard
            zone={pickedBooth}
            boothTypes={map.vendorBooths.boothTypes || []}
            book={map.vendorBooths.book || null}
            slug={map.event?.slug || slug}
            currency={currency}
            onClose={() => setPickedBooth(null)}
          />
        )}

        {/* An older API still counts private tables instead of drawing
            them; said as before until it is updated. */}
        {map.hiddenTableCount > 0 && (
          <p className="text-sm text-subtle">
            {map.hiddenTableCount} private {map.hiddenTableCount === 1 ? 'table' : 'tables'}
            {' '}not shown · open your invitation link to see yours
          </p>
        )}

        {extras.rows.length > 0 && (
          <div className="es-seatpage__narrow">
            <ExtrasList
              rows={extras.rows}
              currency={currency}
              organizerName={organizerName}
              tickets={count}
              disabled={count === 0 || busy}
              onSet={extras.set}
              lockedHint={count === 0 ? 'Choose your seats first, then add extras to them.' : null}
              headingId="seat-extras"
            />
          </div>
        )}

        <div className="es-seatpage__narrow">
          {actionError && <ErrorNote error={actionError} />}
        </div>
      </div>

      <aside className="es-seatpage__basket" aria-label="Your selection">
        <Basket
          seats={selectedTable ? [] : selectedSeats}
          tableLabel={selectedTable?.label || null}
          nameFor={(seat) => nameFor(seat) || `${seat.section} · seat ${seat.number}`}
          tierOf={tierOf}
          currency={currency}
          subtotal={subtotal}
          extrasCount={extras.count}
          extrasCents={extras.cents}
          count={count}
          busy={busy}
          onRemove={toggleSeat}
          onClear={clear}
          onContinue={() => onContinue('checkout')}
          onAddToCart={() => onContinue('cart')}
          inCart={Boolean(cartItem)}
          cartCount={cartCount}
          error={actionError ? <ErrorNote error={actionError} /> : null}
          payments={payments}
        />
        <TrustCard payments={payments} />
      </aside>

      {/* Pinned to the bottom of a phone. The stickiness lives on THIS grid
          item (globals.css): on the bar inside it, its parent was exactly its
          own height, so it never moved and sat ~1,400px down the page. */}
      <div className="es-seatpage__bar">
        <SelectionBar
          count={count}
          subtotal={total}
          currency={currency}
          label={selectedTable ? `Table ${selectedTable.label}` : null}
          // The seats themselves, so each can be listed with its price and taken
          // back out. A whole-table booking passes none: it is one indivisible
          // thing, and offering to remove a seat from it would be offering
          // something the API refuses.
          seats={selectedTable ? [] : selectedSeats}
          busy={busy}
          onContinue={() => onContinue('checkout')}
          onAddToCart={() => onContinue('cart')}
          inCart={Boolean(cartItem)}
          onRemoveSeat={toggleSeat}
          nameFor={nameFor}
          onClear={clear}
        />
      </div>

      {detailTier && (
        <TierDetailsDialog
          key={detailTier.id}
          tier={detailTier}
          currency={currency}
          priceRange={Number.isFinite(detailTier.min) ? { min: detailTier.min, max: detailTier.max } : null}
          max={detailMax}
          unavailable={detailUnavailable}
          addLabel={details.anchor ? 'Add to selection' : 'Add to cart'}
          footnote={detailFootnote}
          onAdd={addFromDetails}
          onClose={closeDetails}
        />
      )}

      {unlockTarget && (
        <UnlockTableDialog
          key={unlockTarget.id}
          slug={slug}
          tableId={unlockTarget.id}
          tableLabel={unlockTarget.label}
          actionLabel={unlockFor?.seatId ? 'Unlock & choose seat' : purchaseMode === 'table_only' ? 'Unlock & choose table' : 'Unlock'}
          lede={unlockFor?.seatId ? 'Enter the password the organizer gave you. The seat you tapped is chosen as soon as it opens.' : null}
          onClose={() => { if (unlockFor) setUnlockFor(null); else setUnlockDismissed(true); }}
          // Storing the key re-runs the map fetch, and the table comes back
          // unlocked — prices, seats and all. The seat that was tapped (or,
          // sold by the table, the table) is then chosen: one step for the
          // buyer, not two (owner, 2026-11-24).
          onUnlocked={(token) => {
            const seatId = unlockFor?.seatId || null;
            addTableToken(token);
            setPendingPick({ tableId: unlockTarget.id, seatId });
            setUnlockFor(null);
            setUnlockDismissed(true);
            toast.success(
              seatId || purchaseMode === 'table_only'
                ? 'It is in your selection. Add more seats, or continue.'
                : 'Choose your seats, or the whole table, on the map.',
              { title: 'Table unlocked' },
            );
          }}
        />
      )}
    </div>
  );
}

/* The action bar is in './SelectionBar.jsx' — see its note for the seam. */

function ErrorNote({ error }) {
  const { title, recovery } = describeError(error);
  return (
    <Panel tone="danger">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="text-sm text-muted">{recovery}</p>
    </Panel>
  );
}

function Panel({ tone, children }) {
  return (
    <div
      className={`rounded-(--es-radius-lg) border p-4 ${
        tone === 'danger' ? 'border-danger/40 bg-danger/5' : 'border-border-base bg-surface'
      }`}
    >
      {children}
    </div>
  );
}
