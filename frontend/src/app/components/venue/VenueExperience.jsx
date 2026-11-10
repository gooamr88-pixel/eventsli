'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import SeatMapCanvas from '../seating/SeatMapCanvas';
import { toWorld, worldOf } from '../seating/seatingGeometry';
import VenueScene3D from './VenueScene3D';
import PanoramaViewer from './PanoramaViewer';
import ViewSwitch from './ViewSwitch';
import MiniLocator from './MiniLocator';
import SeatCard, { ViewStrip, priceText } from './SeatCard';
import VenueInfoCard from './VenueInfoCard';
import { sectionPlates } from './sectionPlates';
import {
  readStudio, liveSections, sectionIndex, seatName, tierPalette,
} from './venueModel';
import { buildSceneModel, eyeFor, stageEye, bestSeat } from './sceneModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One room, three ways to see it: the 2D seat map, the venue in 3D, and the
 * 360° view from any seat. The buyer's seat picker and the organizer's live
 * preview both render this, so what an organizer previews is what a buyer gets.
 *
 * SELECTION IS NOT OWNED HERE. The caller's `selectedSeatIds` and
 * `onSelectSeat` are the same ones the 2D map has always used, so a seat picked
 * in 3D is in the same basket, under the same per-order limit, as one tapped on
 * the map — and the hold, the price and the checkout do not know which view it
 * came from.
 *
 * 3D AND 360° ARE ONE RENDERER. Switching from 3D to 360° flies the camera from
 * above the room down into the seat, which says "this is the view from THAT
 * seat" better than any caption. Uploaded photos lie over it when a seat has
 * one; every other seat gets the generated view.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const NO_SET = new Set();

export default function VenueExperience({
  tables = [], seats = [], zones = [], layout = null, tiers = [], currency = null,
  purchaseMode = 'seat_only', eventTitle = '',
  selectedSeatIds = NO_SET, selectedTableIds = NO_SET, highlightTierId = null,
  // The buyer's category filter (several at once) and "show unavailable seats".
  highlightTierIds = null, hideTaken = false,
  onSelectSeat, onSelectTable,
  frameClassName = '', boxClassName = '',
  // The seat page shows the venue card in its own side column.
  showVenueInfo = true,
  // The organizer's availability view: colours every seat and allows any to
  // be pressed. `seatAction` replaces the buyer's Select button.
  paint = null, pickAny = false, seatAction = null,
}) {
  const [view, setView] = useState('2d');
  const [focusId, setFocusId] = useState(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [shot, setShot] = useState('auto');
  const [hover, setHover] = useState(null);
  const frameRef = useRef(null);
  const controls = useRef(null);

  const studio = useMemo(() => readStudio(layout), [layout]);
  // The map's own size: percentages resolve against it in every view.
  const world = worldOf(layout);
  const sections = useMemo(() => liveSections(studio.sections, tables), [studio.sections, tables]);
  const index = useMemo(() => sectionIndex(sections), [sections]);
  const tableById = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const tierById = useMemo(() => new Map(tiers.map((t) => [t.id, t])), [tiers]);
  const palette = useMemo(() => tierPalette(tiers, seats), [tiers, seats]);
  // Colour by ticket type only when there is more than one on this map; a
  // single-type room keeps the map's own seat colour.
  const usePalette = useMemo(() => new Set(seats.map((s) => s.tierId).filter(Boolean)).size > 1, [seats]);

  const seatsByTable = useMemo(() => {
    const map = new Map();
    for (const s of seats) {
      if (!s.tableId) continue;
      if (!map.has(s.tableId)) map.set(s.tableId, []);
      map.get(s.tableId).push(s);
    }
    for (const list of map.values()) list.sort((a, b) => Number(a.number) - Number(b.number));
    return map;
  }, [seats]);

  const in3d = view !== '2d';
  // "Use the 2D map" when a 3D or 360° view cannot draw on this device.
  const toMap = () => { setView('2d'); setHover(null); setCardOpen(false); };
  const model = useMemo(
    () => (in3d ? buildSceneModel({ tables, seatsByTable, zones, scene: studio.scene, world }) : null),
    [in3d, tables, seatsByTable, zones, studio.scene, world],
  );

  const labels3d = useMemo(() => {
    if (!model) return [];
    const bySection = new Map(sections.flatMap((s) => s.rows.map((r) => [r.table, s.name])));
    const acc = new Map();
    for (const s of model.seats) {
      const name = bySection.get(s.tableLabel);
      if (!name) continue;
      const a = acc.get(name) || { x: 0, z: 0, y: 0, n: 0 };
      a.x += s.x; a.z += s.z; a.y = Math.max(a.y, s.y); a.n += 1;
      acc.set(name, a);
    }
    return [...acc].map(([text, a]) => ({ text, x: a.x / a.n, z: a.z / a.n, y: a.y + 1.6 }));
  }, [model, sections]);

  const badges = useMemo(() => sections.map((s) => {
    const pts = s.rows.map((r) => tables.find((t) => t.label === r.table)).filter(Boolean).map((t) => toWorld(t.position, world));
    return {
      key: s.id,
      text: s.name,
      x: pts.reduce((n, p) => n + p.x, 0) / pts.length,
      y: pts.reduce((n, p) => n + p.y, 0) / pts.length,
    };
  }), [sections, tables, world]);

  // One "is this seat picked out?" rule for every view.
  const focusTiers = useMemo(
    () => (highlightTierIds?.size ? highlightTierIds : highlightTierId ? new Set([highlightTierId]) : null),
    [highlightTierIds, highlightTierId],
  );

  const plates = useMemo(() => sectionPlates(sections, tables, (tableId) => {
    const tierId = seatsByTable.get(tableId)?.[0]?.tierId;
    return (usePalette && palette.get(tierId)) || '#17a2a6';
  }, world), [sections, tables, seatsByTable, usePalette, palette, world]);

  const dark = studio.scene.mood !== 'daylight';
  const colorFor = useCallback((entry) => {
    const s = entry.seat;
    if (!s) return dark ? '#3b4549' : '#b7c0c3';
    if (selectedSeatIds.has(s.id)) return '#ffffff';
    if (paint) return paint(s);
    if (!s.available) return hideTaken ? (dark ? '#1c2a2d' : '#d6dddf') : (dark ? '#3b4549' : '#b7c0c3');
    if (focusTiers && !focusTiers.has(s.tierId)) return dark ? '#2d4245' : '#cfd8da';
    return (usePalette && palette.get(s.tierId)) || '#17a2a6';
  }, [selectedSeatIds, paint, focusTiers, hideTaken, usePalette, palette, dark]);
  const colorKey = useMemo(() => ({}), [colorFor, seats]); // eslint-disable-line react-hooks/exhaustive-deps
  const buildKey = useMemo(() => ({}), [model, labels3d, eventTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  const seatFill = useMemo(() => {
    if (paint) return paint;
    if (!usePalette) return null;
    return (s) => (s.available ? palette.get(s.tierId) || null : null);
  }, [paint, usePalette, palette]);

  // ── which seat the 3D card and the 360° view are about ──
  const firstSelected = model?.seats.find((s) => s.seat && selectedSeatIds.has(s.seat.id));
  const focused = model && focusId ? model.seats.find((s) => s.id === focusId) : null;
  const active = focused || firstSelected
    || (model ? bestSeat(model, (s) => Boolean(s.seat?.available) || pickAny) : null);
  const photo = active ? studio.views.find((v) => v.tables.includes(active.tableLabel)) : null;
  const shotId = shot === 'auto' ? (photo ? photo.id : 'seat') : shot;
  const shotPhoto = studio.views.find((v) => v.id === shotId) || null;
  const eye = !model || !active ? null : shotId === 'stage' ? stageEye(model, studio.scene) : eyeFor(active, model, studio.scene);

  const describe = (entry) => {
    const s = entry?.seat;
    const tier = s?.tierId ? tierById.get(s.tierId) : null;
    return {
      name: seatName(s || { number: entry?.number }, entry?.tableLabel, index),
      tier: tier?.name || null,
      color: tier ? (palette.get(tier.id) || '#17a2a6') : null,
      price: priceText(s, currency),
    };
  };

  const actionFor = (entry) => {
    const s = entry?.seat;
    if (!s) return { label: 'Not on sale yet', disabled: true };
    const table = tableById.get(entry.tableId);
    if (seatAction) return seatAction(s, table);
    if (purchaseMode === 'table_only') {
      return table?.canBookWhole
        ? { label: `Book table ${table.label}`, onPress: () => onSelectTable?.(table) }
        : { label: 'Sold by the table', disabled: true };
    }
    if (selectedSeatIds.has(s.id)) return { label: 'Remove seat', tone: 'secondary', onPress: () => onSelectSeat?.(s, table) };
    if (!s.available) return { label: 'Taken', disabled: true };
    return { label: 'Select seat', onPress: () => onSelectSeat?.(s, table) };
  };

  const step = (dir) => {
    if (!model || !active) return;
    const i = model.seats.indexOf(active);
    const next = model.seats[(i + dir + model.seats.length) % model.seats.length];
    setFocusId(next.id);
    setShot('auto');
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else frameRef.current?.requestFullscreen?.();
  };

  const shotItems = [
    { id: 'seat', name: 'Your seat' },
    ...(model?.hasStage ? [{ id: 'stage', name: 'From the stage' }] : []),
    ...studio.views.map((v) => ({ id: v.id, name: v.name, url: v.url })),
  ];

  const activeInfo = active ? describe(active) : null;

  return (
    <div ref={frameRef} className={`es-venuex ${frameClassName}`}>
      <div className="fx-row fx-row--between gap-2">
        <ViewSwitch value={view} onChange={(v) => { setView(v); setHover(null); if (v !== '3d') setCardOpen(false); }} />
        {/* From `sm`: on a phone the pinned bar below already says "Tap a
            seat to choose it", and this row is worth its height in map. */}
        <p className="hidden text-xs text-subtle sm:block">
          {view === '2d' && (pickAny ? 'Tap a seat to block or release it' : 'Tap a seat to choose it')}
          {view === '3d' && 'Drag to turn · scroll to zoom · tap a seat'}
          {view === '360' && (shotPhoto ? 'A photo from this part of the venue · drag to look around' : 'Drag to look around · arrows move along the row')}
        </p>
      </div>

      {view === '2d' ? (
        <SeatMapCanvas
          className={boxClassName}
          tables={tables}
          seats={seats}
          zones={zones}
          world={world}
          selectedSeatIds={selectedSeatIds}
          selectedTableIds={selectedTableIds}
          highlightTierIds={focusTiers}
          hideTaken={hideTaken}
          plates={plates}
          showcase
          purchaseMode={pickAny ? 'seat_only' : purchaseMode}
          currency={currency}
          onSelectSeat={onSelectSeat}
          onSelectTable={onSelectTable}
          seatFill={seatFill}
          badges={badges}
          pickAny={pickAny}
        />
      ) : (
        <div className={`relative ${boxClassName}`}>
          <VenueScene3D
            className="h-full w-full"
            model={model}
            scene={studio.scene}
            labels={labels3d}
            title={eventTitle}
            buildKey={buildKey}
            colorKey={colorKey}
            colorFor={colorFor}
            mode={view === '360' ? 'eye' : 'orbit'}
            eye={view === '360' ? eye : null}
            controlsRef={controls}
            ariaLabel={view === '360' ? `The view from ${activeInfo?.name || 'a seat'}` : 'The venue in 3D. Use the 2D map to choose seats by keyboard.'}
            onPick={(entry) => { setFocusId(entry.id); setCardOpen(true); setShot('auto'); }}
            onHover={(entry, at) => setHover(entry ? { entry, ...at } : null)}
            onFallback={toMap}
          />

          {view === '360' && shotPhoto && (
            // A wrapper places it: the viewer's own root is `relative`, which
            // would beat an `absolute` passed in and drop it below the box.
            <div className="es-venuex__photo">
              <PanoramaViewer key={shotPhoto.id} className="h-full w-full" url={shotPhoto.url} heading={shotPhoto.heading} label={shotPhoto.name} onFallback={toMap} />
            </div>
          )}

          <div className="es-venuex__tools">
            <button type="button" className="es-iconbtn" onClick={() => controls.current?.zoom(1.25)} aria-label="Zoom in">+</button>
            <button type="button" className="es-iconbtn" onClick={() => controls.current?.zoom(0.8)} aria-label="Zoom out">−</button>
            {view === '3d' && (
              <button type="button" className="es-iconbtn" onClick={() => controls.current?.reset()} aria-label="Reset the view">⟲</button>
            )}
            <button type="button" className="es-iconbtn" onClick={toggleFullscreen} aria-label="Full screen">⤢</button>
          </div>

          {view === '3d' && hover && !cardOpen && (
            <div className="es-venuex__tip" style={{ left: hover.x + 14, top: hover.y + 14 }} aria-hidden="true">
              <strong>{describe(hover.entry).name}</strong>
              <span>{hover.entry.seat?.available === false ? 'Taken' : describe(hover.entry).price}</span>
            </div>
          )}

          {view === '3d' && cardOpen && focused && (
            <div className="es-venuex__card">
              <SeatCard
                compact
                {...describe(focused)}
                status={focused.seat && !focused.seat.available && !selectedSeatIds.has(focused.seat.id) ? 'Taken' : null}
                action={actionFor(focused)}
                secondary={{ label: 'View from seat', onPress: () => { setView('360'); setCardOpen(false); setShot('auto'); } }}
                onClose={() => setCardOpen(false)}
              />
            </div>
          )}

          {view === '360' && active && (
            <>
              <button type="button" className="es-venuex__nav es-venuex__nav--prev es-iconbtn" onClick={() => step(-1)} aria-label="Previous seat">‹</button>
              <button type="button" className="es-venuex__nav es-venuex__nav--next es-iconbtn" onClick={() => step(1)} aria-label="Next seat">›</button>
              <div className="es-venuex__strip">
                <ViewStrip items={shotItems} active={shotId} onPick={setShot} />
              </div>
            </>
          )}
        </div>
      )}

      {view === '360' && active && (
        <div className="es-venuex__detail">
          <MiniLocator model={model} seatId={active.id} colorFor={colorFor} colorKey={colorKey} className="es-venuex__mini" />
          <SeatCard
            {...activeInfo}
            status={active.seat && !active.seat.available && !selectedSeatIds.has(active.seat.id) ? 'Taken' : null}
            action={actionFor(active)}
          >
            <p className="text-sm text-muted">
              {shotPhoto
                ? `Photo: ${shotPhoto.name}.`
                : shotId === 'stage'
                  ? 'What the stage sees: the whole room, facing you.'
                  : 'Drawn from this venue’s own layout: the angle, height and distance to the stage from this exact seat.'}
            </p>
          </SeatCard>
        </div>
      )}

      {!paint && <MapLegend accessible={zones.some((z) => z.kind === 'accessible')} />}

      {showVenueInfo && <VenueInfoCard venue={studio.venue} tables={tables} zones={zones} />}
    </div>
  );
}

/** What the colours mean, in the frame, under every view. */
function MapLegend({ accessible }) {
  return (
    <ul className="es-maplegend" aria-label="Map key">
      <li><span className="es-maplegend__dot es-maplegend__dot--selected" aria-hidden="true" />Selected</li>
      <li><span className="es-maplegend__dot es-maplegend__dot--open" aria-hidden="true" />Available</li>
      <li><span className="es-maplegend__dot es-maplegend__dot--taken" aria-hidden="true" />Unavailable</li>
      {accessible && <li><span className="es-maplegend__dot es-maplegend__dot--access" aria-hidden="true" />Accessible seating</li>}
    </ul>
  );
}
