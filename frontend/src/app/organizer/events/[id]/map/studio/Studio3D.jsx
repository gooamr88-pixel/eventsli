'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import VenueScene3D from '../../../../../components/venue/VenueScene3D';
import { buildSceneModel, eyeFor, stageEye } from '../../../../../components/venue/sceneModel';
import { MOODS, sectionIndex, seatName, tierPalette } from '../../../../../components/venue/venueModel';
import { keyOf } from '../useMapDraft';
import { RangeField, Toggle, Choice } from './fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The room in 3D, built from the 2D layout as it is drawn — unsaved edits
 * included — with the few settings a flat map cannot hold: how steeply the
 * rows rise, how high the stage is, the lighting, the screens.
 *
 * Nothing here is placed in three dimensions by hand, and that is the point.
 * Every row's height follows from its distance to the stage and one rake
 * angle, so moving a section in the 2D editor re-tiers the stands by itself,
 * and the 3D view can never drift from the map buyers actually choose on.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Studio3D({ tables, zones, world, scene, onScene, sections, tiers, eventTitle }) {
  const [eyeSeat, setEyeSeat] = useState(null);
  const [preset, setPreset] = useState('overview');
  const controls = useRef(null);

  const plain = useMemo(() => tables.map((t) => ({
    id: keyOf(t), label: t.label, shape: t.shape, seatCount: t.seatCount, position: t.position, tierId: t.tierId,
  })), [tables]);
  const model = useMemo(() => buildSceneModel({ tables: plain, zones, scene, world }), [plain, zones, scene, world]);
  const index = useMemo(() => sectionIndex(sections), [sections]);

  const tierOf = useMemo(() => new Map(plain.map((t) => [t.id, t.tierId])), [plain]);
  const palette = useMemo(() => tierPalette(tiers, []), [tiers]);
  // The function is its own colour key: it changes exactly when the colours do.
  const colorFor = useCallback((entry) => palette.get(tierOf.get(entry.tableId)) || '#8fa3a8', [palette, tierOf]);
  const colorKey = colorFor;

  const labels = useMemo(() => {
    const acc = new Map();
    const bySection = new Map(sections.flatMap((s) => s.rows.map((r) => [r.table, s.name])));
    for (const s of model.seats) {
      const name = bySection.get(s.tableLabel);
      if (!name) continue;
      const a = acc.get(name) || { x: 0, z: 0, y: 0, n: 0 };
      a.x += s.x; a.z += s.z; a.y = Math.max(a.y, s.y); a.n += 1;
      acc.set(name, a);
    }
    return [...acc].map(([text, a]) => ({ text, x: a.x / a.n, y: a.y + 1.6, z: a.z / a.n }));
  }, [model, sections]);
  const buildKey = useMemo(() => ({}), [model, labels, eventTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  const seat = eyeSeat ? model.seats.find((s) => s.id === eyeSeat) : null;
  const eye = preset === 'stage' ? stageEye(model, scene) : seat ? eyeFor(seat, model, scene) : null;
  const mode = eye ? 'eye' : 'orbit';

  const counts = useMemo(() => {
    const m = new Map();
    for (const t of tables) m.set(t.tierId || '', (m.get(t.tierId || '') || 0) + (Number(t.seatCount) || 0));
    return m;
  }, [tables]);

  return (
    <div className="es-studio-split es-studio-split--wide">
      <div className="es-dcard es-studio-stagecard">
        <div className="relative es-studio-viewport">
          {tables.length === 0 && zones.length === 0 ? (
            <div className="es-studio-empty">
              <p className="font-medium text-ink">Nothing to build yet</p>
              <p className="text-sm text-muted">Draw the room in Layout and it appears here in 3D.</p>
            </div>
          ) : (
            <VenueScene3D
              className="h-full w-full"
              model={model}
              scene={scene}
              labels={labels}
              title={eventTitle}
              buildKey={buildKey}
              colorKey={colorKey}
              colorFor={colorFor}
              mode={mode}
              eye={eye}
              controlsRef={controls}
              ariaLabel="Your venue in 3D"
              onPick={(entry) => { setEyeSeat(entry.id); setPreset('seat'); }}
            />
          )}
          <div className="es-venuex__tools">
            <button type="button" className="es-iconbtn" onClick={() => controls.current?.zoom(1.25)} aria-label="Zoom in">+</button>
            <button type="button" className="es-iconbtn" onClick={() => controls.current?.zoom(0.8)} aria-label="Zoom out">−</button>
          </div>
          {mode === 'eye' && (
            <div className="es-studio-eyebar">
              <span className="fx-min0 fx-truncate">
                {preset === 'stage' ? 'From the stage' : seat ? `From ${seatName({ number: seat.number }, seat.tableLabel, index)}` : ''}
              </span>
              <button type="button" className="es-btn es-btn--sm es-btn--secondary" onClick={() => { setEyeSeat(null); setPreset('overview'); }}>
                Back to overview
              </button>
            </div>
          )}
        </div>
        <div className="fx-row fx-row--between gap-2">
          <div className="fx-row gap-2" role="group" aria-label="Camera">
            <button type="button" className={`es-chip ${preset === 'overview' ? 'es-chip--on' : ''}`} onClick={() => { setEyeSeat(null); setPreset('overview'); controls.current?.reset(); }}>Overview</button>
            <button type="button" className={`es-chip ${preset === 'stage' ? 'es-chip--on' : ''}`} disabled={!model.hasStage} onClick={() => setPreset('stage')}>From the stage</button>
          </div>
          <p className="text-xs text-subtle">Tap any seat to sit in it. Drag to turn, scroll to zoom.</p>
        </div>
      </div>

      <aside className="es-dcard fx-stack" aria-labelledby="scene-settings">
        <div>
          <h2 id="scene-settings" className="es-dcard__title">3D settings</h2>
          <p className="es-ovcard__desc">The room is built from your 2D layout. These set how it looks.</p>
        </div>
        <Choice label="Lighting" value={scene.mood} onChange={(mood) => onScene({ mood })} options={MOODS} />
        <RangeField
          label="Rake" value={scene.rake} min={0} max={35} onChange={(rake) => onScene({ rake })}
          format={(v) => `${v}°`} hint="How steeply rows rise away from the stage. 0 is a flat floor; arenas are 20–30°."
        />
        <RangeField
          label="Stage height" value={scene.stageHeight} min={0} max={3} step={0.1}
          onChange={(stageHeight) => onScene({ stageHeight })} format={(v) => `${Number(v).toFixed(1)} m`}
        />
        <Toggle label="Video screens" hint="Above and beside the stage." checked={scene.screens} onChange={(screens) => onScene({ screens })} />
        <Toggle label="Enclosed venue" hint="Walls and a lit rim around the room." checked={scene.roof} onChange={(roof) => onScene({ roof })} />

        <div className="fx-stack gap-2 border-t border-border-base pt-3">
          <h3 className="text-sm font-medium text-ink">Seats by ticket type</h3>
          <ul className="fx-stack gap-1.5">
            {tiers.filter((t) => counts.get(t.id)).map((t) => (
              <li key={t.id} className="fx-row fx-row--between text-sm">
                <span className="fx-row gap-2"><span className="es-swatch" style={{ background: palette.get(t.id) }} aria-hidden="true" />{t.name}</span>
                <span className="es-nums text-muted">{counts.get(t.id).toLocaleString('en')}</span>
              </li>
            ))}
            {counts.get('') > 0 && (
              <li className="fx-row fx-row--between text-sm">
                <span className="fx-row gap-2"><span className="es-swatch" style={{ background: '#8fa3a8' }} aria-hidden="true" />No ticket type yet</span>
                <span className="es-nums text-muted">{counts.get('').toLocaleString('en')}</span>
              </li>
            )}
          </ul>
        </div>
      </aside>
    </div>
  );
}
