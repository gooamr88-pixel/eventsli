import { describe, test, expect } from 'vitest';
import { niceCeiling, barLayout, axisLabels, ringDash, percent } from '../src/app/components/charts/chartMath';

describe('chart arithmetic', () => {
  test('the scale rounds up to a number a person would write on an axis', () => {
    expect(niceCeiling(0)).toBe(0);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(180)).toBe(200);
    expect(niceCeiling(2300)).toBe(2500);
    expect(niceCeiling(42000)).toBe(50000);
  });

  test('bars never exceed the box, and an empty day keeps a baseline sliver', () => {
    const { max, bars } = barLayout([0, 50, 100], { width: 300, height: 100 });
    expect(max).toBe(100);
    expect(bars[0].empty).toBe(true);
    expect(bars[0].height).toBeGreaterThan(0);
    expect(bars[2].height).toBe(100);
    for (const b of bars) {
      expect(b.x + b.width).toBeLessThanOrEqual(300);
      expect(b.y).toBeGreaterThanOrEqual(0);
    }
  });

  test('no data draws nothing rather than dividing by zero', () => {
    expect(barLayout([])).toEqual({ max: 0, bars: [] });
    expect(barLayout([0, 0]).bars.every((b) => b.empty)).toBe(true);
  });

  test('axis labels are first, middle and last', () => {
    expect(axisLabels(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'c', 'e']);
    expect(axisLabels(['a', 'b'])).toEqual(['a', 'b']);
  });

  test('a ring is clamped to a full circle', () => {
    expect(ringDash(0.5)).toBe('50.00 100');
    expect(ringDash(3)).toBe('100.00 100');
    expect(ringDash(-1)).toBe('0.00 100');
  });

  test('a percentage of nothing is unknown, not zero', () => {
    expect(percent(3, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33);
  });
});
