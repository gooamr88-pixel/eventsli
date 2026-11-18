import { describe, test, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { planToMap, sidesForRotation } from '../src/app/components/seating/imageImport';
import { seatPositions, tableBody, toWorld, SEAT_RADIUS } from '../src/app/components/seating/seatingGeometry';
import { REFERENCE_PLAN } from './fixtures/referencePlan';

vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(async () => ({ enabled: true, poster: true, remaining: 2, limit: 2 })), post: vi.fn() }));
vi.mock('../src/app/organizer/events/new/ai/posterImage', () => ({
  POSTER_ACCEPT: 'image/*',
  preparePoster: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,AAAA', width: 1553, height: 912, bytes: 4, name: 'plan.jpg' })),
}));
import { post } from '../src/app/utils/apiClient';
import ImageImportDialog from '../src/app/organizer/events/[id]/map/style/ImageImportDialog';

/**
 * A seating map read from a picture (owner, 2026-11-19), checked against the
 * owner's own reference floor plan written out as the AI should report it.
 */
const map = planToMap(REFERENCE_PLAN);
const byLabel = new Map(map.tables.map((t) => [t.label, t]));

describe('planToMap', () => {
  test('every table, area, wall and floor label arrives', () => {
    expect(map.tables).toHaveLength(34);
    expect(map.report).toMatchObject({ tables: 34, areas: 6, walls: 9 });
    expect(map.zones.filter((z) => z.kind === 'wall')).toHaveLength(9);
    expect(map.zones.filter((z) => z.kind === 'text').map((z) => z.label)).toContain('Decorative circular seating');
    expect(map.look).toMatchObject({ floor: '#fffcf2', wall: '#0e3a4a', seat: '#d6006e', accent: '#00949a' });
  });

  test('seats per side are kept as counted, turned with the table', () => {
    // A booth with its curve on the right, as drawn: no turn, 2 on the flat back, 1 on the curve.
    expect(byLabel.get('S04')).toMatchObject({ shape: 'd_shape', seatCount: 3, position: expect.objectContaining({ rotation: 0 }) });
    expect(byLabel.get('S04').style.sides).toEqual({ top: 0, right: 1, bottom: 0, left: 2 });
    // Rounded end on the LEFT: turned 180°.
    expect(byLabel.get('S28').position.rotation).toBe(180);
    // Drawn tall with seats left and right: turned 90°, seats on its own long sides.
    expect(byLabel.get('S14').position.rotation).toBe(90);
    expect(byLabel.get('S14').style.sides).toEqual({ top: 2, right: 0, bottom: 2, left: 0 });
    expect(byLabel.get('S07').seatCount).toBe(12);
  });

  test('positions keep the picture’s proportions', () => {
    const a = toWorld(byLabel.get('S01').position, map.world);
    const b = toWorld(byLabel.get('S40').position, map.world);
    const pa = REFERENCE_PLAN.tables.find((t) => t.label === 'S01');
    const pb = REFERENCE_PLAN.tables.find((t) => t.label === 'S40');
    const kx = (b.x - a.x) / ((pb.x - pa.x) / 100 * 1553);
    const ky = (b.y - a.y) / ((pb.y - pa.y) / 100 * 912);
    expect(Math.abs(kx - ky) / kx).toBeLessThan(0.01);
  });

  test('no two tables’ seats overlap', () => {
    const placed = map.tables.map((t) => {
      const p = toWorld(t.position, map.world);
      const r = (p.rotation * Math.PI) / 180;
      return seatPositions(t.shape, t.seatCount, t.style).map((s) => ({
        x: p.x + s.x * Math.cos(r) - s.y * Math.sin(r), y: p.y + s.x * Math.sin(r) + s.y * Math.cos(r), label: t.label,
      }));
    });
    const all = placed.flat();
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        if (all[i].label === all[j].label) continue;
        expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y), `${all[i].label} / ${all[j].label}`)
          .toBeGreaterThanOrEqual(SEAT_RADIUS * 2 - 0.5);
      }
    }
    expect(tableBody('rect', 4).width).toBeGreaterThan(0);
  });

  test('labels are unique and never empty', () => {
    const m = planToMap({ ...REFERENCE_PLAN, tables: [REFERENCE_PLAN.tables[0], REFERENCE_PLAN.tables[0], { ...REFERENCE_PLAN.tables[1], label: '' }] });
    expect(m.tables.map((t) => t.label)).toEqual(['S01', 'S01 (2)', 'T1']);
  });

  test('sides turn with the table', () => {
    expect(sidesForRotation([1, 2, 3, 4], 0)).toEqual([1, 2, 3, 4]);
    expect(sidesForRotation([1, 2, 3, 4], 90)).toEqual([2, 3, 4, 1]);
    expect(sidesForRotation([1, 2, 3, 4], 180)).toEqual([3, 4, 1, 2]);
  });
});

test('the dialog reads a picture, shows the rebuilt map, and applies it', async () => {
  post.mockResolvedValue({ plan: REFERENCE_PLAN, quota: { enabled: true, poster: true, remaining: 1, limit: 2 } });
  const onApply = vi.fn();
  const { container } = render(<ImageImportDialog eventId="ev-1" replacing onApply={onApply} onClose={() => {}} />);
  const file = new File(['x'], 'plan.png', { type: 'image/png' });
  await userEvent.upload(container.querySelector('input[type="file"]'), file);
  await userEvent.click(await screen.findByRole('button', { name: /Read the map/ }));
  await waitFor(() => expect(screen.getByText(/Read 34 tables with 174 seats/)).toBeTruthy());
  expect(post.mock.calls[0][0]).toBe('/ai/events/ev-1/seating-plan/from-image');
  expect(post.mock.calls[0][1].image).toEqual({ mimeType: 'image/jpeg', data: 'data:image/jpeg;base64,AAAA' });
  await userEvent.click(screen.getByRole('button', { name: 'Apply to my map' }));
  expect(onApply.mock.calls[0][0].tables).toHaveLength(34);
});
