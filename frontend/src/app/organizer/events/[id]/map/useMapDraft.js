'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { makeZone, newZoneId } from '../../../../components/seating/layoutZones';
import { MIN_ZONE_SIZE, zoneLabel, zoneMeta } from '../../../../components/seating/venueZones';
import { WORLD } from '../../../../components/seating/seatingGeometry';
import {
  MAX_SEATS_PER_TABLE, MAX_TABLES, mapProblems, nextLabel, numberedLabel,
} from './draftRules';

export { MAX_TABLES, MAX_SEATS_PER_TABLE };

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The editor's draft, with undo.
 *
 * `PUT /events/:id/venue-map` is a FULL REPLACE, not a patch — the API decided
 * that deliberately, because working out which of two hundred tables moved is
 * exactly the kind of merge that goes wrong quietly. So the editor holds the
 * whole map in memory and posts all of it.
 *
 * Which makes undo cheap and makes it necessary in equal measure: one bad drag
 * on a two-hundred-table room, saved, is an afternoon gone. History is a stack
 * of whole snapshots. A room at the API's ceiling of 400 tables is roughly
 * 60KB per snapshot, so the depth is capped rather than unbounded.
 *
 * ONE HISTORY OVER TABLES **AND** ZONES, and that is not a convenience. They
 * are edited in the same gesture — a marquee selects a stage and the four
 * tables in front of it, one drag moves all five. Two stacks would make that
 * take two presses of Ctrl+Z to undo, in an order the organizer cannot see, and
 * the halfway state is a layout that never existed. So `present` is
 * `{ tables, zones }` and a snapshot is both.
 *
 * HISTORY IS STATE, NOT A REF, and that is not a preference. The first version
 * kept the stacks in refs and derived `canUndo` from `past.current.length`
 * during render — which does not re-render, so the Undo button's disabled state
 * never updated after the first paint. React's lint caught it.
 *
 * DIRTY IS DERIVED: the draft is dirty when what is on screen is not the
 * snapshot that was last loaded or saved. Identity, not deep equality — which
 * is why undo restores the very object it stacked rather than a copy of it, and
 * why undoing back to the saved map correctly stops saying "unsaved changes".
 *
 * `mergeKey` folds a run of edits to the same thing into one undo step. Typing
 * a table name was one history entry per keystroke.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MAX_HISTORY = 40;
const EMPTY = Object.freeze({ tables: Object.freeze([]), zones: Object.freeze([]) });

export function useMapDraft() {
  const [history, setHistory] = useState({ past: [], present: EMPTY, future: [], mergeKey: null });
  const [saved, setSaved] = useState(EMPTY);

  const { tables, zones } = history.present;
  const dirty = history.present !== saved;

  /**
   * The present, readable synchronously from an event handler.
   *
   * It exists because several operations have to RETURN something computed from
   * the current draft: duplicating a selection has to hand back the ids of the
   * copies, or nothing can select them, and a setState updater cannot return a
   * value to its caller.
   *
   * Synced in an EFFECT rather than in the render body. The render body is the
   * shorter version and React's compiler rejects it: a render must be pure, and
   * a ref written there is a side effect that re-running or re-ordering renders
   * can duplicate or skip. The effect runs after the commit and before any
   * event that could read it — and `reset` writes it directly as well, because
   * a load is followed immediately by reads that must not see the old map.
   */
  const presentRef = useRef(history.present);
  useEffect(() => { presentRef.current = history.present; }, [history.present]);

  /**
   * Commits a change and pushes the PREVIOUS snapshot onto the undo stack.
   *
   * `transient` is what makes dragging usable: a pointermove fires dozens of
   * times per second, and one history entry per frame would make undo step back
   * a pixel at a time. The drag's first frame commits; every frame after it
   * replaces the value without recording. `mergeKey` does the same for a run of
   * edits that share it — keystrokes in one field, arrow presses on one table.
   */
  const apply = useCallback((next, { transient = false, mergeKey = null } = {}) => {
    setHistory((h) => {
      const resolved = typeof next === 'function' ? next(h.present) : next;
      if (resolved === h.present) return h;
      if (transient) return { ...h, present: resolved };
      if (mergeKey && h.mergeKey === mergeKey) return { ...h, present: resolved, future: [] };
      return {
        past: [...h.past, h.present].slice(-MAX_HISTORY),
        present: resolved,
        future: [],
        mergeKey,
      };
    });
  }, []);

  /** Replaces everything without touching history — for the initial load and
   *  for the re-read after a save. What it loads is, by definition, saved. */
  const reset = useCallback((nextTables, nextZones) => {
    const snapshot = { tables: nextTables || [], zones: nextZones || [] };
    presentRef.current = snapshot;
    setHistory({ past: [], present: snapshot, future: [], mergeKey: null });
    setSaved(snapshot);
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.past.length === 0) return h;
      return {
        past: h.past.slice(0, -1),
        present: h.past[h.past.length - 1],
        future: [h.present, ...h.future].slice(0, MAX_HISTORY),
        mergeKey: null,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (h.future.length === 0) return h;
      return {
        past: [...h.past, h.present].slice(-MAX_HISTORY),
        present: h.future[0],
        future: h.future.slice(1),
        mergeKey: null,
      };
    });
  }, []);

  /* ── tables ─────────────────────────────────────────────────────────────── */

  /**
   * Adds tables, and hands back the keys of the ones that landed.
   *
   * Plural because "Add 24 round tables in a 6x4 grid" is one undo step and one
   * naming run: names are allocated against a set that grows as it goes, so a
   * batch cannot collide with itself. Adding them one at a time through a loop
   * would produce twenty-four undo steps and twenty-four tables called T1.
   *
   * The ceiling truncates rather than refuses. An organizer who asks for fifty
   * more when forty fit should get forty and a count, not an error and nothing.
   */
  const addTables = useCallback((specs) => {
    const list = Array.isArray(specs) ? specs : [specs];
    const current = presentRef.current;
    const room = Math.max(0, MAX_TABLES - current.tables.length);
    if (room === 0) return [];

    const taken = new Set(current.tables.map((t) => String(t.label).trim().toLowerCase()));
    const stamp = Date.now();
    const created = list.slice(0, room).map((spec, i) => {
      const label = String(spec?.label || '').trim() || nextLabel(taken);
      taken.add(label.toLowerCase());
      return {
        // No `id`: the API reads its absence as "create". A client-generated
        // one would be sent as an existing row to update and match nothing.
        localKey: `new-${stamp}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        seatCount: clampSeats(spec?.seatCount ?? 8),
        priceCents: spec?.priceCents ?? null,
        isPrivate: false,
        shape: spec?.shape || 'round',
        categoryId: spec?.categoryId ?? null,
        tierId: spec?.tierId ?? null,
        seatPriceCents: null,
        position: {
          x: clamp(Number(spec?.position?.x) || 0, 0, 100),
          y: clamp(Number(spec?.position?.y) || 0, 0, 100),
          rotation: Number(spec?.position?.rotation) || 0,
        },
      };
    });

    apply((p) => ({ ...p, tables: [...p.tables, ...created] }));
    return created.map((t) => t.localKey);
  }, [apply]);

  /** The single-table form the "Add table" button and a double-click use. */
  const addTable = useCallback((position) => addTables([{ position }])[0], [addTables]);

  const updateTable = useCallback((key, patch, options) => {
    apply((p) => ({
      ...p,
      tables: p.tables.map((t) => (keyOf(t) === key ? { ...t, ...patch } : t)),
    }), options);
  }, [apply]);

  const removeTable = useCallback((key) => {
    apply((p) => ({ ...p, tables: p.tables.filter((t) => keyOf(t) !== key) }));
  }, [apply]);

  /* ── zones ──────────────────────────────────────────────────────────────── */

  /** Adds zones, and hands back their ids for the caller to select. Same
   *  batching reason as `addTables`, same truncate-don't-refuse ceiling. */
  const addZones = useCallback((specs) => {
    const list = Array.isArray(specs) ? specs : [specs];
    const current = presentRef.current;
    const taken = new Set(current.zones.map((z) => zoneLabel(z).toLowerCase()));

    const created = list.map((spec) => {
      const zone = makeZone(spec.kind, spec.position, spec.overrides);
      // A zone's label is optional — an unlabelled stage draws "Stage" from its
      // kind. But a BATCH must not draw four identical "Bar"s, so a batch names
      // them and a single one is left to inherit.
      if (spec.label) {
        zone.label = taken.has(String(spec.label).toLowerCase())
          ? numberedLabel(spec.label, taken)
          : String(spec.label);
        taken.add(zone.label.toLowerCase());
      }
      return zone;
    });

    apply((p) => ({ ...p, zones: [...p.zones, ...created] }));
    return created.map((z) => z.id);
  }, [apply]);

  const updateZone = useCallback((id, patch, options) => {
    apply((p) => ({
      ...p,
      zones: p.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)),
    }), options);
  }, [apply]);

  const removeZone = useCallback((id) => {
    apply((p) => ({ ...p, zones: p.zones.filter((z) => z.id !== id) }));
  }, [apply]);

  /* ── operations over a selection ────────────────────────────────────────── */

  /**
   * Puts things at ABSOLUTE positions — one call for a whole group.
   *
   * `entries` is `[{ kind, id, x, y }]` in percentages of the world.
   *
   * Absolute rather than "move everything by this delta", and that is the
   * difference between a group drag that works and one that slowly falls apart.
   * A delta applied to the CURRENT position each frame accumulates the rounding
   * of every frame before it, and — far more visibly — deforms the group the
   * moment one element reaches the wall: that one stops, the rest keep going,
   * and the formation the organizer arranged is gone. The caller computes each
   * position from the positions captured when the drag STARTED, so a drag out
   * to the edge and back returns everything exactly where it was.
   *
   * One call, not one per element, because a group drag has to be one undo step
   * and one re-render per frame.
   */
  const setPositions = useCallback((entries, options) => {
    if (!entries || entries.length === 0) return;
    const forTables = new Map();
    const forZones = new Map();
    for (const e of entries) {
      (e.kind === 'zone' ? forZones : forTables).set(e.id, e);
    }

    apply((p) => ({
      tables: p.tables.map((t) => {
        const e = forTables.get(keyOf(t));
        return e ? { ...t, position: { ...t.position, x: clamp(e.x, 0, 100), y: clamp(e.y, 0, 100) } } : t;
      }),
      zones: p.zones.map((z) => {
        const e = forZones.get(z.id);
        return e ? { ...z, x: clamp(e.x, 0, 100), y: clamp(e.y, 0, 100) } : z;
      }),
    }), options);
  }, [apply]);

  /**
   * Turns everything selected about ITS OWN centre, not about the group's.
   *
   * Rotating the group as a body would move every element as well as turning
   * it, which is never what "rotate these tables" means on a floor plan — the
   * organizer has already placed them and wants a long table turned
   * lengthwise, not the whole formation swung around a point they cannot see.
   */
  const rotateSelection = useCallback((selection, degrees) => {
    const turn = (deg) => ((((Number(deg) || 0) + degrees) % 360) + 360) % 360;
    apply((p) => ({
      tables: p.tables.map((t) => (selection.tables.has(keyOf(t))
        ? { ...t, position: { ...t.position, rotation: turn(t.position?.rotation) } }
        : t)),
      zones: p.zones.map((z) => (selection.zones.has(z.id) ? { ...z, rotation: turn(z.rotation) } : z)),
    }));
  }, [apply]);

  const removeSelection = useCallback((selection) => {
    apply((p) => ({
      tables: p.tables.filter((t) => !selection.tables.has(keyOf(t))),
      zones: p.zones.filter((z) => !selection.zones.has(z.id)),
    }));
  }, [apply]);

  /**
   * Copies everything selected, offset down-right, and returns the new
   * selection so the caller can leave the COPIES selected.
   *
   * Selecting the copies rather than the originals is what makes repeated
   * Ctrl+D lay out a row: each press duplicates what the last one made, so the
   * offset accumulates. Leaving the originals selected instead stacks every
   * copy in the same place, which looks like nothing happened until you drag
   * one away and find four underneath.
   *
   * A duplicated table is a NEW table — no id — so the API creates it and
   * generates its seats. It deliberately does not inherit the original's
   * privacy: `isPrivate` without a password is refused on a create, and copying
   * the protection onto a table nobody has set a password for would produce a
   * table no guest can reach and no organizer can see is unreachable.
   */
  const duplicateSelection = useCallback((selection, offset = 4) => {
    const current = presentRef.current;
    const takenTables = new Set(current.tables.map((t) => String(t.label).trim().toLowerCase()));
    const takenZones = new Set(current.zones.map((z) => zoneLabel(z).toLowerCase()));
    const stamp = Date.now();

    const tableCopies = [];
    const room = Math.max(0, MAX_TABLES - current.tables.length);
    for (const t of current.tables) {
      if (!selection.tables.has(keyOf(t)) || tableCopies.length >= room) continue;
      const label = numberedLabel(t.label, takenTables);
      takenTables.add(label.toLowerCase());
      tableCopies.push({
        ...t,
        id: undefined,
        localKey: `new-${stamp}-d${tableCopies.length}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        status: undefined,
        isPrivate: false,
        password: undefined,
        hasPassword: false,
        position: {
          ...t.position,
          x: clamp((t.position?.x || 0) + offset, 0, 100),
          y: clamp((t.position?.y || 0) + offset, 0, 100),
        },
      });
    }

    const zoneCopies = [];
    for (const z of current.zones) {
      if (!selection.zones.has(z.id)) continue;
      const label = numberedLabel(zoneLabel(z), takenZones);
      takenZones.add(label.toLowerCase());
      zoneCopies.push({
        ...z,
        id: newZoneId(),
        label,
        x: clamp(z.x + offset, 0, 100),
        y: clamp(z.y + offset, 0, 100),
      });
    }

    if (tableCopies.length === 0 && zoneCopies.length === 0) return null;

    apply((p) => ({
      tables: [...p.tables, ...tableCopies],
      zones: [...p.zones, ...zoneCopies],
    }));

    return {
      tables: new Set(tableCopies.map((t) => t.localKey)),
      zones: new Set(zoneCopies.map((z) => z.id)),
    };
  }, [apply]);

  /**
   * Resizes one zone, in world units.
   *
   * Zones only. A table's size is DERIVED from its seat count by
   * `seatingGeometry.tableBody` — that is what keeps a 2-top and a 12-top from
   * being drawn the same size, and letting a handle override it would mean a
   * table that looks like it seats four and sells ten.
   */
  const resizeZone = useCallback((id, w, h, options) => {
    apply((p) => ({
      ...p,
      zones: p.zones.map((z) => (z.id === id ? {
        ...z,
        w: clamp(w, MIN_ZONE_SIZE, WORLD.width),
        h: clamp(h, MIN_ZONE_SIZE, WORLD.height),
      } : z)),
    }), options);
  }, [apply]);

  /** Restores a zone to its catalogue size — the way back from a resize that
   *  got away, which is otherwise a drag nobody can land precisely. */
  const resetZoneSize = useCallback((id) => {
    const meta = zoneMeta(presentRef.current.zones.find((z) => z.id === id)?.kind);
    apply((p) => ({
      ...p,
      zones: p.zones.map((z) => (z.id === id ? { ...z, w: meta.w, h: meta.h } : z)),
    }));
  }, [apply]);

  const problems = useMemo(() => mapProblems(tables, zones), [tables, zones]);

  return {
    tables,
    zones,
    dirty,
    problems,
    // Derived from STATE, so the buttons actually enable and disable.
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    apply,
    reset,
    undo,
    redo,
    addTable,
    addTables,
    updateTable,
    removeTable,
    addZones,
    updateZone,
    removeZone,
    setPositions,
    rotateSelection,
    removeSelection,
    duplicateSelection,
    resizeZone,
    resetZoneSize,
  };
}

/** A saved table has an `id`; a new one only has a local key. Both need a
 *  stable identity for React and for selection, and they cannot collide. */
export function keyOf(table) {
  return table.id || table.localKey;
}

/** Matches the database: `seat_count INT CHECK (seat_count BETWEEN 1 AND 60)`. */
function clampSeats(n) {
  const v = Math.round(Number(n) || 0);
  return Math.min(MAX_SEATS_PER_TABLE, Math.max(1, v));
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
