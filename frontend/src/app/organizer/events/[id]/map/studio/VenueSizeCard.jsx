'use client';

import { useState } from 'react';
import {
  MAX_WORLD, makeWorld, worldFromMetres, worldMetres, worldOf,
} from '../../../../../components/seating/seatingGeometry';
import { NumberField } from './fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * How big the venue is: the map's world (`layout.world`), in metres.
 *
 * Seats keep their real size (0.55 m a seat), so this is the size of the ROOM:
 * the default holds a ballroom, the largest a stadium bowl. Resizing keeps
 * everything already drawn where it is relative to everything else, centred in
 * the new floor (`seatingGeometry.moveToWorld`), and it is one undo step in the
 * Layout editor like any other edit.
 *
 * APPLIED ON A BUTTON, not per keystroke. Typing "120" goes through "1" and
 * "12", and each of those would be a resize that moves the room.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const DEFAULT = worldOf(null);

/** Whole default rooms, so every preset keeps the default's 10:7 shape. */
export const VENUE_SIZES = Object.freeze([
  { key: 'room', label: 'Ballroom', world: DEFAULT, hint: 'Galas, theatres and halls up to about 400 seats' },
  { key: 'hall', label: 'Hall', world: makeWorld(DEFAULT.width * 2, DEFAULT.height * 2), hint: 'Concert halls, up to about 2,000 seats' },
  { key: 'arena', label: 'Arena', world: makeWorld(DEFAULT.width * 4, DEFAULT.height * 4), hint: 'Arenas, up to about 8,000 seats' },
  { key: 'stadium', label: 'Stadium', world: makeWorld(DEFAULT.width * 8, DEFAULT.height * 8), hint: 'Stadium bowls, up to the map’s limit of 400 rows' },
]);

export default function VenueSizeCard({ world, onResize }) {
  const now = worldMetres(world);
  const max = worldMetres(MAX_WORLD);
  const min = worldMetres(DEFAULT);
  const [width, setWidth] = useState(now.width);
  const [depth, setDepth] = useState(now.depth);
  const [error, setError] = useState(null);

  // A resize made elsewhere (undo, a reload) resets the fields, during render
  // rather than in an effect so the old numbers are never painted.
  const [seen, setSeen] = useState(world);
  if (seen !== world) {
    setSeen(world);
    setWidth(now.width);
    setDepth(now.depth);
    setError(null);
  }

  const target = worldFromMetres(width || min.width, depth || min.depth);
  const preset = VENUE_SIZES.find((p) => p.world === world)?.key || null;

  function apply(next) {
    if (next === world) return;
    if (!onResize(next)) {
      setError('Everything already on the map has to fit inside the venue. Move or remove some of it, or choose a larger size.');
    } else {
      setError(null);
    }
  }

  return (
    <section className="es-dcard fx-stack" aria-labelledby="venue-size">
      <div>
        <h2 id="venue-size" className="es-dcard__title">Venue size</h2>
        <p className="es-ovcard__desc">
          The floor your map is drawn on, now <b className="es-nums text-ink">{now.width} × {now.depth} m</b>. Seats stay life-size,
          so a bigger venue holds more of them. What is already drawn keeps its spacing.
        </p>
      </div>

      <div className="fx-row gap-2" role="group" aria-label="Venue size presets">
        {VENUE_SIZES.map((p) => {
          const m = worldMetres(p.world);
          return (
            <button
              key={p.key} type="button" title={p.hint} aria-pressed={preset === p.key}
              className={`es-chip ${preset === p.key ? 'es-chip--on' : ''}`}
              onClick={() => apply(p.world)}
            >
              {p.label} <span className="es-nums text-subtle">{m.width} × {m.depth} m</span>
            </button>
          );
        })}
      </div>

      <form
        className="fx-stack gap-2"
        onSubmit={(e) => { e.preventDefault(); apply(target); }}
      >
        <div className="fx-grid" style={{ '--fx-col': '140px', '--fx-gap': '12px' }}>
          <NumberField label="Width" value={width} min={min.width} max={max.width} step={0.1} suffix="m" onChange={setWidth} />
          <NumberField label="Depth" value={depth} min={min.depth} max={max.depth} step={0.1} suffix="m" onChange={setDepth} />
        </div>
        <div className="fx-row gap-2">
          <button type="submit" className="es-btn es-btn--secondary es-btn--sm" disabled={target === world}>
            Apply size
          </button>
          <span className="text-xs text-subtle">
            From {min.width} × {min.depth} m up to {max.width} × {max.depth} m.
          </span>
        </div>
      </form>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}
