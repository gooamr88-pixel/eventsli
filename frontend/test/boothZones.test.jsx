import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  BOOTH_KIND, alignPlan, boothRowSpecs, boothsToZones, isBooth, nextBoothNumber, samePlan, zonesToPlan,
} from '../src/app/components/seating/boothZones';
import { readZones, writeZones, makeZone } from '../src/app/components/seating/layoutZones';
import { zoneMeta, ZONE_KINDS, BOOTH_META } from '../src/app/components/seating/venueZones';
import { mapProblems } from '../src/app/organizer/events/[id]/map/draftRules';
import BoothPanel from '../src/app/organizer/events/[id]/map/BoothPanel';
import { BUILD_GROUPS } from '../src/app/organizer/events/[id]/map/BuildPanel';
import { forgetSections } from '../src/app/components/inspector/Inspector';

/**
 * Vendor booths on the venue map (2026-11-22, the owner: "merge the seating
 * map of the event and the seating map of vendors"). Booths are edited as
 * zones of kind `booth` and saved to the vendor floor plan — never into the
 * seat map's layout blob — and every booth keeps its id, which is what offers
 * and bookings point at.
 */
const WORLD = { width: 1000, height: 700 };
const TYPE = '11111111-1111-1111-1111-111111111111';
const plan = (elements, extra = {}) => ({ width: 1000, height: 700, onSeatMap: true, elements, ...extra });
const booth = (over = {}) => ({ id: 'b1', kind: 'booth', x: 100, y: 200, w: 60, h: 40, r: 0, code: 'A1', boothTypeId: TYPE, blocked: false, ...over });

beforeEach(() => { window.localStorage.clear(); forgetSections(); });

describe('plan ↔ zones', () => {
  test('a booth becomes a centred zone and comes back exactly', () => {
    const [z] = boothsToZones(plan([booth()]), WORLD);
    expect(z).toMatchObject({ id: 'b1', kind: BOOTH_KIND, label: 'A1', w: 60, h: 40, boothTypeId: TYPE, blocked: false });
    // Centre (130, 220) as percentages of the world.
    expect(z.x).toBeCloseTo(13, 3);
    expect(z.y).toBeCloseTo(31.429, 3);
    const back = zonesToPlan([z], WORLD);
    expect(back.onSeatMap).toBe(true);
    expect(back.width).toBe(1000);
    expect(back.elements).toEqual([booth()]);
  });

  test('a turned booth keeps its turn, written between −180 and 180', () => {
    const [z] = boothsToZones(plan([booth({ r: -90 })]), WORLD);
    expect(z.rotation).toBe(270);
    expect(zonesToPlan([z], WORLD).elements[0].r).toBe(-90);
  });

  test('a separate plan of another size is scaled into the venue', () => {
    const [z] = boothsToZones({ width: 2000, height: 1400, elements: [booth({ x: 0, y: 0, w: 200, h: 140 })] }, WORLD);
    expect(z.w).toBe(100);
    expect(z.h).toBe(70);
    expect(z.x).toBeCloseTo(5, 3);
    expect(z.y).toBeCloseTo(5, 3);
  });

  test('only booths cross over; walls and labels of the old plan stay behind', () => {
    const zones = boothsToZones(plan([booth(), { id: 'w1', kind: 'wall', points: [[0, 0], [10, 0]] }]), WORLD);
    expect(zones.map((z) => z.id)).toEqual(['b1']);
  });

  test('the buyer’s copy carries each booth’s state and colour', () => {
    const [z] = boothsToZones(plan([booth()]), WORLD, {
      withState: { states: { b1: { status: 'sold', vendor: { name: 'Bean Co' } } }, boothTypes: [{ id: TYPE, name: 'Food', color: '#123456' }] },
    });
    expect(z.state.vendor.name).toBe('Bean Co');
    expect(z.typeColor).toBe('#123456');
    expect(z.typeName).toBe('Food');
  });

  test('samePlan ignores order and notices a moved booth', () => {
    const a = plan([booth(), booth({ id: 'b2', code: 'A2', x: 160 })]);
    const b = plan([booth({ id: 'b2', code: 'A2', x: 160 }), booth()]);
    expect(samePlan(a, b)).toBe(true);
    expect(samePlan(a, plan([booth({ x: 101 }), booth({ id: 'b2', code: 'A2', x: 160 })]))).toBe(false);
    expect(samePlan(a, null)).toBe(false);
  });

  test('a venue resized since the booths were saved scales them with it', () => {
    const aligned = alignPlan(plan([booth()]), { width: 2000, height: 1400 });
    expect(aligned.elements[0]).toMatchObject({ x: 200, y: 400, w: 120, h: 80 });
    // A standalone plan is drawn as it is.
    const standalone = { width: 1200, height: 800, elements: [booth()] };
    expect(alignPlan(standalone, WORLD)).toBe(standalone);
  });
});

describe('the seat map blob never holds a booth', () => {
  test('writeZones leaves booths out and readZones drops one that got in', () => {
    const stage = makeZone('stage', { x: 50, y: 10 });
    const [b] = boothsToZones(plan([booth()]), WORLD);
    const layout = writeZones({ world: WORLD }, [stage, b]);
    expect(layout.zones.map((z) => z.kind)).toEqual(['stage']);
    expect(readZones({ world: WORLD, zones: [...layout.zones, { ...b }] }).map((z) => z.kind)).toEqual(['stage']);
  });

  test('a booth is not in the area catalogue the AI and the Add dialog read', () => {
    expect(ZONE_KINDS).not.toContain(BOOTH_KIND);
    expect(zoneMeta(BOOTH_KIND)).toBe(BOOTH_META);
    expect(makeZone(BOOTH_KIND, { x: 10, y: 10 }).kind).toBe(BOOTH_KIND);
  });

  test('booths do not count against the 300-area ceiling', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ ...makeZone(BOOTH_KIND, { x: 50, y: 50 }), label: `A${i + 1}` }));
    expect(mapProblems([], many)).toEqual([]);
    expect(mapProblems([], [{ ...many[0], label: 'ABCDEFGHIJKLM' }])).toContain('A booth code can be at most 12 characters.');
  });
});

describe('numbering and rows', () => {
  test('the next number continues the series on the map', () => {
    const zones = [{ kind: BOOTH_KIND, label: 'A3' }, { kind: BOOTH_KIND, label: 'A10' }, { kind: BOOTH_KIND, label: 'B2' }, { kind: 'stage', label: 'A99' }];
    expect(nextBoothNumber(zones, 'A')).toBe(11);
    expect(nextBoothNumber(zones, 'b')).toBe(3);
    expect(nextBoothNumber(zones, 'C')).toBe(1);
  });

  test('a row of touching booths is centred where it was placed', () => {
    const specs = boothRowSpecs({ centre: { x: 50, y: 50 }, count: 3, w: 100, h: 50, prefix: 'A', start: 4, boothTypeId: TYPE }, WORLD);
    expect(specs.map((s) => s.overrides.label)).toEqual(['A4', 'A5', 'A6']);
    expect(specs.every((s) => s.kind === BOOTH_KIND && s.overrides.boothTypeId === TYPE)).toBe(true);
    // 300 wide about x = 500: centres at 400, 500, 600.
    expect(specs.map((s) => Math.round(s.position.x * 10))).toEqual([400, 500, 600]);
    const down = boothRowSpecs({ centre: { x: 50, y: 50 }, count: 2, w: 100, h: 70, gap: 10, direction: 'down' }, WORLD);
    expect(down.map((s) => Math.round((s.position.y / 100) * 700))).toEqual([310, 390]);
  });
});

describe('the editor', () => {
  const zone = () => boothsToZones(plan([booth()]), WORLD)[0];
  const info = (state) => ({ states: state ? { b1: state } : {}, boothTypes: [{ id: TYPE, name: 'Food' }] });

  test('a booth a vendor holds names them, links the application, and cannot be deleted', () => {
    render(
      <BoothPanel
        zone={zone()} eventId="ev1" boothInfo={info({ status: 'sold', vendor: { name: 'Bean Co' }, applicationId: 'app1' })}
        onChange={() => {}} onRotate={() => {}} onDuplicate={() => {}} onRemove={() => {}}
      />,
    );
    expect(screen.getByText('Booked')).toBeInTheDocument();
    expect(screen.getByText(/Bean Co/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open application' })).toHaveAttribute('href', '/organizer/events/ev1/vendors/app1');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  test('a free booth shows its code and type and can be deleted', () => {
    render(<BoothPanel zone={zone()} eventId="ev1" boothInfo={info(null)} onChange={() => {}} onRotate={() => {}} onDuplicate={() => {}} onRemove={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Booth A1' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Booth type' })).toHaveValue(TYPE);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  test('Add to layout offers vendor booths as their own group', () => {
    const group = BUILD_GROUPS.find((g) => g.key === 'vendors');
    expect(group.needsVendors).toBe(true);
    expect(group.items.map((it) => it.initial.family)).toEqual(['booth', 'boothRow']);
  });

  test('isBooth', () => {
    expect(isBooth({ kind: 'booth' })).toBe(true);
    expect(isBooth({ kind: 'stage' })).toBe(false);
  });
});
