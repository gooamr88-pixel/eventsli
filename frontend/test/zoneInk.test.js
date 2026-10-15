import { describe, test, expect } from 'vitest';
import { ZONES, zoneInk, contrast } from '../src/app/components/seating/venueZones';

/**
 * REGRESSION (2026-10-15) — venue-zone labels were drawn in the zone colour on a
 * wash of that same colour, and ten of fourteen kinds measured 3.68–4.23:1. The
 * label is now drawn in `zoneInk`, which must clear 4.5:1 on every wash it can
 * sit on, for every built-in colour AND any custom one an organizer picks.
 */
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const wash = (c, p, g) => rgb(c).map((v, i) => Math.round(v * p + rgb(g)[i] * (1 - p)));
const GROUNDS = ['#ffffff', '#eff3fa'];

function worst(color) {
  const ink = rgb(zoneInk(color));
  return Math.min(...GROUNDS.flatMap((g) => [contrast(ink, wash(color, 0.12, g)), contrast(ink, wash(color, 0.2, g))]));
}

describe('zone label ink', () => {
  test('every built-in zone label reads at 4.5:1 or better', () => {
    for (const [kind, meta] of Object.entries(ZONES)) {
      expect(worst(meta.color), `${kind} ${meta.color}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('so does any custom colour, however light', () => {
    for (const c of ['#ffff00', '#fafafa', '#ff0000', '#00ffcc', '#2c62bd', '#abc']) {
      const full = c.length === 4 ? `#${c.slice(1).split('').map((x) => x + x).join('')}` : c;
      expect(worst(full), c).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('the hue is kept: the ink is the same colour, darker', () => {
    const ink = rgb(zoneInk('#8a6070'));
    const base = rgb('#8a6070');
    const ratios = ink.map((v, i) => v / base[i]);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.02);
    expect(ink[0]).toBeLessThan(base[0]);
  });

  test('a malformed colour is passed through untouched', () => {
    expect(zoneInk('not-a-colour')).toBe('not-a-colour');
  });
});
