'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SeatMapCanvas from '../../../components/seating/SeatMapCanvas';
import UnlockTableDialog from './UnlockTableDialog';
import { get } from '../../../utils/apiClient';
import { describeError, isSelectionLost } from '../../../utils/errors';
import { formatMoney } from '../../../utils/money';
import { useReservation } from '../../../hooks/useReservation';
import { useTableAccess } from './useTableAccess';

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

  const [map, setMap] = useState(null);
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
      <div className="grid h-[420px] place-items-center rounded-[--es-radius-lg] border border-border-base bg-bg-sunken">
        <p className="text-sm text-subtle">Loading the seat map…</p>
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
      <SeatMapCanvas
        className="h-[52vh] min-h-[340px]"
        tables={map.tables}
        seats={map.seats}
        selectedSeatIds={selectedIds}
        selectedTableIds={selectedTableIds}
        purchaseMode={purchaseMode}
        onSelectSeat={toggleSeat}
        // Anything reaching this callback is already visible, and a private
        // table is only visible once its key is held — so there is nothing left
        // to unlock at click time.
        onSelectTable={chooseTable}
      />

      <div className="fx-row fx-row--between">
        <Legend />
        {map.hiddenTableCount > 0 && (
          /* Counted, never named — listing them would make the map a directory
             of which tables are worth guessing a password for. There is
             deliberately no "unlock" button here: without the table's id, which
             only the organizer's invitation carries, there is nothing to
             unlock. Saying so beats a control that cannot work. */
          <p className="text-xs text-subtle">
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
        busy={busy}
        onContinue={onContinue}
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

function SelectionBar({ count, subtotal, currency, label, busy, onContinue, onClear }) {
  return (
    /* Sticky to the bottom: on a phone the map fills the screen, so an action
       bar above it scrolls away the moment you start choosing. */
    <div className="fx-safe-bottom sticky bottom-0 z-[--es-z-sticky] rounded-[--es-radius-lg] border border-border-base bg-surface p-3 shadow-lg">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          {count > 0 ? (
            <>
              <p className="text-sm text-ink">
                {label || `${count} ${count === 1 ? 'seat' : 'seats'}`}
                {label && <span className="text-muted"> · {count} seats</span>}
              </p>
              <p className="es-nums text-xs text-subtle">
                {subtotal === null ? 'Price shown at checkout' : `${formatMoney(subtotal, currency)} before tax and fees`}
              </p>
            </>
          ) : (
            <p className="text-sm text-subtle">Tap a seat to choose it</p>
          )}
        </div>

        <div className="fx-row">
          {count > 0 && (
            <button type="button" onClick={onClear} className="text-sm text-muted hover:text-ink">
              Clear
            </button>
          )}
          <button
            type="button"
            disabled={count === 0 || busy}
            onClick={onContinue}
            className="rounded-[--es-radius-md] bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Holding…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <ul className="fx-row text-xs text-muted">
      <Swatch color="var(--es-seat-available)">Available</Swatch>
      <Swatch color="var(--es-seat-selected)">Selected</Swatch>
      <Swatch color="var(--es-seat-sold)">Taken</Swatch>
    </ul>
  );
}

function Swatch({ color, children }) {
  return (
    <li className="fx-row gap-1.5">
      <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
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
      className={`rounded-[--es-radius-lg] border p-4 ${
        tone === 'danger' ? 'border-danger/40 bg-danger/5' : 'border-border-base bg-surface'
      }`}
    >
      {children}
    </div>
  );
}
