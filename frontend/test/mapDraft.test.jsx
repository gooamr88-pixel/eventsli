import { describe, test, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapDraft, keyOf, MAX_TABLES } from '../src/app/organizer/events/[id]/map/useMapDraft';

/**
 * The editor's draft.
 *
 * The undo stack is the reason this file exists. A save is a FULL REPLACE of a
 * room that can hold four hundred tables, so one bad drag committed is an
 * afternoon of work gone — and there is no server-side history to recover from.
 */
const at = (x, y) => ({ x, y });

describe('useMapDraft — undo', () => {
  test('canUndo is derived from state, so a button can actually track it', () => {
    // THE BUG THIS PINS. The first version kept the stacks in refs and read
    // `past.current.length` during render. Refs do not re-render, so `canUndo`
    // was whatever it had been on the first paint and the Undo button never
    // enabled. It was present, looked fine, and did nothing.
    const { result } = renderHook(() => useMapDraft());
    expect(result.current.canUndo).toBe(false);

    act(() => { result.current.addTable(at(10, 10)); });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => { result.current.undo(); });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  test('undo steps back a whole change, and redo returns it', () => {
    const { result } = renderHook(() => useMapDraft());

    act(() => { result.current.addTable(at(10, 10)); });
    act(() => { result.current.addTable(at(20, 20)); });
    expect(result.current.tables).toHaveLength(2);

    act(() => { result.current.undo(); });
    expect(result.current.tables).toHaveLength(1);

    act(() => { result.current.redo(); });
    expect(result.current.tables).toHaveLength(2);
  });

  test('a drag is ONE history entry, not one per frame', () => {
    // Without `transient`, a pointermove at 60fps means undo steps back a pixel
    // at a time and a person has to press it four hundred times to recover a
    // single mistaken drag.
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.addTable(at(10, 10)); });
    const key = keyOf(result.current.tables[0]);

    // Rotation is carried through, exactly as EditorCanvas does it — the drag
    // moves a table, it does not turn it.
    const move = (x, y, transient) => act(() => {
      result.current.updateTable(key, { position: { x, y, rotation: 0 } }, { transient });
    });

    // The first frame of the drag records; the rest replace.
    move(11, 11, false);
    for (let i = 12; i < 30; i += 1) move(i, i, true);
    expect(result.current.tables[0].position).toMatchObject({ x: 29, y: 29 });

    act(() => { result.current.undo(); });
    // One undo returns to where the table was before the drag started.
    expect(result.current.tables[0].position).toMatchObject({ x: 10, y: 10 });
  });

  test('a new change after undo discards the redo branch', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.addTable(at(10, 10)); });
    act(() => { result.current.addTable(at(20, 20)); });
    act(() => { result.current.undo(); });
    expect(result.current.canRedo).toBe(true);

    act(() => { result.current.addTable(at(30, 30)); });
    expect(result.current.canRedo).toBe(false);
  });

  test('loading a map clears history — you cannot undo past the server', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.addTable(at(10, 10)); });
    act(() => { result.current.reset([{ id: 'a', label: 'T1', seatCount: 8, shape: 'round', position: at(0, 0) }]); });

    expect(result.current.canUndo).toBe(false);
    expect(result.current.dirty).toBe(false);
  });
});

describe('useMapDraft — the refusals, before the round trip', () => {
  const base = (over = {}) => ({
    localKey: 'k1', label: 'T1', seatCount: 8, shape: 'round',
    isPrivate: false, position: at(10, 10), ...over,
  });

  test('a clean map has no problems', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([base()]); });
    expect(result.current.problems).toEqual([]);
  });

  test('duplicate names are caught here, not by the API', () => {
    // The API refuses outright, and finding out after laying out fifty tables
    // means renaming by hand.
    const { result } = renderHook(() => useMapDraft());
    act(() => {
      result.current.reset([base(), base({ localKey: 'k2', label: 't1' })]);
    });
    expect(result.current.problems.join(' ')).toMatch(/share a name/);
  });

  test('an empty name is caught', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([base({ label: '   ' })]); });
    expect(result.current.problems.join(' ')).toMatch(/needs a name/);
  });

  test('the seat count is held to the database CHECK', () => {
    const { result } = renderHook(() => useMapDraft());
    for (const bad of [0, 61, 1.5]) {
      act(() => { result.current.reset([base({ seatCount: bad })]); });
      expect(result.current.problems.join(' '), String(bad)).toMatch(/between 1 and 60/);
    }
  });

  test('a NEW private table without a password is refused', () => {
    // The constraint is `private_needs_password`. A table that already exists
    // keeps its stored hash, so only a new one is a problem.
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([base({ isPrivate: true })]); });
    expect(result.current.problems.join(' ')).toMatch(/private table needs a password/);

    act(() => { result.current.reset([base({ id: 'existing', isPrivate: true })]); });
    expect(result.current.problems).toEqual([]);
  });

  test('an unknown shape is refused, because nothing could draw it', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([base({ shape: 'hexagon' })]); });
    expect(result.current.problems.join(' ')).toMatch(/shape the map cannot draw/);
  });
});

describe('useMapDraft — new tables', () => {
  test('a new table carries no id, so the API reads it as a create', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.addTable(at(50, 50)); });

    const table = result.current.tables[0];
    expect(table.id).toBeUndefined();
    expect(table.localKey).toBeTruthy();
    expect(keyOf(table)).toBe(table.localKey);
  });

  test('names avoid collisions with what is already there', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => {
      result.current.reset([
        { id: 'a', label: 'T1', seatCount: 8, shape: 'round', position: at(0, 0) },
        { id: 'b', label: 'T2', seatCount: 8, shape: 'round', position: at(0, 0) },
      ]);
    });
    act(() => { result.current.addTable(at(50, 50)); });
    expect(result.current.tables[2].label).toBe('T3');
  });

  test('the table ceiling is enforced', () => {
    const { result } = renderHook(() => useMapDraft());
    const full = Array.from({ length: MAX_TABLES }, (_, i) => ({
      id: `t${i}`, label: `X${i}`, seatCount: 4, shape: 'round', position: at(0, 0),
    }));
    act(() => { result.current.reset(full); });
    act(() => { result.current.addTable(at(50, 50)); });
    expect(result.current.tables).toHaveLength(MAX_TABLES);
  });
});
