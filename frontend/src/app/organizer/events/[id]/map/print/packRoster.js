/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What the printed pack says, worked out once.
 *
 * Kept out of the components on purpose. Everything here is a pure function of
 * the draft, so it can be tested without rendering a page — and the last time a
 * print path of this shape read its data straight out of a component, a
 * top-level function reached for a `useState` local from a different scope
 * entirely and threw on every render. The build stayed green, the linter stayed
 * quiet, and the export shipped completely dead.
 *
 * A function that takes what it needs as an argument cannot do that.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { zoneLabel, zoneMeta } from '../../../../../components/seating/venueZones';
import { SHAPE_NAMES } from '../shapeNames';
import { keyOf } from '../useMapDraft';
import { compareLabels } from './packGeometry';

/**
 * The table index — one row per table, in reading order.
 *
 * SORTED BY LABEL, NOT BY POSITION, and that is the document's whole purpose.
 * The floor plan already answers "where is table 12". This answers the question
 * somebody is actually holding a piece of paper to ask: they have been given a
 * table NAME and need everything about it, which a list ordered by where it
 * happens to sit in the room cannot give them in under a minute.
 */
export function buildTableIndex(tables, categories) {
  const categoryOf = new Map((categories || []).map((c) => [c.id, c]));

  return [...tables]
    .sort((a, b) => compareLabels(a.label, b.label))
    .map((t) => {
      const sold = Number(t.soldSeats) || 0;
      const seats = Number(t.seatCount) || 0;
      return {
        key: keyOf(t),
        label: String(t.label || '').trim() || '—',
        shape: SHAPE_NAMES[t.shape] || t.shape || 'Round',
        seats,
        sold,
        free: Math.max(0, seats - sold),
        category: categoryOf.get(t.categoryId)?.name || null,
        isPrivate: !!t.isPrivate,
        // Not saved yet, so it has no id and no seats on the server. Worth
        // marking on paper: a pack printed from an unsaved draft describes a
        // room the system does not have yet.
        unsaved: !t.id,
      };
    });
}

/** The furniture list, for whoever is setting the room up. */
export function buildZoneIndex(zones) {
  return [...(zones || [])]
    .map((z) => ({
      id: z.id,
      label: zoneLabel(z),
      kind: zoneMeta(z.kind).label,
      width: Math.round(z.w),
      height: Math.round(z.h),
      rotation: Math.round(z.rotation || 0),
    }))
    .sort((a, b) => compareLabels(a.kind, b.kind) || compareLabels(a.label, b.label));
}

/**
 * The letterhead's figures.
 *
 * `sold` counts seats that are held OR sold, because the pack is printed to be
 * used on the day and both mean the same thing to whoever is holding it: that
 * chair is not free to give away.
 */
export function packSummary(tables, zones) {
  let seats = 0;
  let sold = 0;
  let privateTables = 0;

  for (const t of tables) {
    seats += Number(t.seatCount) || 0;
    sold += Number(t.soldSeats) || 0;
    if (t.isPrivate) privateTables += 1;
  }

  return {
    tables: tables.length,
    zones: (zones || []).length,
    seats,
    sold,
    free: Math.max(0, seats - sold),
    privateTables,
  };
}

/**
 * Splits a list into chunks of a fixed size — the table cards, laid out a page
 * at a time.
 *
 * The cards are the one section whose pagination cannot be left to the browser:
 * each card is a fixed fraction of the sheet, so the number per page is decided
 * by arithmetic here, not by where the text happens to run out.
 */
export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
