'use client';

import { useMemo, useState } from 'react';
import VenueExperience from '../../../../../components/venue/VenueExperience';
import { writeStudio } from '../../../../../components/venue/venueModel';
import { keyOf } from '../useMapDraft';
import { Choice } from './fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The finished product, before anyone buys from it.
 *
 * BUYER VIEW renders the buyer's own component (VenueExperience) on the
 * editor's draft — unsaved edits included — so the organizer sees exactly the
 * 2D, 3D and 360° views a buyer will, with today's real availability. Nothing
 * chosen here is held.
 *
 * SEAT HOLDS is the same room in the organizer's hands: press seats to block
 * them (a camera position, a sponsor's seats, a sightline lost to a speaker
 * stack) or release them. Blocked seats cannot be bought through any channel.
 * The presses are part of the editor's draft and are saved with "Save map",
 * like every other change on this screen (useStudioDraft) — not written the
 * moment they are made.
 *
 * ONLY SAVED SEATS CAN BE BLOCKED. A row drawn since the last save has no seat
 * rows in the database yet; its seats are shown, but not pressable, and the
 * panel says to save first.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STATE_COLOR = Object.freeze({
  available: '#17a2a6', blocked: '#e0704f', held: '#8b6cf0', sold: '#3b4549', unsaved: '#9aa8ad',
});
export default function StudioPreview({
  tables, zones, world, layout, studio, tiers, savedSeats, currency, purchaseMode, eventTitle,
  holds, onToggleHold, onClearHolds,
}) {
  const [mode, setMode] = useState('buyer');
  const [device, setDevice] = useState('desktop');
  // Pending changes, from the draft: seat id → 'block' | 'release'.
  const picked = useMemo(() => new Set(holds.keys()), [holds]);

  const tierPrice = useMemo(() => new Map(tiers.map((t) => [t.id, t.priceCents])), [tiers]);
  // The draft's world, which an unsaved venue resize has already changed.
  const fullLayout = useMemo(() => ({ ...writeStudio(layout, studio), world }), [layout, studio, world]);

  // The draft, in the buyer payload's shape (seatMapController.publicMap).
  const { buyerTables, seats } = useMemo(() => {
    const byTable = new Map();
    for (const s of savedSeats) {
      if (!byTable.has(s.tableId)) byTable.set(s.tableId, []);
      byTable.get(s.tableId).push(s);
    }
    const outTables = [];
    const outSeats = [];
    for (const t of tables) {
      const id = keyOf(t);
      const saved = t.id ? byTable.get(t.id) || [] : [];
      const price = t.seatPriceCents ?? tierPrice.get(t.tierId) ?? null;
      outTables.push({
        id, label: t.label, seatCount: t.seatCount, shape: t.shape, position: t.position,
        priceCents: t.priceCents ?? null, status: 'available', canBookWhole: false,
      });
      for (let i = 0; i < t.seatCount; i += 1) {
        const s = saved.find((x) => Number(x.number) === i + 1);
        outSeats.push(s ? {
          id: s.id, tableId: id, tierId: t.tierId || s.tierId, number: s.number,
          priceCents: s.priceOverrideCents ?? price, available: s.status === 'available', status: s.status,
        } : {
          id: `${id}:${i}`, tableId: id, tierId: t.tierId, number: String(i + 1),
          priceCents: price, available: true, status: 'unsaved',
        });
      }
    }
    return { buyerTables: outTables, seats: outSeats };
  }, [tables, savedSeats, tierPrice]);

  const counts = useMemo(() => {
    const c = { available: 0, blocked: 0, held: 0, sold: 0, unsaved: 0 };
    for (const s of seats) c[s.status] = (c[s.status] || 0) + 1;
    return c;
  }, [seats]);

  const holdable = (s) => s.status === 'available' || s.status === 'blocked';
  const toggle = (seat) => {
    if (mode === 'holds' && !holdable(seat)) return;
    // Buyer view: choosing is only a preview, nothing to record.
    if (mode === 'holds') onToggleHold(seat);
  };

  const paint = mode === 'holds' ? (s) => STATE_COLOR[s.status] || STATE_COLOR.sold : null;
  let toBlock = 0;
  let toRelease = 0;
  for (const change of holds.values()) {
    if (change === 'block') toBlock += 1; else toRelease += 1;
  }
  const pendingCount = toBlock + toRelease;

  // Switching views keeps the pending blocks: they are unsaved changes, not a
  // selection, and leaving the tab must not throw them away.
  const switchMode = (m) => setMode(m);

  return (
    <div className="fx-stack">
      <div className="es-dcard es-previewbar">
        <Choice
          label="Preview as"
          value={mode}
          onChange={switchMode}
          options={[{ key: 'buyer', label: 'Buyer' }, { key: 'holds', label: 'Seat holds' }]}
        />
        {mode === 'buyer' ? (
          <Choice
            label="Screen"
            value={device}
            onChange={setDevice}
            options={[{ key: 'desktop', label: 'Desktop' }, { key: 'phone', label: 'Phone' }]}
          />
        ) : (
          <ul className="es-holdlegend" aria-label="Seats by state">
            {['available', 'blocked', 'held', 'sold', 'unsaved'].filter((k) => counts[k] || k === 'available').map((k) => (
              <li key={k}>
                <span className="es-swatch" style={{ background: STATE_COLOR[k] }} aria-hidden="true" />
                {k === 'unsaved' ? 'Not saved yet' : k[0].toUpperCase() + k.slice(1)}
                <b className="es-nums">{(counts[k] || 0).toLocaleString('en')}</b>
              </li>
            ))}
          </ul>
        )}
      </div>

      {mode === 'buyer' ? (
        <p className="es-notice es-notice--info" role="status">
          This is what buyers see, with today&apos;s availability. Seats chosen here are not held.
        </p>
      ) : (
        <p className="es-notice es-notice--info" role="status">
          Press seats to block them from sale, or blocked seats to release them. Your changes are saved with the map when you press Save map. Held and sold seats belong to buyers and cannot be changed here.
          {counts.unsaved > 0 && ' Save the map to manage seats drawn since the last save.'}
        </p>
      )}

      <div className={device === 'phone' && mode === 'buyer' ? 'es-studio-phone' : ''}>
        <VenueExperience
          frameClassName="es-plate bg-surface p-3 sm:p-4"
          boxClassName="h-[62vh] min-h-[420px]"
          tables={buyerTables}
          seats={mode === 'holds' ? seats.map((s) => ({ ...s, available: holdable(s) })) : seats}
          zones={zones}
          layout={fullLayout}
          tiers={tiers}
          currency={currency}
          purchaseMode={purchaseMode}
          eventTitle={eventTitle}
          selectedSeatIds={picked}
          onSelectSeat={toggle}
          onSelectTable={() => {}}
          paint={paint}
          pickAny={mode === 'holds'}
          seatAction={mode === 'holds' ? (s) => (holdable(s)
            ? { label: picked.has(s.id) ? 'Undo' : s.status === 'blocked' ? 'Release seat' : 'Block seat', onPress: () => toggle(s) }
            : { label: s.status === 'unsaved' ? 'Save the map first' : `This seat is ${s.status}`, disabled: true }) : null}
        />
      </div>

      {mode === 'holds' && (
        <div className="es-seatbar fx-safe-bottom sticky bottom-0 z-(--es-z-sticky) fx-row fx-row--between gap-3">
          <p className="text-sm text-muted" role="status">
            {pendingCount === 0
              ? 'No changes yet.'
              : `${toBlock} to block · ${toRelease} to release — saved with Save map`}
          </p>
          <button type="button" className="es-btn es-btn--ghost" disabled={pendingCount === 0} onClick={onClearHolds}>
            Undo these changes
          </button>
        </div>
      )}
    </div>
  );
}
