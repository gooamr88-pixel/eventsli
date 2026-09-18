'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SeatMapCanvas from '../../../components/seating/SeatMapCanvas';
import { readZones } from '../../../components/seating/layoutZones';
import UnlockTableDialog from './UnlockTableDialog';
import { get } from '../../../utils/apiClient';
import { describeError, isSelectionLost } from '../../../utils/errors';
import { formatMoney } from '../../../utils/money';
import { useReservation } from '../../../hooks/useReservation';
import { useTableAccess } from './useTableAccess';
import { Loading } from '../../../components/Feedback';

/**
 * The buyer's half of the seat map: selection, the private-table gate, and the
 * hold that turns a selection into 35 minutes of exclusivity.
 *
 * Nothing here prices anything. The running total shown while choosing is the
 * SUM OF SEAT PRICES and is labelled as such — the real total comes back from
 * the quote after the hold, with tax and fees the client is in no position to
 * compute.
 */
export default function SeatPicker({ slug, currency, purchaseMode, maxPerOrder }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hold } = useReservation();
  const { header: accessHeader, add: addTableToken } = useTableAccess(slug);

  /**
   * A private table's id arrives in the invitation link, because the table
   * itself is absent from the payload until it is unlocked — there is nothing
   * on the map to click. See useTableAccess.js for the full shape of this.
   */
  const invitedTableId = searchParams.get('table');
  const tierParam = searchParams.get('tier');

  const [map, setMap] = useState(null);
  const [showAllTiers, setShowAllTiers] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [unlockDismissed, setUnlockDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const loadMap = useCallback(async () => {
    try {
      const data = await get(`/public/events/${encodeURIComponent(slug)}/seat-map`, {
        // Never cached, at any layer. Availability is the whole payload.
        cache: 'no-store',
        noRedirect: true,
        headers: accessHeader ? { 'x-table-access': accessHeader } : undefined,
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
          headers: accessHeader ? { 'x-table-access': accessHeader } : undefined,
        });
        if (!cancelled) { setMap(data); setLoadError(null); }
      } catch (err) {
        if (!cancelled) setLoadError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, accessHeader]);

  // The dialog opens when an invitation link names a table this session has no
  // key for yet, and stays closed once the map comes back holding it.
  const invitedTableVisible = Boolean(
    invitedTableId && map?.tables?.some((t) => t.id === invitedTableId),
  );
  const showUnlock = Boolean(invitedTableId) && !invitedTableVisible && !unlockDismissed && Boolean(map);

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
  const zones = useMemo(() => readZones(map?.map?.layout), [map]);

  /**
   * `?tier=` — the buyer followed a ticket-type link from the organizer's
   * Share & QR. Only a tier that is in THIS map's payload counts; anything else
   * is ignored. Its seats stay bright and every other seat is dimmed, but
   * nothing is made unselectable: the link is a pointer, not a restriction.
   */
  const focusTier = tierParam ? (map?.tiers || []).find((t) => t.id === tierParam) || null : null;
  const highlightTierId = focusTier && !showAllTiers ? focusTier.id : null;

  const selectedIds = useMemo(() => new Set(selectedSeats.map((s) => s.id)), [selectedSeats]);
  const selectedTableIds = useMemo(
    () => new Set(selectedTable ? [selectedTable.id] : []),
    [selectedTable],
  );

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

    // BRD §11. Refused here as well as by the API, because being told at the
    // hold that the eleventh seat was one too many means re-picking all ten.
    if (selectedSeats.length >= maxPerOrder) {
      setActionError({ code: 'PURCHASE_LIMIT_EXCEEDED' });
      return;
    }

    setSelectedSeats([...selectedSeats, seat]);
  }, [selectedSeats, maxPerOrder]);

  const chooseTable = useCallback((table) => {
    setActionError(null);
    setSelectedSeats([]);
    setSelectedTable((current) => (current?.id === table.id ? null : table));
  }, []);

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

  async function onContinue() {
    setBusy(true);
    setActionError(null);
    try {
      const reservation = await hold(slug, selectedTable
        // The key gates the PURCHASE as well as the map. Sending the whole
        // header covers the case of two invitations in one session — the API
        // works out which one applies.
        ? { tableId: selectedTable.id, tableToken: accessHeader }
        : { seatIds: selectedSeats.map((s) => s.id) });

      router.push(`/checkout/${reservation.reservationId}`);
    } catch (err) {
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

  if (!map) {
    return (
      <div className="grid h-[420px] place-items-center rounded-(--es-radius-lg) border border-border-base bg-bg-sunken">
        <Loading variant="card" />
      </div>
    );
  }

  if (!map.map || map.tables.length === 0) {
    return (
      <Panel>
        <p className="text-muted">This event has no seat map yet.</p>
      </Panel>
    );
  }

  return (
    <div className="fx-stack">
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

      {/* The map is PRESENTED, not placed.

          This is the one screen that is only this product — the whole pitch on
          the homepage is that you pick the chair — and it was a bare canvas
          sitting directly on the page tone, the same treatment a loading
          skeleton got. On a plate, against the sunken band, the room reads as
          an object you are looking into rather than a diagram someone dropped
          in.

          `bg-surface` on the plate rather than the page ground: the floor of
          the room should be the lightest thing on the screen, because every
          seat colour was chosen to sit on it. */}
      <div className="es-plate bg-surface p-3 sm:p-4">
        <SeatMapCanvas
          className="h-[58vh] min-h-[380px]"
          tables={map.tables}
          seats={map.seats}
          zones={zones}
          selectedSeatIds={selectedIds}
          selectedTableIds={selectedTableIds}
          highlightTierId={highlightTierId}
          purchaseMode={purchaseMode}
          onSelectSeat={toggleSeat}
          // Anything reaching this callback is already visible, and a private
          // table is only visible once its key is held — so there is nothing left
          // to unlock at click time.
          onSelectTable={chooseTable}
        />
      </div>

      <div className="fx-row fx-row--between">
        <Legend />
        {map.hiddenTableCount > 0 && (
          /* Counted, never named — listing them would make the map a directory
             of which tables are worth guessing a password for. There is
             deliberately no "unlock" button here: without the table's id, which
             only the organizer's invitation carries, there is nothing to
             unlock. Saying so beats a control that cannot work. */
          <p className="text-sm text-subtle">
            {map.hiddenTableCount} reserved {map.hiddenTableCount === 1 ? 'table' : 'tables'}
            {' '}not shown · open your invitation link to see yours
          </p>
        )}
      </div>

      {actionError && <ErrorNote error={actionError} />}

      <SelectionBar
        count={count}
        subtotal={subtotal}
        currency={currency}
        label={selectedTable ? `Table ${selectedTable.label}` : null}
        // The seats themselves, so each can be listed with its price and taken
        // back out. A whole-table booking passes none: it is one indivisible
        // thing, and offering to remove a seat from it would be offering
        // something the API refuses.
        seats={selectedTable ? [] : selectedSeats}
        busy={busy}
        onContinue={onContinue}
        onRemoveSeat={toggleSeat}
        onClear={() => { setSelectedSeats([]); setSelectedTable(null); setActionError(null); }}
      />

      {showUnlock && (
        <UnlockTableDialog
          slug={slug}
          tableId={invitedTableId}
          onClose={() => setUnlockDismissed(true)}
          // Storing the key re-runs the map fetch, and the table arrives with
          // it. Nothing is selected here: the buyer should see what they were
          // invited to before committing to it.
          onUnlocked={addTableToken}
        />
      )}
    </div>
  );
}

function SelectionBar({
  count, subtotal, currency, label, seats = [], busy, onContinue, onRemoveSeat, onClear,
}) {
  return (
    /* Sticky to the bottom: on a phone the map fills the screen, so an action
       bar above it scrolls away the moment you start choosing. */
    <div className="fx-safe-bottom sticky bottom-0 z-(--es-z-sticky) es-card p-3 shadow-lg">
      {/**
        * EVERY SEAT, NAMED, WITH A WAY OUT.
        *
        * The total alone used to be the whole of this bar, and taking a seat
        * back meant finding it again on the map and clicking it a second time —
        * on a two-hundred-seat plan, zoomed out, after picking six. The seat
        * you want to drop is the one you are least able to point at.
        *
        * Capped and scrolled rather than allowed to grow: this is fixed to the
        * bottom of the viewport, and ten seats listed in full would cover the
        * map they were chosen from.
        */}
      {seats.length > 0 && (
        <div className="fx-stack fx-stack--sm mb-3 border-b border-border-base pb-3">
          <div className="fx-row fx-row--between items-baseline">
            <p className="text-sm text-ink">
              Selected {seats.length === 1 ? 'seat' : 'seats'} ({seats.length})
            </p>
            <button type="button" onClick={onClear} disabled={busy} className="text-sm text-accent">
              Clear
            </button>
          </div>

          <ul className="fx-stack fx-stack--sm max-h-40 overflow-y-auto">
            {seats.map((seat) => (
              <li key={seat.id} className="fx-row fx-row--between items-center gap-3">
                <span className="fx-min0 text-sm text-muted">{seatName(seat)}</span>
                <span className="fx-row shrink-0 items-center gap-2">
                  <span className="es-nums text-sm text-ink">
                    {seat.priceCents === null || seat.priceCents === undefined
                      ? '—'
                      : formatMoney(seat.priceCents, currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveSeat(seat)}
                    disabled={busy}
                    aria-label={`Remove ${seatName(seat)}`}
                    // 28px painted, 44px to press (`.fx-hit`). This drops a
                    // seat from an order mid-purchase, so a mis-tap costs the
                    // buyer their seat — and the row is too tight to draw it
                    // any bigger without pushing the price off the line.
                    className="fx-hit grid h-7 w-7 place-items-center rounded-full text-subtle transition-colors hover:bg-bg-sunken hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          {count > 0 ? (
            <>
              {/* The money leads. This pair was 13px over 10.4px — the running
                  total of what you are about to spend, set two steps below the
                  venue address on the page before it. The subtotal is now the
                  larger of the two and the seat description supports it,
                  because the number is what a person checks before pressing
                  Continue. */}
              <p className="es-nums text-lg font-medium text-ink">
                {subtotal === null
                  ? 'Price at checkout'
                  : formatMoney(subtotal, currency)}
              </p>
              <p className="text-sm text-muted">
                {label || `${count} ${count === 1 ? 'seat' : 'seats'}`}
                {label && ` · ${count} seats`}
                {subtotal !== null && ' · before tax and fees'}
              </p>
            </>
          ) : (
            <p className="text-muted">Tap a seat to choose it</p>
          )}
        </div>

        <div className="fx-row">
          {count > 0 && (
            <button type="button" onClick={onClear} className="es-btn es-btn--ghost es-btn--sm">
              Clear
            </button>
          )}
          <button
            type="button"
            disabled={count === 0 || busy}
            onClick={onContinue}
            /* `aria-busy` as well as `disabled`, and the label changes rather
               than being replaced by a spinner: a spinner alone announces
               nothing, and this is the control that spends money. */
            aria-busy={busy || undefined}
            className="es-btn es-btn--primary"
          >
            {busy ? 'Holding…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One seat, as a person reads it off a map.
 *
 * `row_label` is 'A' for every seat attached to a table, so repeating it next
 * to a section that is already the table's name reads as noise — the same rule
 * `TicketStub` applies to the printed ticket, so the seat is described
 * identically here, on the ticket, and at the door.
 */
function seatName(seat) {
  const { section, row, number } = seat;
  if (row && row !== 'A') return `${section} · row ${row} · seat ${number}`;
  return `${section} · seat ${number}`;
}

function Legend() {
  return (
    /* Was `text-xs` — 10.4px on a phone. This is the key to the only piece of
       information on the screen that is carried by colour alone, so it is the
       last thing that should have been set at the smallest size in the app. */
    <ul className="fx-row fx-row--gap text-sm text-muted">
      <Swatch color="var(--es-seat-available)">Available</Swatch>
      <Swatch color="var(--es-seat-selected)">Selected</Swatch>
      <Swatch color="var(--es-seat-sold)">Taken</Swatch>
    </ul>
  );
}

function Swatch({ color, children }) {
  return (
    <li className="fx-row gap-2">
      <span
        className="inline-block size-3.5 rounded-full"
        style={{ background: color }}
      />
      {children}
    </li>
  );
}

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
