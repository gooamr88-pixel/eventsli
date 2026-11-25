'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import VenueExperience from '../../../components/venue/VenueExperience';
import { readStudio, tierPalette } from '../../../components/venue/venueModel';
import { readZones } from '../../../components/seating/layoutZones';
import VenueInfoCard from '../../../components/venue/VenueInfoCard';
import { get } from '../../../utils/apiClient';
import { describeError, isSelectionLost } from '../../../utils/errors';
import { useReservation, TABLE_ACCESS_HEADER } from '../../../hooks/useReservation';
import { useCart, refreshCart } from '../../../hooks/useCart';
import { useToast } from '../../../components/ui/Toast';
import { useTableAccess } from './useTableAccess';
import UnlockTableDialog from './UnlockTableDialog';
import SeatMapSkeleton, { MAP_FRAME, MAP_BOX } from './SeatMapSkeleton';
import { TicketCategories, CategoryChips, TrustCard } from './SeatSidePanels';
import { cartItemFor, withMyHolds } from './cartSeats';
import ExtrasList from '../tickets/ExtrasList';
import { useExtras, attachExtras } from '../tickets/useExtras';
import { GuestsCard, PlacesBasket, PlacesBar } from './TablePlacesPanels';
import {
  freeSeatsByTable, tapTable, setGuests as regroup, partySeatIds, pickPrice, picksFromSeatIds, seated,
} from './tablePlaces';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACES AT A TABLE — the buyer's page (2026-11-25).
 *
 * "Reserve tickets at a specific table without selecting or being assigned
 * individual seats." So the page asks what a host asks: how many guests, and
 * which table. Tapping a table seats the party there; a table with less room
 * takes who it can and the page asks for another table for the rest. No seat
 * is chosen, named or shown as the buyer's — the chairs lit around a chosen
 * table are a picture of the party, and the server picks the actual stock
 * (hold_table_places). The ticket names the table only.
 *
 * Everything else is the seat page's: the same map in 2D, 3D and 360°, the
 * categories, private tables and their passwords, the cart, the extras. The
 * classic SeatPicker is untouched; an event chooses this page by its mode.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function TablePlacesPicker({
  slug, currency, maxPerOrder = 10, payments = null, addons = [], organizerName = null,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hold } = useReservation();
  const toast = useToast();
  const { header: accessHeader, add: addTableToken } = useTableAccess(slug);
  const invitedTableId = searchParams.get('table');

  const [rawMap, setMap] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const max = Math.max(1, Number(maxPerOrder) || 10);
  const [guests, setGuestCount] = useState(Math.min(2, max));
  const [picks, setPicks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [unlockFor, setUnlockFor] = useState(null);         // { id, label }
  const [unlockDismissed, setUnlockDismissed] = useState(false);
  const [pendingTable, setPendingTable] = useState(null);   // chosen once its password opens it
  const [pickedTiers, setPickedTiers] = useState(() => new Set());
  const [showTaken, setShowTaken] = useState(true);

  const { items: cartItems, count: cartCount } = useCart();
  const cartItem = cartItemFor(cartItems, slug);
  const map = useMemo(() => withMyHolds(rawMap, cartItem), [rawMap, cartItem]);

  const fetchMap = useCallback(() => get(`/public/events/${encodeURIComponent(slug)}/seat-map`, {
    cache: 'no-store', noRedirect: true,
    headers: accessHeader ? { [TABLE_ACCESS_HEADER]: accessHeader } : undefined,
  }), [slug, accessHeader]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchMap();
        if (!cancelled) { setMap(data); setLoadError(null); }
      } catch (err) {
        if (!cancelled) setLoadError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchMap]);

  const freeBy = useMemo(() => freeSeatsByTable(map?.seats), [map]);
  const freeOf = useCallback((tableId) => (freeBy.get(tableId) || []).length, [freeBy]);
  const tableById = useMemo(() => new Map((map?.tables || []).map((t) => [t.id, t])), [map]);
  const palette = useMemo(() => tierPalette(map?.tiers, map?.seats), [map]);
  const tierById = useMemo(() => new Map((map?.tiers || []).map((t) => [t.id, t])), [map]);
  const zones = useMemo(() => readZones(map?.map?.layout), [map]);

  // THE CART: this event's held places come back as the party, once per hold.
  const [seededFor, setSeededFor] = useState(null);
  if (map && cartItem && seededFor !== cartItem.reservationId) {
    setSeededFor(cartItem.reservationId);
    if (picks.length === 0) {
      const start = picksFromSeatIds(cartItem.selection?.seatIds, map.seats);
      if (start.length) { setPicks(start); setGuestCount(Math.min(max, Math.max(1, seated(start)))); }
    }
  }

  // A private table pressed before its password: chosen once the map shows it open.
  if (pendingTable && map) {
    const t = tableById.get(pendingTable);
    if (t && !t.locked) {
      setPendingTable(null);
      setPicks(tapTable(picks, guests, t.id, freeOf(t.id)));
    }
  }

  // What each ticket type costs, for the categories card (as the seat page does).
  const priceGuide = useMemo(() => {
    const by = new Map();
    for (const s of map?.seats || []) {
      if (!s.tierId) continue;
      const e = by.get(s.tierId) || { min: Infinity, max: -Infinity, free: 0 };
      if (s.priceCents !== null && s.priceCents !== undefined) { e.min = Math.min(e.min, s.priceCents); e.max = Math.max(e.max, s.priceCents); }
      if (s.available) e.free += 1;
      by.set(s.tierId, e);
    }
    return (map?.tiers || []).filter((t) => by.has(t.id)).map((t) => ({ ...t, ...by.get(t.id) })).sort((a, b) => b.max - a.max);
  }, [map]);
  const togglePickedTier = (id) => {
    const next = new Set(pickedTiers);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPickedTiers(next);
  };

  const rows = picks.map((p) => {
    const seats = (freeBy.get(p.tableId) || []).slice(0, p.quantity);
    const tiers = [...new Set(seats.map((s) => tierById.get(s.tierId)?.name).filter(Boolean))];
    return {
      ...p,
      label: tableById.get(p.tableId)?.label || '',
      priceCents: pickPrice(p, freeBy),
      tiers,
      color: seats[0]?.tierId ? palette.get(seats[0].tierId) : null,
    };
  });
  const count = seated(picks);
  const subtotal = rows.some((r) => r.priceCents === null) ? null : rows.reduce((n, r) => n + r.priceCents, 0);
  const extras = useExtras(addons, count);
  const total = subtotal === null ? null : subtotal + extras.cents;
  const waiting = Math.max(0, guests - count);

  const selectedSeatIds = useMemo(() => partySeatIds(picks, freeBy), [picks, freeBy]);
  const selectedTableIds = useMemo(() => new Set(picks.map((p) => p.tableId)), [picks]);

  const chooseTable = (table) => {
    // A table with less room than the party takes who it can; the guests card
    // then says how many still need a table (GuestsCard's hint).
    setActionError(null);
    setPicks(tapTable(picks, guests, table.id, freeOf(table.id)));
  };
  const changeGuests = (n) => {
    const next = Math.min(max, Math.max(1, n));
    setGuestCount(next);
    setPicks(regroup(picks, next, freeOf));
  };
  const removeTable = (tableId) => setPicks(picks.filter((p) => p.tableId !== tableId));
  const clear = () => { setPicks([]); setActionError(null); };

  async function onContinue(mode = 'checkout') {
    setBusy(true);
    setActionError(null);
    try {
      const reservation = await hold(slug, {
        tables: picks.map((p) => ({ tableId: p.tableId, quantity: p.quantity })), tableToken: accessHeader,
      }, { replaces: cartItem ? { reservationId: cartItem.reservationId, reservationToken: cartItem.reservationToken } : null });
      await attachExtras(reservation, extras.lines);
      if (mode === 'cart') {
        toast.success(cartItem ? 'Your cart is updated. Your places are held for you.' : 'Added to your cart. Your places are held for you.', {
          title: cartItem ? 'Cart updated' : 'Added to cart',
        });
        setSeededFor(reservation.reservationId);
        const [data] = await Promise.all([fetchMap().catch(() => null), refreshCart()]);
        if (data) setMap(data);
        setBusy(false);
        return;
      }
      router.push(`/checkout/${reservation.reservationId}`);
    } catch (err) {
      if (err?.meta?.restored) refreshCart();
      setActionError(err);
      // A table filled up while choosing: the map is redrawn and the party
      // keeps what still fits, so the buyer adjusts rather than starts again.
      if (isSelectionLost(err?.code)) {
        const data = await fetchMap().catch(() => null);
        if (data) {
          setMap(data);
          const fresh = freeSeatsByTable(withMyHolds(data, cartItem)?.seats);
          setPicks(picks.map((p) => ({ ...p, quantity: Math.min(p.quantity, (fresh.get(p.tableId) || []).length) })).filter((p) => p.quantity > 0));
        }
      }
      setBusy(false);
    }
  }

  if (loadError) {
    const { title, recovery } = describeError(loadError);
    return (
      <div className="rounded-(--es-radius-lg) border border-danger/40 bg-danger/5 p-4">
        <p className="font-medium text-ink">{title}</p>
        <p className="text-sm text-muted">{recovery}</p>
      </div>
    );
  }
  if (!map) return <div className="fx-stack"><SeatMapSkeleton /></div>;
  if (!map.map || map.tables.length === 0) {
    return (
      <div className="fx-stack fx-stack--sm items-start rounded-(--es-radius-lg) border border-border-base bg-surface p-4">
        <p className="text-muted">This event has no tables to choose from yet.</p>
        <Link href={`/e/${slug}`} className="es-btn es-btn--primary">Back to the event</Link>
      </div>
    );
  }

  // The organizer's invitation link opens its private table's password prompt.
  const invited = invitedTableId ? tableById.get(invitedTableId) : null;
  const unlockTarget = unlockFor && tableById.get(unlockFor.id)?.locked !== false
    ? unlockFor
    : invitedTableId && !unlockDismissed && (!invited || invited.locked) ? { id: invitedTableId, label: invited?.label || null } : null;
  const studio = readStudio(map.map?.layout);
  const errorNote = actionError ? <ErrorNote error={actionError} /> : null;

  return (
    <div className="es-seatpage">
      <aside className="es-seatpage__side" aria-label="Ticket categories and venue">
        {priceGuide.length > 0 && (
          <TicketCategories
            tiers={priceGuide} palette={palette} currency={currency}
            picked={pickedTiers} onToggle={togglePickedTier}
            showTaken={showTaken} onShowTaken={setShowTaken}
          />
        )}
        <VenueInfoCard venue={studio.venue} tables={map.tables} zones={zones} />
      </aside>

      <div className="es-seatpage__main fx-stack">
        <GuestsCard guests={guests} max={max} waiting={picks.length ? waiting : guests} onChange={changeGuests} />

        {priceGuide.length > 1 && (
          <CategoryChips tiers={priceGuide} palette={palette} currency={currency} picked={pickedTiers} onToggle={togglePickedTier} />
        )}

        <VenueExperience
          frameClassName={MAP_FRAME}
          boxClassName={MAP_BOX}
          tables={map.tables}
          seats={map.seats}
          zones={zones}
          layout={map.map?.layout}
          tiers={map.tiers || []}
          categories={map.categories || []}
          eventTitle={map.event?.title || ''} screenFeed={map.screenFeed || null}
          selectedSeatIds={selectedSeatIds}
          selectedTableIds={selectedTableIds}
          highlightTierIds={pickedTiers.size ? pickedTiers : null}
          hideTaken={!showTaken}
          showVenueInfo={false}
          purchaseMode="table_places"
          currency={currency}
          onSelectSeat={() => {}}
          onSelectTable={chooseTable}
          onLockedTable={(table) => { setActionError(null); setUnlockFor({ id: table.id, label: table.label }); }}
        />

        {extras.rows.length > 0 && (
          <div className="es-seatpage__narrow">
            <ExtrasList
              rows={extras.rows} currency={currency} organizerName={organizerName} tickets={count}
              disabled={count === 0 || busy} onSet={extras.set}
              lockedHint={count === 0 ? 'Choose your table first, then add extras to your places.' : null}
              headingId="places-extras"
            />
          </div>
        )}
        <div className="es-seatpage__narrow">{errorNote}</div>
      </div>

      <aside className="es-seatpage__basket" aria-label="Your table">
        <PlacesBasket
          rows={rows} currency={currency} guests={guests} subtotal={subtotal} busy={busy}
          onRemove={removeTable} onClear={clear}
          onContinue={() => onContinue('checkout')} onAddToCart={() => onContinue('cart')}
          inCart={Boolean(cartItem)} cartCount={cartCount} error={errorNote} payments={payments}
          extrasCount={extras.count} extrasCents={extras.cents}
        />
        <TrustCard payments={payments} />
      </aside>

      <div className="es-seatpage__bar">
        <PlacesBar
          rows={rows} total={total} currency={currency} busy={busy}
          onContinue={() => onContinue('checkout')} onAddToCart={() => onContinue('cart')}
          inCart={Boolean(cartItem)} onClear={clear}
        />
      </div>

      {unlockTarget && (
        <UnlockTableDialog
          key={unlockTarget.id}
          slug={slug}
          tableId={unlockTarget.id}
          tableLabel={unlockTarget.label}
          actionLabel="Unlock & choose table"
          onClose={() => { if (unlockFor) setUnlockFor(null); else setUnlockDismissed(true); }}
          onUnlocked={(token) => {
            addTableToken(token);
            setPendingTable(unlockTarget.id);
            setUnlockFor(null);
            setUnlockDismissed(true);
            toast.success('Your party is seated there once the map refreshes.', { title: 'Table unlocked' });
          }}
        />
      )}
    </div>
  );
}

function ErrorNote({ error }) {
  const { title, recovery } = describeError(error);
  return (
    <div className="rounded-(--es-radius-lg) border border-danger/40 bg-danger/5 p-4">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="text-sm text-muted">{error?.message && error.code === 'SEAT_UNAVAILABLE' ? error.message : recovery}</p>
    </div>
  );
}
