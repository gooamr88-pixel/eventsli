import { SEAT_PITCH, toPercent, toWorld, worldOf } from '../../../../../components/seating/seatingGeometry';
import { studioId } from '../../../../../components/venue/venueModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A seating section, built in one go: "Section B2, 12 rows of 24, rows A to L,
 * two more seats each row back, fanned toward the stage".
 *
 * A section is not new stock. It is rows — `tables` of shape 'row', each up to
 * 60 seats, exactly what the map has always sold — plus an entry in the
 * layout's `sections` naming them, so a buyer reads "Section B2 · Row H ·
 * Seat 17". Pure: the dialog previews it and the draft adds it, from the same
 * output.
 *
 * TWO SHAPES. `straight`: rows stacked behind one another, turned by `angle`.
 * `wedge`: each row on an arc about the focus point (the stage), at `angle`
 * from straight-on, and turned to face it — the stadium bowl, built one
 * section at a time. With a few seats added per row it becomes the classic
 * trapezoid that widens toward the back.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const MAX_SECTION_ROWS = 30;
export const ROW_GAP = Math.round(SEAT_PITCH * 1.75);

/** A, B … Z, AA, AB … — or 1, 2, 3 when the first row is a number. */
export function rowLabel(start, i) {
  const s = String(start || 'A').trim().toUpperCase();
  if (/^\d+$/.test(s)) return String(Number(s) + i);
  let n = (s.charCodeAt(0) - 65 >= 0 && s.charCodeAt(0) - 65 < 26 ? s.charCodeAt(0) - 65 : 0) + i;
  let out = '';
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * @returns {{ tables: object[], section: { id, name, rows: [{ table, row }] } }}
 *   `tables` are specs for `useMapDraft.addTables`; positions are percentages.
 */
export function buildSection({
  name, rows, seatsPerRow, addPerRow = 0, rowStart = 'A', layout = 'straight', angle = 0,
  gap = ROW_GAP, origin, focus = null, existing = new Set(), tierId = null, world = worldOf(null),
}) {
  const count = clamp(Math.round(Number(rows) || 1), 1, MAX_SECTION_ROWS);
  const base = String(name || 'Section').trim().slice(0, 24) || 'Section';
  // Origin and focus are percentages of the map's world; the rows are laid in
  // its units, so a section is the same size in a ballroom and in a stadium.
  const { x: ox, y: oy } = toWorld(origin, world);
  const taken = new Set([...existing].map((l) => String(l).toLowerCase()));

  let centre;
  let rotation;
  if (layout === 'wedge' && focus) {
    const { x: fx, y: fy } = toWorld(focus, world);
    const d0 = Math.max(SEAT_PITCH * 2, Math.hypot(ox - fx, oy - fy));
    // 90° is straight "below" the focus in a y-down world: the seats face up
    // at the stage. `angle` swings the section around the stage from there.
    const bearing = ((90 + Number(angle || 0)) * Math.PI) / 180;
    centre = (i) => ({ x: fx + Math.cos(bearing) * (d0 + i * gap), y: fy + Math.sin(bearing) * (d0 + i * gap) });
    rotation = Number(angle || 0);
  } else {
    const r = (Number(angle || 0) * Math.PI) / 180;
    centre = (i) => ({ x: ox - Math.sin(r) * i * gap, y: oy + Math.cos(r) * i * gap });
    rotation = Number(angle || 0);
  }

  const tables = [];
  const sectionRows = [];
  // Rows whose middle falls outside the venue. `toPercent` would clamp those
  // onto the edge, stacking them on top of each other, so the dialog refuses
  // instead. (Seats overhanging the edge are allowed, as they always were.)
  let outside = 0;
  for (let i = 0; i < count; i += 1) {
    const row = rowLabel(rowStart, i);
    let label = `${base} ${row}`;
    if (taken.has(label.toLowerCase())) {
      let n = 2;
      while (taken.has(`${label} (${n})`.toLowerCase())) n += 1;
      label = `${label} (${n})`;
    }
    taken.add(label.toLowerCase());
    const c = centre(i);
    const seatCount = clamp(Math.round(Number(seatsPerRow) || 1) + i * Math.round(Number(addPerRow) || 0), 1, 60);
    if (c.x < 0 || c.x > world.width || c.y < 0 || c.y > world.height) outside += 1;
    tables.push({
      label,
      shape: 'row',
      seatCount,
      tierId: tierId || null,
      position: {
        ...toPercent(c.x, c.y, world),
        rotation: round3(rotation),
      },
    });
    sectionRows.push({ table: label, row });
  }

  return { tables, section: { id: studioId('s'), name: base, rows: sectionRows }, outside };
}

/** "B1" → "B2", "B9" → "B10", "Upper" → "Upper 2": the nth name after `base`. */
export function nthSectionName(base, n) {
  const s = String(base || 'Section').trim().slice(0, 24) || 'Section';
  if (n === 0) return s;
  const m = s.match(/^(.*?)(\d+)$/);
  return m ? `${m[1]}${Number(m[2]) + n}` : `${s} ${n + 1}`;
}

export const MAX_RING_SECTIONS = 24;

/**
 * Several wedge sections in one go, `spread` degrees apart and centred on
 * `angle`: a bowl around the stage in one step instead of one dialog per
 * section. Each is a full `buildSection` with the next name ("B1", "B2" …), and
 * the row labels of one are reserved before the next is built, so no two clash.
 *
 * @returns {{ tables: object[], sections: object[], outside: number }}
 */
export function buildRing({ copies = 1, spread = 40, angle = 0, name, existing = new Set(), ...rest }) {
  const n = clamp(Math.round(Number(copies) || 1), 1, MAX_RING_SECTIONS);
  const taken = new Set(existing);
  const out = { tables: [], sections: [], outside: 0 };
  for (let k = 0; k < n; k += 1) {
    const a = Number(angle || 0) + (k - (n - 1) / 2) * Number(spread || 0);
    // Kept within ±180° so a stored rotation reads the way it was meant.
    const turned = ((((a + 180) % 360) + 360) % 360) - 180;
    const one = buildSection({ ...rest, name: nthSectionName(name, k), angle: turned, existing: taken });
    for (const t of one.tables) taken.add(t.label);
    out.tables.push(...one.tables);
    out.sections.push(one.section);
    out.outside += one.outside;
  }
  return out;
}
