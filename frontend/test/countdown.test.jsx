import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountdown } from '../src/app/hooks/useCountdown';

/**
 * The 35-minute hold is the one clock a buyer is judged against, so the two
 * things asserted here are the two ways a countdown lies.
 */
describe('useCountdown', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('counts down against an absolute deadline', () => {
    const deadline = new Date(Date.now() + 35 * 60_000).toISOString();
    const { result } = renderHook(() => useCountdown(deadline));

    expect(result.current.formatted).toBe('35:00');
    expect(result.current.expired).toBe(false);

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current.formatted).toBe('34:00');
  });

  test('a backgrounded tab wakes up already correct', () => {
    // THE BUG THIS EXISTS FOR. A counter that subtracts a second per tick
    // drifts whenever the tab is hidden — phones throttle timers to once a
    // minute or stop them dead. Recomputing from the wall clock means ten real
    // minutes away is ten minutes gone, however few ticks actually fired.
    const start = Date.now();
    const deadline = new Date(start + 35 * 60_000).toISOString();
    const { result } = renderHook(() => useCountdown(deadline));

    act(() => {
      // Ten minutes pass with only ONE tick delivered, which is what a
      // throttled background tab does. `advanceTimersByTime` moves the clock
      // as well as firing timers, so the jump stops one second short of ten
      // minutes and that last second is the tick itself.
      vi.setSystemTime(start + 10 * 60_000 - 1000);
      vi.advanceTimersByTime(1000);
    });

    // A drifting counter would read 34:59 here — one tick, one second gone.
    expect(result.current.formatted).toBe('25:00');
  });

  test('expiry fires once, not on every tick after it', () => {
    const onExpire = vi.fn();
    const deadline = new Date(Date.now() + 2000).toISOString();
    renderHook(() => useCountdown(deadline, { onExpire }));

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test('remaining never goes negative', () => {
    const deadline = new Date(Date.now() - 60_000).toISOString();
    const { result } = renderHook(() => useCountdown(deadline));
    expect(result.current.remaining).toBe(0);
    expect(result.current.formatted).toBe('0:00');
    expect(result.current.expired).toBe(true);
  });

  test('no deadline is not zero', () => {
    // A quote that has not loaded yet must not render "0:00" and look expired.
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current.remaining).toBeNull();
    expect(result.current.formatted).toBeNull();
    expect(result.current.expired).toBe(false);
  });

  test('a malformed deadline is treated as absent, not as expired', () => {
    const { result } = renderHook(() => useCountdown('not-a-date'));
    expect(result.current.expired).toBe(false);
  });

  test('seconds are padded and minutes are not', () => {
    const { result } = renderHook(() => useCountdown(new Date(Date.now() + 65_000).toISOString()));
    expect(result.current.formatted).toBe('1:05');
  });
});
