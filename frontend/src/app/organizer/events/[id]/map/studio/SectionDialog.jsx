'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useModal } from '../../../../../hooks/useModal';
import {
  METRES_PER_UNIT, SEAT_PITCH, seatPositions, toWorld, worldOf, worldScale,
} from '../../../../../components/seating/seatingGeometry';
import { zoneBox } from '../../../../../components/seating/venueZones';
import { buildRing, MAX_RING_SECTIONS, MAX_SECTION_ROWS } from './sectionBuilder';
import { NumberField, Pair, TextField, SelectField, RangeField, Segmented } from '../../../../../components/inspector/fields';
import NewTierInline, { NEW_TIER } from '../NewTierInline';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Add a seating section": rows × seats, named, priced and placed in one step,
 * with the section drawn as it will land before anything is added.
 *
 * One submission is one undo step, like the Add dialog's multi-add — a twelve-
 * row section undone row by row is twelve presses of Ctrl+Z.
 *
 * FANNED SECTIONS NEED A STAGE. A wedge is laid on an arc about the stage, so
 * with no stage on the map the option says why it is unavailable instead of
 * guessing where the front of the room is. With a stage, several sections can
 * be fanned around it at once (`buildRing`) — the way a bowl is built.
 *
 * Everything is in the map's own world (`world`, the venue's size), so the
 * distance from the stage reaches as far as the venue does.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SectionDialog({
  origin, zones, tables, tiers, roomForTables, onAdd, onClose, onTierCreated, world = worldOf(null), placeAt = null,
}) {
  const [creatingTier, setCreatingTier] = useState(false);
  const stage = zones.find((z) => z.kind === 'stage') || null;
  const existing = useMemo(() => new Set(tables.map((t) => t.label)), [tables]);
  const [name, setName] = useState(() => nextSectionName(tables));
  const [rows, setRows] = useState(8);
  const [seatsPerRow, setSeatsPerRow] = useState(16);
  const [addPerRow, setAddPerRow] = useState(0);
  const [rowStart, setRowStart] = useState('A');
  const [layout, setLayout] = useState(stage ? 'wedge' : 'straight');
  const [angle, setAngle] = useState(0);
  // null until the organizer moves the slider: then the section keeps itself
  // clear of the seats already there (`autoDistance`, below).
  const [chosenDistance, setDistance] = useState(null);
  const [copies, setCopies] = useState(1);
  const [spread, setSpread] = useState(40);
  const [tierId, setTierId] = useState(tiers[0]?.id || '');
  const ref = useRef(null);
  const wedge = layout === 'wedge' && !!stage;
  // As far from the stage as half the venue's shorter side, and never less
  // than the 420 units (9.6 m) a ballroom always offered.
  const maxDistance = Math.max(420, Math.floor(Math.min(world.width, world.height) / 10) * 5);

  useEffect(() => { ref.current?.focus(); }, []);
  useModal(ref, onClose, { stopEscape: true });

  // The seats already on the map, hashed for a quick "is anyone sitting here?".
  const taken = useMemo(() => seatGrid(tables, world), [tables, world]);

  // A wedge's first row sits `distance` map units in front of the stage.
  const wedgeOriginAt = useMemo(() => (d) => {
    if (!stage) return origin;
    const b = zoneBox(stage, world);
    return { x: (b.cx / world.width) * 100, y: ((b.cy + b.h / 2 + d) / world.height) * 100 };
  }, [stage, origin, world]);

  const buildAt = useMemo(() => (d) => buildRing({
    name, rows, seatsPerRow, addPerRow, rowStart, layout: stage ? layout : 'straight', angle,
    origin: wedge ? wedgeOriginAt(d) : origin,
    focus: stage ? { x: stage.x, y: stage.y } : null,
    existing, tierId: tierId || null, world,
    copies: wedge ? copies : 1, spread,
  }), [name, rows, seatsPerRow, addPerRow, rowStart, layout, angle, origin, wedgeOriginAt, stage, existing, tierId, world, wedge, copies, spread]);

  /**
   * THE NEAREST DISTANCE THAT SITS ON NOBODY (2026-11-21). It defaulted to a
   * fixed 1.6 m in front of the stage — on a map that already had rows there,
   * straight on top of them. Until the organizer moves the slider, the fanned
   * section steps back from the stage until no new seat lands on an old one,
   * and keeps doing so as rows and seats are changed.
   */
  const autoDistance = useMemo(() => {
    if (!wedge || taken.size === 0) return 70;
    // Nowhere fully clear (a full room): the least crowded distance inside the
    // venue, so the overlap warning below names as few seats as it can.
    let best = 70;
    let bestCount = Infinity;
    for (let d = 40; d <= maxDistance; d += 10) {
      const b = buildAt(d);
      if (b.outside !== 0) continue;
      const n = overlapCount(b.tables, taken, world);
      if (n === 0) return d;
      if (n < bestCount) { best = d; bestCount = n; }
    }
    return best;
  }, [wedge, taken, maxDistance, buildAt, world]);
  const distance = chosenDistance ?? autoDistance;

  const raw = useMemo(() => buildAt(distance), [buildAt, distance]);

  /**
   * WHERE A STRAIGHT SECTION LANDS (2026-11-21): centred on the nearest free
   * spot in view (`placeAt`, mapApi.freeSpot), the same rule as a stage or an
   * area — not hung from the view's top-left corner, where it sat jammed into
   * the room's corner. A fanned section keeps its place in front of the stage.
   */
  const built = useMemo(() => {
    if (wedge || !placeAt || raw.tables.length === 0) return raw;
    const box = seatBox(raw.tables, world);
    const target = toWorld(placeAt({ w: box.x1 - box.x0, h: box.y1 - box.y0 }), world);
    const dx = ((target.x - (box.x0 + box.x1) / 2) / world.width) * 100;
    const dy = ((target.y - (box.y0 + box.y1) / 2) / world.height) * 100;
    const moved = raw.tables.map((t) => ({ ...t, position: { ...t.position, x: t.position.x + dx, y: t.position.y + dy } }));
    const outside = moved.filter((t) => t.position.x < 0 || t.position.x > 100 || t.position.y < 0 || t.position.y > 100).length;
    return { ...raw, tables: moved, outside };
  }, [raw, wedge, placeAt, world]);

  const seatTotal = built.tables.reduce((n, t) => n + t.seatCount, 0);
  const fits = built.tables.length <= roomForTables && built.outside === 0;
  const overlaps = useMemo(() => overlapCount(built.tables, taken, world), [built, taken, world]);

  function submit(e) {
    e.preventDefault();
    if (!fits || !String(name).trim()) return;
    onAdd(built);
    onClose();
  }

  return (
    <div className="es-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        ref={ref} tabIndex={-1} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="es-section-title"
        className="es-backdrop__panel es-backdrop__panel--wide es-sectiondlg"
      >
        <div>
          <h2 id="es-section-title" className="text-lg">Add a seating section</h2>
          <p className="text-sm text-muted">Rows of seats, numbered and named as one section — buyers see “Section {String(name).trim() || '…'} · Row {rowStart || 'A'} · Seat 1”.</p>
        </div>

        <div className="es-sectiondlg__body">
          <div className="fx-stack">
            {/* In pairs, the two that belong together side by side, so the
                whole form is seen without scrolling (2026-11-21). */}
            <Pair>
              <TextField label="Section name" value={name} onChange={setName} maxLength={24} required />
              <SelectField
                label="Ticket type" value={tierId}
                onChange={(v) => { if (v === NEW_TIER) setCreatingTier(true); else setTierId(v); }}
                options={[['', 'Choose later'], ...tiers.map((t) => [t.id, t.name]), [NEW_TIER, '+ New ticket type…']]}
              />
            </Pair>
            <Pair>
              <NumberField label="Rows" value={rows} min={1} max={MAX_SECTION_ROWS} onChange={setRows} />
              <NumberField label="Seats per row" value={seatsPerRow} min={1} max={60} onChange={setSeatsPerRow} />
            </Pair>
            <Pair>
              <TextField label="First row" value={rowStart} onChange={(v) => setRowStart(v.slice(0, 3))} maxLength={3} hint="A, B, C… or 1, 2, 3…" />
              <NumberField label="Extra per row" value={addPerRow} min={0} max={6} onChange={setAddPerRow} hint="Widens it toward the back." />
            </Pair>
            {creatingTier && (
              <NewTierInline
                onCreated={(tier) => { onTierCreated?.(tier); setTierId(tier.id); setCreatingTier(false); }}
                onCancel={() => setCreatingTier(false)}
              />
            )}

            <Segmented stacked
              label="Shape"
              value={stage ? layout : 'straight'}
              onChange={setLayout}
              options={[
                { key: 'straight', label: 'Straight rows' },
                ...(stage ? [{ key: 'wedge', label: 'Fanned toward the stage' }] : []),
              ]}
            />
            {!stage && <p className="text-xs text-subtle">Add a stage to the map to fan sections around it.</p>}

            {/* All the way round: a bowl has sections behind the stage's
                sides too, so ±180° rather than the ±85° of a theatre. */}
            <RangeField
              label={wedge ? (copies > 1 ? 'Centre of the sections around the stage' : 'Position around the stage') : 'Rotation'}
              value={angle} min={-180} max={180} onChange={setAngle}
              format={(v) => `${v > 0 ? '+' : ''}${v}°`}
            />
            {wedge && (
              <RangeField
                label="Distance from the stage" value={Math.min(distance, maxDistance)} min={20} max={maxDistance} step={5} onChange={setDistance}
                format={(v) => `${(v * METRES_PER_UNIT).toFixed(1)} m`}
              />
            )}
            {wedge && (
              <div className="fx-grid" style={{ '--fx-col': '140px', '--fx-gap': '12px' }}>
                <NumberField
                  label="Sections around the stage" value={copies} min={1} max={MAX_RING_SECTIONS} onChange={setCopies}
                  hint="Named in order: B1, B2, B3…"
                />
                {copies > 1 && (
                  <RangeField
                    label="Between sections" value={spread} min={5} max={90} onChange={setSpread}
                    format={(v) => `${v}°`}
                  />
                )}
              </div>
            )}
          </div>

          <SectionPreview built={built} zones={zones} tables={tables} world={world} />
        </div>

        {built.tables.length > roomForTables && (
          <p className="text-sm text-warning" role="alert">
            The map has room for {roomForTables} more {roomForTables === 1 ? 'row' : 'rows'}. Use fewer rows or sections.
          </p>
        )}
        {/* Said before the click, with the way out: a section on top of
            seats already sold is a map nobody can untangle afterwards. */}
        {overlaps > 0 && (
          <div className="es-sectiondlg__warn" role="status">
            <p className="text-sm text-warning">
              {overlaps} new {overlaps === 1 ? 'seat sits' : 'seats sit'} on top of seats already on the map.
            </p>
            {wedge && chosenDistance !== null && autoDistance !== chosenDistance && (
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => setDistance(null)}>
                Move it clear
              </button>
            )}
          </div>
        )}
        {built.outside > 0 && (
          <p className="text-sm text-warning" role="alert">
            {built.outside} {built.outside === 1 ? 'row falls' : 'rows fall'} outside the venue. Bring the section closer to the stage, or make the venue bigger in the Venue tab.
          </p>
        )}

        <div className="fx-row fx-row--between flex-wrap gap-2 border-t border-border-base pt-4">
          <p className="text-sm text-muted">
            <b className="es-nums text-ink">{built.tables.length}</b> rows · <b className="es-nums text-ink">{seatTotal.toLocaleString('en')}</b> seats
          </p>
          <div className="fx-row gap-2">
            <button type="button" onClick={onClose} className="es-btn es-btn--ghost">Cancel</button>
            <button type="submit" disabled={!fits} className="es-btn es-btn--primary">
              {built.sections.length > 1 ? `Add ${built.sections.length} sections` : 'Add section'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/** The section where it will land, among what is already on the map. */
function SectionPreview({ built, zones, tables, world }) {
  // Seats are drawn bigger in a bigger venue, or a stadium's are specks.
  const dot = 6 * worldScale(world);
  const pad = 40 * worldScale(world);
  const dots = (list, cls) => list.flatMap((t) => {
    const p = toWorld(t.position, world);
    const r = (p.rotation * Math.PI) / 180;
    return seatPositions(t.shape, t.seatCount).map((pt, i) => (
      <circle
        key={`${t.label}-${i}`} r={dot} className={cls}
        cx={p.x + pt.x * Math.cos(r) - pt.y * Math.sin(r)}
        cy={p.y + pt.x * Math.sin(r) + pt.y * Math.cos(r)}
      />
    ));
  });
  return (
    <figure className="es-sectiondlg__preview">
      <svg viewBox={`${-pad} ${-pad} ${world.width + pad * 2} ${world.height + pad * 2}`} role="img" aria-label="Preview of the new section on the map">
        <rect x={0} y={0} width={world.width} height={world.height} rx={18 * worldScale(world)} className="es-sectiondlg__floor" />
        {zones.map((z) => {
          const b = zoneBox(z, world);
          return (
            <rect key={z.id} x={b.x} y={b.y} width={b.w} height={b.h} rx={6}
              transform={`rotate(${b.rotation} ${b.cx} ${b.cy})`}
              className={z.kind === 'stage' ? 'es-sectiondlg__stage' : 'es-sectiondlg__zone'} />
          );
        })}
        {dots(tables, 'es-sectiondlg__old')}
        {dots(built.tables, 'es-sectiondlg__new')}
      </svg>
      <figcaption className="text-xs text-subtle">New seats in colour. Drag the rows anywhere afterwards.</figcaption>
    </figure>
  );
}

/** Each seat of these rows in world units, turned with its row. */
function seatPoints(tables, world, visit) {
  for (const t of tables) {
    const p = toWorld(t.position, world);
    const r = (p.rotation * Math.PI) / 180;
    for (const pt of seatPositions(t.shape, t.seatCount)) {
      visit(p.x + pt.x * Math.cos(r) - pt.y * Math.sin(r), p.y + pt.x * Math.sin(r) + pt.y * Math.cos(r));
    }
  }
}

// Clearance, not touching: rows slotted between existing rows clear each
// other by a hair and leave nowhere to walk, so a new seat must stay a
// seat and a quarter from every old one (and the grid cell covers that).
const CLEARANCE = SEAT_PITCH * 1.25;
const CELL = Math.ceil(CLEARANCE) + 1;
const cellKey = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;

/** The existing seats, bucketed by cell, so overlap checks stay quick on a stadium. */
function seatGrid(tables, world) {
  const grid = new Map();
  seatPoints(tables, world, (x, y) => {
    const k = cellKey(x, y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([x, y]);
  });
  return grid;
}

/** How many of these new seats would sit on, or crowd, an existing one. */
function overlapCount(newTables, grid, world) {
  if (grid.size === 0) return 0;
  const min = CLEARANCE;
  let n = 0;
  seatPoints(newTables, world, (x, y) => {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        const bucket = grid.get(`${cx + i}:${cy + j}`);
        if (bucket && bucket.some(([ox, oy]) => Math.hypot(ox - x, oy - y) < min)) { n += 1; return; }
      }
    }
  });
  return n;
}

/** Every seat of these rows, as one box in world units. */
function seatBox(tables, world) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const t of tables) {
    const p = toWorld(t.position, world);
    const r = (p.rotation * Math.PI) / 180;
    for (const pt of seatPositions(t.shape, t.seatCount)) {
      const x = p.x + pt.x * Math.cos(r) - pt.y * Math.sin(r);
      const y = p.y + pt.x * Math.sin(r) + pt.y * Math.cos(r);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}

function nextSectionName(tables) {
  const used = new Set(tables.map((t) => String(t.label).split(' ')[0].toUpperCase()));
  for (const letter of 'ABCDEFGHJKLMNPQRSTUVWXYZ') {
    for (let n = 1; n <= 9; n += 1) if (!used.has(`${letter}${n}`)) return `${letter}${n}`;
  }
  return 'New';
}

