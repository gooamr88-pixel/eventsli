import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeatingPackModal from '../src/app/organizer/events/[id]/map/print/SeatingPackModal';
import { buildTableIndex, buildZoneIndex, packSummary, chunk } from '../src/app/organizer/events/[id]/map/print/packRoster';
import { paperBox, planScale, compareLabels, PAPERS } from '../src/app/organizer/events/[id]/map/print/packGeometry';
import { makeZone } from '../src/app/components/seating/layoutZones';
import { WORLD } from '../src/app/components/seating/seatingGeometry';

/**
 * The printed pack.
 *
 * IT IS RENDERED HERE, not just unit-tested, and that is the whole point of
 * this file. A print path of exactly this shape once shipped completely dead —
 * a top-level function reached for a value from a component's scope and threw
 * on every render, while the build, the linter and the unit tests all stayed
 * green. Nobody found out until somebody pressed the button.
 *
 * So: the pure functions are tested for what they say, and the modal is
 * actually mounted.
 */

const table = (label, over = {}) => ({
  id: `id-${label}`, label, seatCount: 10, shape: 'round',
  position: { x: 50, y: 50, rotation: 0 }, soldSeats: 0, ...over,
});

describe('the pack renders at all', () => {
  test('mounting it produces the floor plan and the index', () => {
    render(
      <SeatingPackModal
        eventTitle="Spring Gala"
        tables={[table('T1'), table('T2', { soldSeats: 4 })]}
        zones={[makeZone('stage', { x: 50, y: 15 })]}
        categories={[]}
        dirty={false}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Print / export' })).toBeInTheDocument();
    expect(screen.getAllByText('Spring Gala').length).toBeGreaterThan(0);
    expect(screen.getByText('Table index')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Floor plan' })).toBeInTheDocument();
    // Every table reaches the paper. The export this replaced clipped whatever
    // did not fit, and what fell off the edge was tables.
    expect(screen.getAllByText('T1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('T2').length).toBeGreaterThan(0);
  });

  test('a map with no zones omits the zone section rather than printing an empty one', () => {
    render(
      <SeatingPackModal
        eventTitle="No Zones" tables={[table('T1')]} zones={[]} categories={[]}
        dirty={false} onClose={() => {}}
      />,
    );
    expect(screen.queryByText('Venue zones')).not.toBeInTheDocument();
  });

  test('an unsaved draft says so on the page it is printed from', () => {
    // The pack prints what is on screen. Somebody carrying a plan of a room the
    // system does not have yet should be told.
    render(
      <SeatingPackModal
        eventTitle="Draft" tables={[table('T1', { id: undefined, localKey: 'new-1' })]} zones={[]}
        categories={[]} dirty onClose={() => {}}
      />,
    );
    // Twice over, and both are wanted: the banner warns before printing, and
    // the row marks WHICH table is the one that does not exist server-side yet.
    expect(screen.getByText(/changes you have not saved/i)).toBeInTheDocument();
    expect(screen.getByText(/^·\s*not saved$/)).toBeInTheDocument();
  });

  test('Print asks the browser to print — there is no PDF library to go wrong', () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(
      <SeatingPackModal
        eventTitle="X" tables={[table('T1')]} zones={[]} categories={[]}
        dirty={false} onClose={() => {}}
      />,
    );
    screen.getByRole('button', { name: /print or save as pdf/i }).click();
    expect(print).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test('Escape closes it', async () => {
    const onClose = vi.fn();
    render(
      <SeatingPackModal
        eventTitle="X" tables={[table('T1')]} zones={[]} categories={[]}
        dirty={false} onClose={onClose}
      />,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  test('table cards are off by default and appear when asked for', async () => {
    render(
      <SeatingPackModal
        eventTitle="X" tables={[table('T1')]} zones={[]} categories={[]}
        dirty={false} onClose={() => {}}
      />,
    );
    const before = screen.getAllByText('T1').length;
    await userEvent.click(screen.getByLabelText(/table cards/i));
    expect(screen.getAllByText('T1').length).toBeGreaterThan(before);
  });
});

describe('buildTableIndex', () => {
  test('sorted by name the way a person reads it, not as strings', () => {
    // "T10" before "T2" is the plain string sort, and it is wrong in exactly
    // the document somebody is scanning with a finger at the door.
    const rows = buildTableIndex([table('T10'), table('T2'), table('T1')], []);
    expect(rows.map((r) => r.label)).toEqual(['T1', 'T2', 'T10']);
  });

  test('free seats are seats minus what is sold or held', () => {
    const [row] = buildTableIndex([table('T1', { seatCount: 10, soldSeats: 4 })], []);
    expect(row).toMatchObject({ seats: 10, sold: 4, free: 6 });
  });

  test('more sold than seats never prints a negative', () => {
    // Which can happen mid-edit: the seat count is typed down before the save
    // that would refuse it.
    const [row] = buildTableIndex([table('T1', { seatCount: 2, soldSeats: 8 })], []);
    expect(row.free).toBe(0);
  });

  test('a category is named, not coloured — the page is one ink', () => {
    const [row] = buildTableIndex(
      [table('T1', { categoryId: 'c1' })],
      [{ id: 'c1', name: 'VIP', color: '#ff0000' }],
    );
    expect(row.category).toBe('VIP');
    expect(row).not.toHaveProperty('color');
  });

  test('an unsaved table is marked as one', () => {
    const [row] = buildTableIndex([table('T1', { id: undefined, localKey: 'new-1' })], []);
    expect(row.unsaved).toBe(true);
  });
});

describe('buildZoneIndex and the summary', () => {
  test('zones are grouped by type, then by name', () => {
    const rows = buildZoneIndex([
      { ...makeZone('stage', { x: 1, y: 1 }), label: 'Main stage' },
      { ...makeZone('bar', { x: 2, y: 2 }), label: 'Bar 2' },
      { ...makeZone('bar', { x: 3, y: 3 }), label: 'Bar 1' },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Bar 1', 'Bar 2', 'Main stage']);
  });

  test('an unlabelled zone still prints a name', () => {
    // An unnamed rectangle on a floor plan is worse than useless at the door.
    const [row] = buildZoneIndex([makeZone('dance_floor', { x: 1, y: 1 })]);
    expect(row.label).toBe('Dance floor');
  });

  test('the summary counts seats, not tables', () => {
    const summary = packSummary(
      [table('T1', { seatCount: 10, soldSeats: 3 }), table('T2', { seatCount: 8, soldSeats: 8, isPrivate: true })],
      [makeZone('bar', { x: 1, y: 1 })],
    );
    expect(summary).toMatchObject({ tables: 2, seats: 18, sold: 11, free: 7, zones: 1, privateTables: 1 });
  });
});

describe('page geometry', () => {
  test('landscape swaps the paper, it does not invent one', () => {
    const portrait = paperBox('a4', 'portrait');
    const landscape = paperBox('a4', 'landscape');
    expect(portrait.width).toBe(PAPERS.a4.width);
    expect(landscape.width).toBe(portrait.height);
    expect(landscape.height).toBe(portrait.width);
  });

  test('an unknown paper falls back rather than producing a zero-sized page', () => {
    expect(paperBox('papyrus', 'portrait').width).toBe(PAPERS.a4.width);
  });

  test('the printable box is inside the sheet on every side', () => {
    const box = paperBox('letter', 'landscape');
    expect(box.inner.width).toBeLessThan(box.width);
    expect(box.inner.height).toBeLessThan(box.height);
  });

  test('the plan is scaled by ONE factor, so the room is not stretched', () => {
    // A floor plan that is not to scale is worse than none — it is used to
    // judge whether a walkway fits between two tables.
    const box = { width: 186, height: 100 };
    const k = planScale(WORLD, box);
    expect(WORLD.width * k).toBeLessThanOrEqual(box.width + 1e-9);
    expect(WORLD.height * k).toBeLessThanOrEqual(box.height + 1e-9);
    expect(k).toBe(Math.min(box.width / WORLD.width, box.height / WORLD.height));
  });

  test('labels sort numerically and case-insensitively', () => {
    expect(['T10', 'T2', 'vip', 'VIP'].sort(compareLabels).slice(0, 2)).toEqual(['T2', 'T10']);
  });

  test('chunk splits exactly, with no lost or empty page', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});
