import { describe, test, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import SeatMapCanvas from '../src/app/components/seating/SeatMapCanvas';
import { usePanZoom } from '../src/app/components/seating/usePanZoom';
import { WORLD } from '../src/app/components/seating/seatingGeometry';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MAP MUST NOT RE-RENDER ITSELF FOREVER.
 *
 * `usePanZoom` re-frames the viewport when the content's bounds change, and it
 * does it DURING RENDER — which is the right pattern (an effect would paint one
 * frame of the stale viewport first) and is also the one place a loop can start.
 *
 * It compared bounds by IDENTITY. Any caller handing over an object that was
 * equal but not identical re-framed on every render, which re-rendered, which
 * re-framed. React gives up with "Too many re-renders" (error #301) and the
 * whole page is replaced by an error boundary.
 *
 * A DEFAULT PARAMETER OF `[]` IS ENOUGH TO CAUSE IT, because a default
 * allocates per render. That is exactly what happened: `SeatMapCanvas` grew a
 * `zones = []` default, Door sales renders the map without zones, and the page
 * died. These tests pin both halves of the fix.
 * ─────────────────────────────────────────────────────────────────────────────
 */

beforeAll(() => {
  // jsdom gives every element a zero-sized box; the hook clamps against it.
  Element.prototype.getBoundingClientRect = function rect() {
    return {
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, toJSON() { return this; },
    };
  };
});

const table = (id, x, y) => ({
  id, label: id.toUpperCase(), seatCount: 8, shape: 'round',
  position: { x, y, rotation: 0 }, canBookWhole: false,
});

describe('usePanZoom survives a fresh-but-equal bounds', () => {
  test('a new object with the same numbers does not re-frame', () => {
    // The exact shape of the bug: every render hands over a different object
    // carrying identical values.
    const { result, rerender } = renderHook(
      ({ b }) => usePanZoom(b),
      { initialProps: { b: { x: 0, y: 0, width: 1000, height: 700 } } },
    );

    const first = result.current.view;
    for (let i = 0; i < 5; i += 1) {
      rerender({ b: { x: 0, y: 0, width: 1000, height: 700 } });
    }

    // Same numbers in, same viewport out — and crucially, no loop to get there.
    expect(result.current.view).toEqual(first);
  });

  test('bounds that actually change DO re-frame', () => {
    // The fix must not cost the behaviour the block exists for: a map arriving
    // after its loading state has to be framed when it lands.
    const { result, rerender } = renderHook(
      ({ b }) => usePanZoom(b),
      { initialProps: { b: { x: 0, y: 0, width: 1000, height: 700 } } },
    );

    rerender({ b: { x: 100, y: 50, width: 400, height: 300 } });

    expect(result.current.view).toMatchObject({ x: 100, y: 50, width: 400, height: 300 });
  });
});

describe('SeatMapCanvas renders without looping', () => {
  test('a caller that omits `zones` renders once and settles', () => {
    // Door sales is that caller. Before the fix this threw React #301 and the
    // organizer saw "Something went wrong".
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(
      <SeatMapCanvas tables={[table('a', 30, 30)]} seats={[]} />,
    )).not.toThrow();

    expect(screen.getByRole('group', { name: 'Seat map' })).toBeInTheDocument();
    // "Too many re-renders" arrives as a console error before it throws, so an
    // empty console is part of the claim rather than decoration.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('re-rendering the same map repeatedly is stable', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tables = [table('a', 30, 30)];

    const { rerender } = render(<SeatMapCanvas tables={tables} seats={[]} />);
    for (let i = 0; i < 5; i += 1) {
      rerender(<SeatMapCanvas tables={tables} seats={[]} />);
    }

    expect(screen.getByRole('group', { name: 'Seat map' })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('zones still reach the map when they are passed', () => {
    // The fix must not quietly turn the feature off.
    const zones = [{ id: 'z1', kind: 'stage', label: 'Main stage', x: 50, y: 15, w: 140, h: 60, rotation: 0 }];
    const { container } = render(
      <SeatMapCanvas tables={[table('a', 30, 30)]} seats={[]} zones={zones} />,
    );

    // TWICE, and both are wanted. The zone is drawn on the map, and named again
    // in the text summary below it — the drawn one is `aria-hidden`, so the
    // sentence is the only version a screen-reader user gets.
    expect(container.querySelector('[data-zone-id="z1"]')).not.toBeNull();
    expect(screen.getByText(/Also on this map: Main stage/)).toBeInTheDocument();
  });

  test('the world is the fallback frame for an empty map', () => {
    render(<SeatMapCanvas tables={[]} seats={[]} />);
    const svg = screen.getByRole('group', { name: 'Seat map' });
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${WORLD.width} ${WORLD.height}`);
  });
});
