import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readStudio, writeStudio, liveSections, sectionIndex } from '../../../../../components/venue/venueModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The Venue Studio's draft, held beside the map's (useMapDraft).
 *
 * Venue details, 3D settings, 360° views and section names live in the layout
 * blob (venueModel.js) and ride the map's one full-replace save, so a single
 * Save keeps every tab. They are not in the map's undo history: undo is for
 * moving seats, and an undo that also reverted a lighting change would be a
 * surprise.
 *
 * Also holds the saved seats with their states — what the Preview tab shows
 * and blocks — because the editor's own table model keeps only counts.
 *
 * SEAT BLOCKS ARE PART OF THE DRAFT (TECH-AUDIT-LOG, 2026-11-10). The Preview's
 * "Seat holds" used to write each block the moment "Apply" was pressed, while
 * everything else on the same screen waited for "Save map" — two save models
 * on one page, and the only change that survived "leave without saving".
 * `holds` is now seat id → 'block' | 'release'; it marks the draft unsaved and
 * travels in the map's save, applied in the same transaction (save_venue_map).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useStudioDraft() {
  const [studio, setStudio] = useState(() => readStudio(null));
  const [edited, setEdited] = useState(false);
  const [savedSeats, setSavedSeats] = useState([]);
  const [holds, setHolds] = useState(() => new Map());
  const studioRef = useRef(studio);
  useEffect(() => { studioRef.current = studio; }, [studio]);

  /** `patch` merges into an object key, or replaces an array key (views, sections). */
  const edit = useCallback((key, patch) => {
    setStudio((s) => ({ ...s, [key]: Array.isArray(patch) ? patch : { ...s[key], ...patch } }));
    setEdited(true);
  }, []);

  /** A map response from the API: the studio as saved, and its seats. */
  const load = useCallback((map) => {
    setStudio(readStudio(map?.layout));
    setEdited(false);
    setSavedSeats(seatsOf(map));
    setHolds(new Map());
  }, []);

  /**
   * Block an available seat, release a blocked one, or undo either. Only a
   * seat that exists on the saved map can change: a held or sold seat is a
   * buyer's, and one drawn since the last save has no seat row yet.
   */
  const toggleHold = useCallback((seat) => {
    if (seat.status !== 'available' && seat.status !== 'blocked') return;
    setHolds((prev) => {
      const next = new Map(prev);
      if (next.has(seat.id)) next.delete(seat.id);
      else next.set(seat.id, seat.status === 'available' ? 'block' : 'release');
      return next;
    });
  }, []);
  const clearHolds = useCallback(() => setHolds(new Map()), []);

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * A WHOLE TABLE UNAVAILABLE (owner, 2026-11-24): "the organizer sold or
   * reserved it outside Eventsli". Not a new kind of stock: it is every open
   * seat at the table blocked, through the same blocks the Preview's "Seat
   * holds" make, saved in the same transaction as the map (save_venue_map's
   * `p_availability`). So it needs no migration, a buyer who holds a seat
   * meanwhile keeps it (the save skips and counts it), and the hold
   * functions already refuse a blocked seat and a table that is not whole.
   *
   * `setTablesUnavailable(ids, true)` blocks every open seat at those tables;
   * `false` releases every blocked one. Either is undone by the other, and
   * neither touches a seat a buyer holds or bought.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const setTablesUnavailable = useCallback((tableIds, on) => {
    const ids = new Set(tableIds);
    setHolds((prev) => {
      const next = new Map(prev);
      for (const seat of savedSeats) {
        if (!ids.has(seat.tableId)) continue;
        if (seat.status === 'available') {
          if (on) next.set(seat.id, 'block'); else next.delete(seat.id);
        } else if (seat.status === 'blocked') {
          if (on) next.delete(seat.id); else next.set(seat.id, 'release');
        }
      }
      return next;
    });
  }, [savedSeats]);

  /**
   * Each saved table's seats as they will be after the pending blocks and
   * releases: table id → { total, open, blocked, booked }. A table is
   * UNAVAILABLE when nothing at it is open and the organizer blocked at
   * least one seat (a table a buyer bought outright is sold, not this).
   */
  const tableStock = useMemo(() => {
    const out = new Map();
    for (const seat of savedSeats) {
      if (!seat.tableId) continue;
      const change = holds.get(seat.id);
      const status = change === 'block' ? 'blocked' : change === 'release' ? 'available' : seat.status;
      const s = out.get(seat.tableId) || { total: 0, open: 0, blocked: 0, booked: 0 };
      s.total += 1;
      if (status === 'available') s.open += 1;
      else if (status === 'blocked') s.blocked += 1;
      else s.booked += 1;
      out.set(seat.tableId, s);
    }
    return out;
  }, [savedSeats, holds]);

  /** What a save sends, given the layout it is building on and the tables in it. */
  const toLayout = (layout, tables) => writeStudio(layout, { ...studio, sections: liveSections(studio.sections, tables) });

  /** label → { section, row }: what each section row's seats are addressed by (S-19). */
  const sectionsFor = (tables) => sectionIndex(liveSections(studio.sections, tables));

  /** The blocks and releases to send, or null when there are none. */
  const availability = () => {
    if (holds.size === 0) return null;
    const block = [];
    const release = [];
    for (const [id, change] of holds) (change === 'block' ? block : release).push(id);
    return { block, release };
  };

  /**
   * After a save's re-read. The studio is replaced only if it did not change
   * while the request was in flight — the same rule the tables follow — so
   * typing in a tab during a save is not wiped. Holds that were SENT are done;
   * any pressed during the save stay pending.
   */
  const afterSave = (map, sent, sentHolds) => {
    setSavedSeats(seatsOf(map));
    if (studioRef.current === sent) {
      setStudio(readStudio(map?.layout));
      setEdited(false);
    }
    if (sentHolds) {
      setHolds((prev) => {
        const next = new Map(prev);
        for (const id of [...sentHolds.block, ...sentHolds.release]) next.delete(id);
        return next;
      });
    }
  };

  return {
    studio,
    studioDirty: edited || holds.size > 0,
    savedSeats,
    holds,
    edit,
    load,
    toggleHold,
    clearHolds,
    setTablesUnavailable,
    tableStock,
    toLayout,
    sectionsFor,
    availability,
    afterSave,
  };
}

/** Every saved seat, flat, with its table. */
function seatsOf(map) {
  return (map?.tables || []).flatMap((t) => (t.seats || []).map((seat) => ({ ...seat, tableId: t.id })));
}
