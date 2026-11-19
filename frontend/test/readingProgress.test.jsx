import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import ReadingProgress, { readingPercent, READING_STEPS } from '../src/app/organizer/events/[id]/map/style/ReadingProgress';

/**
 * The wait while a map is read (owner, 2026-11-19: "a professional loading
 * bar"). It must look alive, and must never claim to be finished.
 */
afterEach(() => { vi.useRealTimers(); });

describe('readingPercent', () => {
  test('rises fast, slows down, and never reaches 100 before the map is back', () => {
    expect(readingPercent(0)).toBe(0);
    expect(readingPercent(10)).toBeGreaterThan(15);
    expect(readingPercent(30)).toBeGreaterThan(readingPercent(10));
    expect(readingPercent(600)).toBeLessThanOrEqual(95);
  });
});

describe('ReadingProgress', () => {
  test('ticks the steps off as time passes', () => {
    vi.useFakeTimers();
    const start = Date.now();
    render(<ReadingProgress startedAt={start} />);
    expect(screen.getByText(`${READING_STEPS[0].label}…`)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(20_000); });
    // 20 s in: the third step ("Measuring…") is the current one.
    const now = screen.getAllByRole('listitem').find((li) => li.dataset.state === 'now');
    expect(now.textContent).toBe(READING_STEPS[2].label);
    expect(screen.getAllByRole('listitem').filter((li) => li.dataset.state === 'done')).toHaveLength(2);
  });
});
