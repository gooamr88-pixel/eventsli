import { worldOf } from '../seating/seatingGeometry';
import { readZones, writeZones } from '../seating/layoutZones';
import { readLook, readTableStyles, writeLook, writeTableStyles } from '../seating/mapStyle';
import { readStudio } from '../venue/venueModel';
import { COUNTRY_NAMES } from '../../lib/markets';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The venue map library's data, in the browser (2026-11-24). A template is
 * the map ONLY (owner's rule): `{ layout, tables, groups }` — see
 * backend/services/venueMapTemplateService.js.
 *
 *   toEditorSpec     a template → what the Venue Builder's `draft.loadMap`
 *                    takes (tables with their styles, zones, world, look,
 *                    sections); each colour group finds the event's table
 *                    category of the same name
 *   fromImportedMap  a seating-chart picture read by AI (`planToMap`) → the
 *                    data the admin console saves as a template
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const VENUE_KINDS = Object.freeze([
  { value: 'arena', label: 'Arena' },
  { value: 'stadium', label: 'Stadium' },
  { value: 'theatre', label: 'Theatre' },
  { value: 'concert_hall', label: 'Concert hall' },
  { value: 'ballroom', label: 'Ballroom' },
  { value: 'banquet_hall', label: 'Banquet hall' },
  { value: 'conference', label: 'Conference centre' },
  { value: 'club', label: 'Club or bar' },
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'other', label: 'Other venue' },
]);
const KIND_LABEL = Object.fromEntries(VENUE_KINDS.map((k) => [k.value, k.label]));
export const kindLabel = (k) => KIND_LABEL[k] || 'Venue';

/** "Toronto, Canada" — the place line under a venue's name. */
export function placeLine(venue = {}) {
  const country = venue.country ? (COUNTRY_NAMES[venue.country] || venue.country) : null;
  return [venue.city, country].filter(Boolean).join(', ');
}

/** The figures a card or a row shows: "1,240 seats · 3 sections · 4 areas". */
export function mapFacts(summary = {}) {
  const out = [];
  const n = (v) => Number(v || 0).toLocaleString('en');
  if (summary.seats) out.push(`${n(summary.seats)} seats`);
  if (summary.sections) out.push(`${summary.sections} section${summary.sections === 1 ? '' : 's'}`);
  if (summary.tables) out.push(`${n(summary.tables)} table${summary.tables === 1 ? '' : 's'}`);
  if (summary.standing) out.push(`${n(summary.standing)} standing`);
  if (summary.areas) out.push(`${summary.areas} area${summary.areas === 1 ? '' : 's'}`);
  return out;
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * A template's map, ready for the Venue Builder's draft. `categories` are
 * the event's table categories; nothing about prices or ticket types is in a
 * template, so tables arrive without them for the organizer to assign.
 */
export function toEditorSpec(data, categories = []) {
  const layout = data?.layout || {};
  const styles = readTableStyles(layout);
  const catByName = new Map(categories.map((c) => [norm(c.name), c.id]));
  const groupName = new Map((data?.groups || []).map((g) => [g.key, norm(g.name)]));
  const tables = (data?.tables || []).map((t) => ({
    label: t.label,
    seatCount: t.seatCount,
    priceCents: null,
    shape: t.shape,
    position: t.position,
    tierId: null,
    categoryId: t.groupKey ? catByName.get(groupName.get(t.groupKey)) || null : null,
    seatPriceCents: null,
    style: styles.get(norm(t.label)) || null,
  }));
  return {
    tables,
    zones: readZones(layout),
    world: worldOf(layout),
    look: readLook(layout),
    sections: readStudio(layout).sections,
  };
}

/** Groups of the template that this event has no category for — said on use. */
export function unmatchedGroups(data, categories = []) {
  const have = new Set(categories.map((c) => norm(c.name)));
  return (data?.groups || []).map((g) => g.name).filter((name) => !have.has(norm(name)));
}

/**
 * A map rebuilt from a picture (`planToMap` → `{ tables, zones, world, look }`)
 * as template data. Labels are made unique — a printed chart can repeat one —
 * because a template, like a saved map, needs every table named once.
 */
export function fromImportedMap(map) {
  const seen = new Map();
  const tables = (map?.tables || []).map((t, i) => {
    let label = String(t.label || '').trim().slice(0, 36) || `T${i + 1}`;
    const key = label.toLowerCase();
    if (seen.has(key)) {
      const n = seen.get(key) + 1;
      seen.set(key, n);
      label = `${label}-${n}`;
    } else seen.set(key, 1);
    return { ...t, label };
  });
  const world = map?.world || worldOf(null);
  const layout = writeLook(
    writeTableStyles(writeZones({ world: { width: world.width, height: world.height } }, map?.zones || []), tables),
    map?.look,
  );
  return {
    layout,
    groups: [],
    tables: tables.map((t) => ({
      label: t.label,
      seatCount: t.seatCount,
      shape: t.shape,
      position: { x: t.position.x, y: t.position.y, rotation: t.position.rotation || 0 },
    })),
  };
}
