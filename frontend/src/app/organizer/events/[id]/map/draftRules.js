/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What the editor refuses BEFORE the round trip, and how it names things.
 *
 * Split out of `useMapDraft` when the draft grew zones, multi-select and bulk
 * operations: the hook is state machinery, and this is the rule book. They
 * change for entirely different reasons — a rule moves when the API's
 * validation moves, the machinery moves when the interaction does.
 *
 * EVERY RULE HERE MIRRORS ONE THE API ALREADY ENFORCES. That duplication is
 * deliberate and is the point: the server's messages are accurate but they
 * arrive after a save that looked like it was working, and a save is a full
 * replace of a four-hundred-table room. Being told "two tables are both called
 * T7" while the Save button is still enabled is worth a second copy of the rule.
 *
 * Nothing here is the only enforcement of anything. If a rule below is wrong,
 * the save is still refused — correctly, just later and less kindly.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { SHAPES } from '../../../../components/seating/seatingGeometry';
import { MAX_ZONES } from '../../../../components/seating/venueZones';

/** The API's own ceilings (`venueService.js`), mirrored. */
export const MAX_TABLES = 400;
export const MAX_SEATS_PER_TABLE = 60;

/**
 * Everything wrong with the draft, in the order an organizer would want to fix
 * it: the things that name a specific table first, the global ceilings last.
 *
 * Zones are validated far more loosely than tables, and that asymmetry is
 * correct rather than an oversight. A table is stock — a bad one becomes a
 * ticket somebody holds. A zone is a rectangle in a JSON blob that `readZones`
 * sanitises on the way back in; the worst a bad one can do is look wrong.
 */
export function mapProblems(tables, zones) {
  const out = [];

  const duplicates = duplicateLabels(tables);
  if (duplicates.length > 0) {
    out.push(`Two tables share a name: ${duplicates.join(', ')}. Names must be unique.`);
  }
  if (tables.some((t) => !String(t.label || '').trim())) {
    out.push('Every table needs a name.');
  }
  if (tables.some((t) => !Number.isInteger(Number(t.seatCount))
    || t.seatCount < 1 || t.seatCount > MAX_SEATS_PER_TABLE)) {
    out.push(`Seats per table must be between 1 and ${MAX_SEATS_PER_TABLE}.`);
  }
  if (tables.some((t) => !SHAPES.includes(t.shape))) {
    out.push('A table has a shape the map cannot draw.');
  }
  // A private table with no password and no id has never had one — the API
  // refuses it, and the message there is less specific than this one.
  if (tables.some((t) => t.isPrivate && !t.password && !t.id)) {
    out.push('A private table needs a password before it can be saved.');
  }
  if (tables.length > MAX_TABLES) out.push(`A map holds at most ${MAX_TABLES} tables.`);
  if ((zones?.length || 0) > MAX_ZONES) out.push(`A map holds at most ${MAX_ZONES} venue zones.`);

  return out;
}

/** Duplicate labels are the one thing the API refuses that a person cannot see
 *  coming, so it is surfaced before Save rather than after. */
export function duplicateLabels(tables) {
  const seen = new Map();
  for (const t of tables) {
    const key = String(t.label || '').trim().toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([label]) => label);
}

/**
 * The next free `T…` label.
 *
 * `taken` is passed in rather than recomputed, because adding twenty tables at
 * once would otherwise rebuild the set twenty times and — far worse — hand out
 * the same name twenty times, since none of them are in the list yet. The
 * caller adds each name as it goes.
 */
export function nextLabel(taken) {
  for (let n = 1; n <= MAX_TABLES + 1; n += 1) {
    const candidate = `T${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `T${Date.now()}`;
}

/**
 * A label for a copy of something, or for the nth of a batch.
 *
 * "Stage" → "Stage 2" → "Stage 3", not "Stage copy copy". An organizer
 * duplicating a bar four times wants bars numbered 1–4, which is what they
 * would have typed, and the trailing number is how every one of these ends up
 * named anyway.
 *
 * `taken` is case-insensitive because the table labels it guards are — the API
 * treats "vip" and "VIP" as the same name and refuses the pair.
 */
export function numberedLabel(base, taken) {
  const stem = String(base || '').replace(/\s*\d+$/, '').trim() || 'Area';
  for (let n = 2; n <= 999; n += 1) {
    const candidate = `${stem} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem} ${Date.now()}`;
}
