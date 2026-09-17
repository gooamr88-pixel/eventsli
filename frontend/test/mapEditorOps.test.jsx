import { describe, test, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapDraft, keyOf } from '../src/app/organizer/events/[id]/map/useMapDraft';
import { useSelection, soleSelected } from '../src/app/organizer/events/[id]/map/useSelection';
import { makeZone } from '../src/app/components/seating/layoutZones';
import { MIN_ZONE_SIZE } from '../src/app/components/seating/venueZones';

/**
 * The editor's bulk operations — the ones a marquee selection reaches.
 *
 * Every one of these acts on several things at once, and the thing that can go
 * wrong is always the same shape: it works on one element and quietly does
 * something different to the group. A formation that deforms at the wall, a
 * duplicate that stacks four copies in one place, an undo that takes two
 * presses because tables and zones kept separate histories.
 */

const zoneAt = (kind, x, y) => makeZone(kind, { x, y });
const tableAt = (id, x, y, extra = {}) => ({
  id, label: id.toUpperCase(), seatCount: 8, shape: 'round',
  position: { x, y, rotation: 0 }, ...extra,
});

/** A selection literal, the shape every operation below takes. */
const sel = (tables = [], zones = []) => ({ tables: new Set(tables), zones: new Set(zones) });

describe('one history covers tables AND zones', () => {
  test('a mixed change is ONE undo step', () => {
    // THE BUG THIS PINS. Separate stacks would make undoing a drag that moved a
    // stage and four tables take two presses of Ctrl+Z, in an order the
    // organizer cannot see — and the halfway state is a layout that never
    // existed.
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([tableAt('a', 10, 10)], [zoneAt('stage', 50, 50)]); });

    act(() => {
      result.current.setPositions([
        { kind: 'table', id: 'a', x: 30, y: 30 },
        { kind: 'zone', id: result.current.zones[0].id, x: 70, y: 70 },
      ]);
    });
    expect(result.current.tables[0].position.x).toBe(30);
    expect(result.current.zones[0].x).toBe(70);

    act(() => { result.current.undo(); });
    expect(result.current.tables[0].position.x).toBe(10);
    expect(result.current.zones[0].x).toBe(50);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  test('adding a zone marks the map unsaved, and undo clears that again', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([], []); });
    expect(result.current.dirty).toBe(false);

    act(() => { result.current.addZones([{ kind: 'bar', position: { x: 20, y: 20 } }]); });
    expect(result.current.dirty).toBe(true);

    act(() => { result.current.undo(); });
    expect(result.current.dirty).toBe(false);
  });
});

describe('setPositions', () => {
  test('a drag is one history entry, not one per frame', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([tableAt('a', 10, 10)], []); });

    act(() => {
      for (let i = 1; i <= 20; i += 1) {
        result.current.setPositions([{ kind: 'table', id: 'a', x: 10 + i, y: 10 }], { transient: i > 1 });
      }
    });
    expect(result.current.tables[0].position.x).toBe(30);

    act(() => { result.current.undo(); });
    expect(result.current.tables[0].position.x).toBe(10);
  });

  test('rotation is untouched by a move', () => {
    // It lives on the same `position` object, so a careless spread drops it —
    // and a long table silently un-turns the first time it is nudged.
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([tableAt('a', 10, 10, { position: { x: 10, y: 10, rotation: 90 } })], []); });
    act(() => { result.current.setPositions([{ kind: 'table', id: 'a', x: 20, y: 20 }]); });
    expect(result.current.tables[0].position.rotation).toBe(90);
  });

  test('positions are held inside the room', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([tableAt('a', 10, 10)], [zoneAt('bar', 10, 10)]); });
    const zoneId = result.current.zones[0].id;

    act(() => {
      result.current.setPositions([
        { kind: 'table', id: 'a', x: 480, y: -90 },
        { kind: 'zone', id: zoneId, x: -5, y: 900 },
      ]);
    });
    expect(result.current.tables[0].position).toMatchObject({ x: 100, y: 0 });
    expect(result.current.zones[0]).toMatchObject({ x: 0, y: 100 });
  });
});

describe('duplicateSelection', () => {
  test('a copy is a NEW table — no id, so the API creates it', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([tableAt('a', 10, 10)], []); });
    act(() => { result.current.duplicateSelection(sel(['a'])); });

    const copy = result.current.tables[1];
    expect(copy.id).toBeUndefined();
    expect(copy.localKey).toBeTruthy();
    // A client-generated id would be sent as an update to a row that does not
    // exist.
    expect(keyOf(copy)).not.toBe('a');
  });

  test('a copy is never private, and carries no password', () => {
    // Copying the protection would produce a table the API refuses on create —
    // and, if it did not, one no guest can reach and no organizer can see is
    // unreachable.
    const { result } = renderHook(() => useMapDraft());
    act(() => {
      result.current.reset([tableAt('a', 10, 10, { isPrivate: true, hasPassword: true, password: 'hunter2' })], []);
    });
    act(() => { result.current.duplicateSelection(sel(['a'])); });

    expect(result.current.tables[1]).toMatchObject({ isPrivate: false, hasPassword: false });
    expect(result.current.tables[1].password).toBeUndefined();
  });

  test('a copy gets a free name, never a duplicate one', () => {
    // The API refuses duplicate labels outright, so a copy called "T1" would
    // fail the save after the organizer had done the work.
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([tableAt('a', 10, 10), tableAt('b', 20, 20)], []); });
    act(() => { result.current.duplicateSelection(sel(['a', 'b'])); });

    const labels = result.current.tables.map((t) => t.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('it returns the COPIES, so repeated duplication lays out a row', () => {
    // Leaving the ORIGINALS selected stacks every copy in the same place, which
    // looks like nothing happened until you drag one away and find four under it.
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([tableAt('a', 10, 10)], []); });

    let next;
    act(() => { next = result.current.duplicateSelection(sel(['a'])); });
    expect(next.tables.size).toBe(1);
    expect([...next.tables][0]).not.toBe('a');

    act(() => { result.current.duplicateSelection(next); });
    expect(result.current.tables).toHaveLength(3);
    // Each copy is offset from the one it was made from, so they fan out.
    const xs = result.current.tables.map((t) => t.position.x);
    expect(new Set(xs).size).toBe(3);
  });

  test('duplicating nothing changes nothing and returns null', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([tableAt('a', 10, 10)], []); });

    let next;
    act(() => { next = result.current.duplicateSelection(sel()); });
    expect(next).toBe(null);
    expect(result.current.dirty).toBe(false);
  });

  test('zones are copied too, and numbered', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([], [{ ...zoneAt('bar', 20, 20), label: 'Bar' }]); });
    act(() => { result.current.duplicateSelection(sel([], [result.current.zones[0].id])); });

    expect(result.current.zones).toHaveLength(2);
    expect(result.current.zones[1].label).toBe('Bar 2');
    expect(result.current.zones[1].id).not.toBe(result.current.zones[0].id);
  });
});

describe('rotateSelection', () => {
  test('each element turns about its OWN centre — nothing moves', () => {
    // Rotating the group as a body would also MOVE everything, which is never
    // what "rotate these tables" means on a floor plan.
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([tableAt('a', 10, 10), tableAt('b', 80, 80)], [zoneAt('stage', 50, 50)]); });
    const zoneId = result.current.zones[0].id;

    act(() => { result.current.rotateSelection(sel(['a', 'b'], [zoneId]), 90); });

    expect(result.current.tables[0].position).toMatchObject({ x: 10, y: 10, rotation: 90 });
    expect(result.current.tables[1].position).toMatchObject({ x: 80, y: 80, rotation: 90 });
    expect(result.current.zones[0]).toMatchObject({ x: 50, y: 50, rotation: 90 });
  });

  test('rotation wraps rather than growing without bound', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([tableAt('a', 10, 10, { position: { x: 10, y: 10, rotation: 315 } })], []); });
    act(() => { result.current.rotateSelection(sel(['a']), 90); });
    expect(result.current.tables[0].position.rotation).toBe(45);
  });

  test('unselected elements are left alone', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([tableAt('a', 10, 10), tableAt('b', 20, 20)], []); });
    act(() => { result.current.rotateSelection(sel(['a']), 90); });
    expect(result.current.tables[1].position.rotation).toBe(0);
  });
});

describe('removeSelection and resizeZone', () => {
  test('a mixed selection is removed in one step', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => {
      result.current.reset([tableAt('a', 10, 10), tableAt('b', 20, 20)], [zoneAt('bar', 30, 30)]);
    });
    const zoneId = result.current.zones[0].id;

    act(() => { result.current.removeSelection(sel(['a'], [zoneId])); });
    expect(result.current.tables.map(keyOf)).toEqual(['b']);
    expect(result.current.zones).toHaveLength(0);

    act(() => { result.current.undo(); });
    expect(result.current.tables).toHaveLength(2);
    expect(result.current.zones).toHaveLength(1);
  });

  test('a zone cannot be resized below what can be grabbed again', () => {
    // Below the minimum the handle covers the whole shape, so the drag that
    // made the mistake cannot be used to undo it.
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([], [zoneAt('bar', 30, 30)]); });
    const zoneId = result.current.zones[0].id;

    act(() => { result.current.resizeZone(zoneId, 0, -40); });
    expect(result.current.zones[0].w).toBe(MIN_ZONE_SIZE);
    expect(result.current.zones[0].h).toBe(MIN_ZONE_SIZE);
  });

  test('reset size returns a zone to its catalogue size', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([], [zoneAt('bar', 30, 30)]); });
    const zoneId = result.current.zones[0].id;
    const original = result.current.zones[0].w;

    act(() => { result.current.resizeZone(zoneId, 400, 300); });
    expect(result.current.zones[0].w).toBe(400);

    act(() => { result.current.resetZoneSize(zoneId); });
    expect(result.current.zones[0].w).toBe(original);
  });
});

describe('addTables in a batch', () => {
  test('a batch cannot collide with itself on names', () => {
    // Allocating against a set that does not grow as it goes gives twenty-four
    // tables all called T1 — and the API refuses the save.
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([], []); });
    act(() => {
      result.current.addTables(Array.from({ length: 24 }, () => ({ position: { x: 10, y: 10 } })));
    });

    const labels = result.current.tables.map((t) => t.label);
    expect(labels).toHaveLength(24);
    expect(new Set(labels).size).toBe(24);
  });

  test('a batch is ONE undo step', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([], []); });
    act(() => { result.current.addTables([{ position: { x: 1, y: 1 } }, { position: { x: 2, y: 2 } }]); });
    act(() => { result.current.undo(); });
    expect(result.current.tables).toHaveLength(0);
  });

  test('the seat count is held to the database CHECK', () => {
    const { result } = renderHook(() => useMapDraft());
    act(() => { result.current.reset([], []); });
    act(() => { result.current.addTables([{ position: { x: 1, y: 1 }, seatCount: 900 }]); });
    expect(result.current.tables[0].seatCount).toBe(60);
    expect(result.current.problems).toEqual([]);
  });
});

describe('useSelection', () => {
  test('tables and zones are kept in separate sets', () => {
    // One set would work right up until an id collided, at which point deleting
    // a zone would delete a table.
    const { result } = renderHook(() => useSelection());
    act(() => { result.current.selectOnly('table', 'x'); });
    act(() => { result.current.toggle('zone', 'x'); });

    expect(result.current.selection.tables.has('x')).toBe(true);
    expect(result.current.selection.zones.has('x')).toBe(true);
    expect(result.current.count).toBe(2);
  });

  test('toggle removes as well as adds, so a marquee is correctable', () => {
    const { result } = renderHook(() => useSelection());
    act(() => { result.current.replace(['a', 'b', 'c'], []); });
    act(() => { result.current.toggle('table', 'b'); });
    expect([...result.current.selection.tables]).toEqual(['a', 'c']);
  });

  test('extend adds a second sweep without losing the first', () => {
    const { result } = renderHook(() => useSelection());
    act(() => { result.current.replace(['a'], ['z1']); });
    act(() => { result.current.extend(['b'], ['z2']); });
    expect(result.current.count).toBe(4);
  });

  test('clear on an empty selection does not churn state', () => {
    const { result } = renderHook(() => useSelection());
    const before = result.current.selection;
    act(() => { result.current.clear(); });
    expect(result.current.selection).toBe(before);
  });
});

describe('soleSelected — which inspector panel to show', () => {
  const tables = [tableAt('a', 10, 10)];
  const zones = [{ ...zoneAt('bar', 20, 20), id: 'z1' }];

  test('exactly one table', () => {
    expect(soleSelected(sel(['a']), tables, zones)).toEqual({ kind: 'table', table: tables[0] });
  });

  test('exactly one zone', () => {
    expect(soleSelected(sel([], ['z1']), tables, zones)).toEqual({ kind: 'zone', zone: zones[0] });
  });

  test('none and several are both null — the caller treats them differently', () => {
    expect(soleSelected(sel(), tables, zones)).toBe(null);
    expect(soleSelected(sel(['a'], ['z1']), tables, zones)).toBe(null);
  });

  test('an id that no longer exists is null, not a crash', () => {
    // A selected table can be removed by an undo while still selected.
    expect(soleSelected(sel(['gone']), tables, zones)).toBe(null);
  });
});
