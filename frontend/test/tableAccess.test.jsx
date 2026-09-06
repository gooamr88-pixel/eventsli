import { describe, test, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTableAccess } from '../src/app/e/[slug]/seats/useTableAccess';

/**
 * Private tables, and the flow I got wrong the first time.
 *
 * A protected table is omitted from the seat-map payload ENTIRELY — not
 * returned with a `locked` flag. So there is nothing on the map to click, and
 * an "unlock this table" affordance attached to a table cannot exist. The id
 * arrives in an invitation link; the key then goes back on every map request in
 * `x-table-access`, and the SERVER decides visibility.
 *
 * These assertions pin the shape of that header, because it is the only thing
 * standing between "the buyer sees their table" and "the buyer is told their
 * table does not exist".
 */
describe('useTableAccess', () => {
  beforeEach(() => { sessionStorage.clear(); });

  test('no keys means no header at all', () => {
    // Not an empty string: sending `x-table-access: ` makes the API split on a
    // comma and hand `unlockedTableIds` a list containing one empty token.
    const { result } = renderHook(() => useTableAccess('gala'));
    expect(result.current.tokens).toEqual([]);
    expect(result.current.header).toBeUndefined();
  });

  test('a key becomes the header', () => {
    const { result } = renderHook(() => useTableAccess('gala'));
    act(() => { result.current.add('tok-a'); });
    expect(result.current.header).toBe('tok-a');
  });

  test('two invitations both survive, comma separated', () => {
    // Someone invited to two tables must see both. The API takes a list for
    // exactly this reason, and dropping the earlier key would hide a table the
    // buyer had already unlocked.
    const { result } = renderHook(() => useTableAccess('gala'));
    act(() => { result.current.add('tok-a'); });
    act(() => { result.current.add('tok-b'); });
    expect(result.current.header).toBe('tok-a,tok-b');
  });

  test('the same key twice does not duplicate', () => {
    // A refresh re-runs the unlock flow; a header that grows on every reload
    // eventually exceeds what the server will accept.
    const { result } = renderHook(() => useTableAccess('gala'));
    act(() => { result.current.add('tok-a'); });
    act(() => { result.current.add('tok-a'); });
    expect(result.current.tokens).toEqual(['tok-a']);
  });

  test('keys survive a remount — a refresh must not re-lock the table', () => {
    const first = renderHook(() => useTableAccess('gala'));
    act(() => { first.result.current.add('tok-a'); });
    first.unmount();

    const second = renderHook(() => useTableAccess('gala'));
    expect(second.result.current.header).toBe('tok-a');
  });

  test('keys are scoped to one event', () => {
    // A key is issued for one table at one event. Leaking it into another
    // event's request would send the API a token it must reject, on every
    // single map load.
    const gala = renderHook(() => useTableAccess('gala'));
    act(() => { gala.result.current.add('tok-a'); });

    const other = renderHook(() => useTableAccess('other-event'));
    expect(other.result.current.header).toBeUndefined();
  });

  test('a corrupt entry reads as no keys, not as a crash', () => {
    sessionStorage.setItem('eventsli.tableAccess.gala', '{not json');
    const { result } = renderHook(() => useTableAccess('gala'));
    expect(result.current.tokens).toEqual([]);
  });

  test('an empty add is ignored', () => {
    const { result } = renderHook(() => useTableAccess('gala'));
    act(() => { result.current.add(undefined); });
    act(() => { result.current.add(''); });
    expect(result.current.header).toBeUndefined();
  });
});
