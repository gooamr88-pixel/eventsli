'use client';

import { useCallback, useMemo, useState } from 'react';
import { SHAPES } from '../../../../components/seating/seatingGeometry';

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
 * of whole table arrays. A room at the API's ceiling of 400 tables is roughly
 * 60KB per snapshot, so the depth is capped rather than unbounded.
 *
 * HISTORY IS STATE, NOT A REF, and that is not a preference. The first version
 * kept the stacks in refs and derived `canUndo` from `past.current.length`
 * during render — which does not re-render, so the Undo button's disabled state
 * never updated after the first paint. React's lint caught it.
 *
 * DIRTY IS DERIVED: the draft is dirty when what is on screen is not the array
 * that was last loaded or saved. It used to be a flag set by every undo, so
 * pressing Undo with nothing to undo — or undoing back to the saved map —
 * still said "unsaved changes".
 *
 * `mergeKey` folds a run of edits to the same thing into one undo step. Typing
 * a table name was one history entry per keystroke.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MAX_HISTORY = 40;
const NOTHING = Object.freeze([]);

/** The API's own ceilings, mirrored so the editor refuses before the round trip. */
export const MAX_TABLES = 400;
export const MAX_SEATS_PER_TABLE = 60;

export function useMapDraft() {
  const [history, setHistory] = useState({ past: [], present: NOTHING, future: [], mergeKey: null });
  const [saved, setSaved] = useState(NOTHING);

  const tables = history.present;
  const dirty = tables !== saved;

  /**
   * Commits a change and pushes the PREVIOUS state onto the undo stack.
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
  const reset = useCallback((next) => {
    setHistory({ past: [], present: next, future: [], mergeKey: null });
    setSaved(next);
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

  /**
   * A label the API will accept: unique, case-insensitively, across the map.
   * It refuses duplicates outright, and finding that out after laying out fifty
   * tables means renaming by hand.
   */
  const nextLabel = useCallback((current) => {
    const taken = new Set(current.map((t) => String(t.label).trim().toLowerCase()));
    for (let n = 1; n <= MAX_TABLES + 1; n += 1) {
      const candidate = `T${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `T${Date.now()}`;
  }, []);

  const addTable = useCallback((position) => {
    apply((current) => {
      if (current.length >= MAX_TABLES) return current;
      return [...current, {
        // No `id`: the API reads its absence as "create". A client-generated
        // one would be sent as an existing row to update and match nothing.
        localKey: `new-${Date.now()}-${current.length}`,
        label: nextLabel(current),
        seatCount: 8,
        priceCents: null,
        isPrivate: false,
        shape: 'round',
        categoryId: null,
        tierId: null,
        seatPriceCents: null,
        position: { x: position.x, y: position.y, rotation: 0 },
      }];
    });
  }, [apply, nextLabel]);

  const updateTable = useCallback((key, patch, options) => {
    apply((current) => current.map((t) => (keyOf(t) === key ? { ...t, ...patch } : t)), options);
  }, [apply]);

  const removeTable = useCallback((key) => {
    apply((current) => current.filter((t) => keyOf(t) !== key));
  }, [apply]);

  /** Duplicate labels are the one thing the API refuses that a person cannot
   *  see coming, so it is surfaced before Save rather than after. */
  const duplicateLabels = useMemo(() => {
    const seen = new Map();
    for (const t of tables) {
      const key = String(t.label || '').trim().toLowerCase();
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([label]) => label);
  }, [tables]);

  const problems = useMemo(() => {
    const out = [];
    if (duplicateLabels.length > 0) {
      out.push(`Two tables share a name: ${duplicateLabels.join(', ')}. Names must be unique.`);
    }
    if (tables.some((t) => !String(t.label || '').trim())) {
      out.push('Every table needs a name.');
    }
    if (tables.some((t) => !Number.isInteger(Number(t.seatCount))
      || t.seatCount < 1 || t.seatCount > MAX_SEATS_PER_TABLE)) {
      out.push(`Seats per table must be between 1 and ${MAX_SEATS_PER_TABLE}.`);
    }
    if (tables.some((t) => !SHAPES.includes(t.shape))) {
      out.push('A table has a shape the map cannot draw.');
    }
    // A private table with no password and no id has never had one — the API
    // refuses it, and the message there is less specific than this one.
    if (tables.some((t) => t.isPrivate && !t.password && !t.id)) {
      out.push('A private table needs a password before it can be saved.');
    }
    if (tables.length > MAX_TABLES) out.push(`A map holds at most ${MAX_TABLES} tables.`);
    return out;
  }, [tables, duplicateLabels]);

  return {
    tables,
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
    updateTable,
    removeTable,
  };
}

/** A saved table has an `id`; a new one only has a local key. Both need a
 *  stable identity for React and for selection, and they cannot collide. */
export function keyOf(table) {
  return table.id || table.localKey;
}
