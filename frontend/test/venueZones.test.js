import { describe, test, expect } from 'vitest';
import {
  ZONES, ZONE_KINDS, MIN_ZONE_SIZE, MAX_ZONES, zoneMeta, zoneBox, zoneColor, zoneLabel,
} from '../src/app/components/seating/venueZones';
import { ZONE_ICONS, iconPaths } from '../src/app/components/seating/zoneIcons';
import { readZones, writeZones, makeZone, newZoneId } from '../src/app/components/seating/layoutZones';
import { WORLD, contentBounds } from '../src/app/components/seating/seatingGeometry';

/**
 * Zones are the one part of the map with NO schema behind it — they live in
 * `venue_maps.layout_json`, which the API writes verbatim and never validates.
 *
 * So this file is that validation. Everything a database CHECK would have
 * enforced on a real column is enforced by `readZones` and `writeZones`
 * instead, and these tests are the only thing standing between a malformed blob
 * and a renderer on the page a buyer is trying to buy from.
 */

describe('the catalogue is complete', () => {
  test('every zone kind has a glyph that exists', () => {
    // A missing icon does not throw — it draws nothing — so it ships silently
    // as a zone that is a blank rectangle on every map and every printout.
    for (const kind of ZONE_KINDS) {
      const { icon } = ZONES[kind];
      expect(icon, `${kind} has no icon`).toBeTruthy();
      expect(iconPaths(icon).length, `${kind}'s icon "${icon}" has no paths`).toBeGreaterThan(0);
    }
  });

  test('no glyph is left behind with no zone using it', () => {
    const used = new Set(ZONE_KINDS.map((k) => ZONES[k].icon));
    for (const name of Object.keys(ZONE_ICONS)) {
      expect(used.has(name), `the "${name}" glyph is unused`).toBe(true);
    }
  });

  test('every zone has a drawable size and a real colour', () => {
    for (const kind of ZONE_KINDS) {
      const meta = ZONES[kind];
      expect(meta.w, kind).toBeGreaterThanOrEqual(MIN_ZONE_SIZE);
      expect(meta.h, kind).toBeGreaterThanOrEqual(MIN_ZONE_SIZE);
      // Smaller than the room, or a single zone covers the whole floor plan.
      expect(meta.w, kind).toBeLessThan(WORLD.width);
      expect(meta.h, kind).toBeLessThan(WORLD.height);
      expect(meta.color, kind).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test('an unknown kind degrades to a drawable box rather than throwing', () => {
    // THE BUG THIS PINS. A raw `ZONES[kind]` lookup returns undefined and
    // throws on the next property access — losing the whole map rather than
    // one rectangle.
    expect(() => zoneMeta('not_a_real_zone')).not.toThrow();
    expect(zoneMeta('not_a_real_zone')).toBe(ZONES.custom);
    expect(zoneMeta(undefined)).toBe(ZONES.custom);
  });
});

describe('readZones — nothing malformed reaches a renderer', () => {
  const ok = { id: 'z1', kind: 'stage', x: 10, y: 20, w: 100, h: 50, rotation: 0 };

  test('a well-formed zone survives intact', () => {
    expect(readZones({ zones: [ok] })[0]).toMatchObject({
      id: 'z1', kind: 'stage', x: 10, y: 20, w: 100, h: 50,
    });
  });

  test('a layout with no zones is an empty list, not a crash', () => {
    for (const layout of [undefined, null, {}, { zones: null }, { zones: 'nope' }, 7]) {
      expect(readZones(layout)).toEqual([]);
    }
  });

  test('an unrecognised kind is DROPPED, not guessed at', () => {
    // Falling back to the custom box would turn a "Stge" typo into an anonymous
    // rectangle the organizer cannot then find in the catalogue to fix.
    const zones = readZones({ zones: [ok, { ...ok, id: 'z2', kind: 'stge' }] });
    expect(zones).toHaveLength(1);
    expect(zones[0].id).toBe('z1');
  });

  test('a duplicate id is re-identified rather than kept', () => {
    // Two zones with one id is not cosmetic: React keys them, selection
    // addresses them, and a drag moves whichever the lookup found first.
    const zones = readZones({ zones: [ok, { ...ok }] });
    expect(zones).toHaveLength(2);
    expect(zones[0].id).toBe('z1');
    expect(zones[1].id).not.toBe('z1');
  });

  test('positions and sizes are clamped to what can be drawn', () => {
    const [zone] = readZones({
      zones: [{ ...ok, x: 900, y: -40, w: 2, h: 99999, rotation: 810 }],
    });
    expect(zone.x).toBe(100);
    expect(zone.y).toBe(0);
    expect(zone.w).toBe(MIN_ZONE_SIZE);
    expect(zone.h).toBe(WORLD.height);
    expect(zone.rotation).toBe(90);
  });

  test('a negative rotation comes back as a positive turn', () => {
    expect(readZones({ zones: [{ ...ok, rotation: -90 }] })[0].rotation).toBe(270);
  });

  test('only a real hex colour is kept', () => {
    expect(readZones({ zones: [{ ...ok, color: '#abc' }] })[0].color).toBe('#abc');
    expect(readZones({ zones: [{ ...ok, color: 'red' }] })[0].color).toBe(null);
    expect(readZones({ zones: [{ ...ok, color: 'javascript:alert(1)' }] })[0].color).toBe(null);
  });

  test('the zone ceiling is enforced on the way in', () => {
    const many = Array.from({ length: MAX_ZONES + 25 }, (_, i) => ({ ...ok, id: `z${i}` }));
    expect(readZones({ zones: many })).toHaveLength(MAX_ZONES);
  });
});

describe('writeZones — a full-replace save cannot destroy what it does not know', () => {
  test('unknown keys on the layout blob are preserved', () => {
    // THE FAILURE THIS PREVENTS. The save is a full replace with nothing to
    // merge against afterwards, so an editor that predates a future
    // `layout.floorPlanImage` would delete it permanently.
    const layout = { world: { width: 1, height: 2 }, floorPlanImage: 'x', somethingElse: [1] };
    const written = writeZones(layout, []);
    expect(written.world).toEqual({ width: 1, height: 2 });
    expect(written.floorPlanImage).toBe('x');
    expect(written.somethingElse).toEqual([1]);
  });

  test('a zone using its kind colour stores no colour at all', () => {
    // Storing the RESOLVED colour would freeze today's palette into every map
    // ever saved, so retuning the catalogue would change nothing.
    const [written] = writeZones({}, [makeZone('bar', { x: 5, y: 5 })]).zones;
    expect(written).not.toHaveProperty('color');
    expect(zoneColor(written)).toBe(ZONES.bar.color);
  });

  test('a round trip is exact, so a saved map does not drift on re-save', () => {
    const before = readZones({ zones: [{ id: 'z1', kind: 'bar', x: 12.345, y: 67.891, w: 96, h: 38, rotation: 45 }] });
    const after = readZones(writeZones({}, before));
    expect(after).toEqual(before);
    // And again — a value that survives one trip must survive every trip.
    expect(readZones(writeZones({}, after))).toEqual(before);
  });

  test('an empty label is dropped so the zone keeps inheriting its kind name', () => {
    const [written] = writeZones({}, [{ ...makeZone('stage', { x: 1, y: 1 }), label: '   ' }]).zones;
    expect(written).not.toHaveProperty('label');
    expect(zoneLabel(written)).toBe(ZONES.stage.label);
  });
});

describe('makeZone and ids', () => {
  test('a new zone takes its size from the catalogue, not from the caller', () => {
    const zone = makeZone('dance_floor', { x: 30, y: 40 });
    expect(zone).toMatchObject({ kind: 'dance_floor', x: 30, y: 40, w: ZONES.dance_floor.w });
  });

  test('an unknown kind becomes a custom area rather than an undrawable one', () => {
    expect(makeZone('nonsense', { x: 0, y: 0 }).kind).toBe('custom');
  });

  test('ids do not collide', () => {
    // They must not, because the save is a full replace: zones added in two
    // different sessions meet in one blob.
    const ids = new Set(Array.from({ length: 500 }, newZoneId));
    expect(ids.size).toBe(500);
  });
});

describe('zoneBox — the corner/centre confusion that scatters a map', () => {
  test('x and y are the CENTRE; the box is derived from it', () => {
    const box = zoneBox({ kind: 'stage', x: 50, y: 50, w: 100, h: 60 }, WORLD);
    expect(box.cx).toBe(WORLD.width / 2);
    expect(box.cy).toBe(WORLD.height / 2);
    expect(box.x).toBe(box.cx - 50);
    expect(box.right).toBe(box.cx + 50);
    expect(box.bottom).toBe(box.cy + 30);
  });

  test('a size below the minimum falls back to the catalogue, not to zero', () => {
    const box = zoneBox({ kind: 'bar', x: 0, y: 0, w: 1, h: 0 }, WORLD);
    expect(box.w).toBe(ZONES.bar.w);
    expect(box.h).toBe(ZONES.bar.h);
  });
});

describe('the opening frame includes the furniture', () => {
  test('a map of zones alone is still framed', () => {
    // Otherwise a room with the stage placed but no tables yet opens showing
    // the whole empty world.
    const zones = readZones({ zones: [{ id: 'z1', kind: 'stage', x: 50, y: 50, w: 100, h: 60 }] });
    const bounds = contentBounds([], zones);
    expect(bounds.width).toBeLessThan(WORLD.width);
  });

  test('a zone outside the tables widens the frame to reach it', () => {
    const tables = [{ shape: 'round', seatCount: 8, position: { x: 50, y: 50 } }];
    const tight = contentBounds(tables, []);
    const wide = contentBounds(tables, readZones({
      zones: [{ id: 'z1', kind: 'stage', x: 5, y: 5, w: 120, h: 60 }],
    }));
    expect(wide.width).toBeGreaterThan(tight.width);
  });

  test('the old single-argument call still works', () => {
    // Two callers predate zones. A required second argument would have framed
    // their maps to `undefined`.
    expect(() => contentBounds([])).not.toThrow();
    expect(contentBounds([])).toEqual({ x: 0, y: 0, width: WORLD.width, height: WORLD.height });
  });
});
