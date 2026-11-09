'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useModal } from '../../../../../hooks/useModal';
import {
  METRES_PER_UNIT, seatPositions, toWorld, worldOf, worldScale,
} from '../../../../../components/seating/seatingGeometry';
import { zoneBox } from '../../../../../components/seating/venueZones';
import { buildRing, MAX_RING_SECTIONS, MAX_SECTION_ROWS } from './sectionBuilder';
import { NumberField, TextField, SelectField, RangeField, Choice } from './fields';
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
  origin, zones, tables, tiers, roomForTables, onAdd, onClose, onTierCreated, world = worldOf(null),
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
  const [distance, setDistance] = useState(70);
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

  // A wedge's first row sits `distance` map units in front of the stage.
  const wedgeOrigin = useMemo(() => {
    if (!stage) return origin;
    const b = zoneBox(stage, world);
    return { x: (b.cx / world.width) * 100, y: ((b.cy + b.h / 2 + distance) / world.height) * 100 };
  }, [stage, distance, origin, world]);

  const built = useMemo(() => buildRing({
    name, rows, seatsPerRow, addPerRow, rowStart, layout: stage ? layout : 'straight', angle,
    origin: wedge ? wedgeOrigin : origin,
    focus: stage ? { x: stage.x, y: stage.y } : null,
    existing, tierId: tierId || null, world,
    copies: wedge ? copies : 1, spread,
  }), [name, rows, seatsPerRow, addPerRow, rowStart, layout, angle, origin, wedgeOrigin, stage, existing, tierId, world, wedge, copies, spread]);

  const seatTotal = built.tables.reduce((n, t) => n + t.seatCount, 0);
  const fits = built.tables.length <= roomForTables && built.outside === 0;

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
            <div className="fx-grid" style={{ '--fx-col': '140px', '--fx-gap': '12px' }}>
              <TextField label="Section name" value={name} onChange={setName} maxLength={24} required />
              <SelectField
                label="Ticket type" value={tierId}
                onChange={(v) => { if (v === NEW_TIER) setCreatingTier(true); else setTierId(v); }}
                options={[['', 'Choose later'], ...tiers.map((t) => [t.id, t.name]), [NEW_TIER, '+ New ticket type…']]}
              />
              <NumberField label="Rows" value={rows} min={1} max={MAX_SECTION_ROWS} onChange={setRows} />
              <NumberField label="Seats per row" value={seatsPerRow} min={1} max={60} onChange={setSeatsPerRow} />
              <NumberField label="Extra seats each row" value={addPerRow} min={0} max={6} onChange={setAddPerRow} hint="Widens the section toward the back." />
              <TextField label="First row" value={rowStart} onChange={(v) => setRowStart(v.slice(0, 3))} maxLength={3} hint="A, B, C… or 1, 2, 3…" />
            </div>
            {creatingTier && (
              <NewTierInline
                onCreated={(tier) => { onTierCreated?.(tier); setTierId(tier.id); setCreatingTier(false); }}
                onCancel={() => setCreatingTier(false)}
              />
            )}

            <Choice
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

function nextSectionName(tables) {
  const used = new Set(tables.map((t) => String(t.label).split(' ')[0].toUpperCase()));
  for (const letter of 'ABCDEFGHJKLMNPQRSTUVWXYZ') {
    for (let n = 1; n <= 9; n += 1) if (!used.has(`${letter}${n}`)) return `${letter}${n}`;
  }
  return 'New';
}

