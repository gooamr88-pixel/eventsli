'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SeatMapCanvas from '../seating/SeatMapCanvas';
import { worldOf } from '../seating/seatingGeometry';
import VenueScene3D from './VenueScene3D';
import PanoramaViewer from './PanoramaViewer';
import PhotoSeatPanel from './PhotoSeatPanel';
import { projectSeats } from './photoSpots';
import ViewSwitch from './ViewSwitch';
import MiniLocator from './MiniLocator';
import SeatCard, { ViewStrip, priceText } from './SeatCard';
import VenueInfoCard from './VenueInfoCard';
import { sectionPlates } from './sectionPlates';
import {
  readStudio, liveSections, sectionIndex, seatName, tierPalette, tableTint,
} from './venueModel';
import { buildSceneModel, eyeFor, stageEye, bestSeat } from './sceneModel';
import { readLook, withTableStyles, tablePaint, CHAIR } from '../seating/mapStyle';
import { LockBadge } from '../seating/SeatMapCanvas';
import { isTablePlaces } from '../../lib/purchaseModes';
import ShowtimeBar from './stage/ShowtimeBar';
import { soundFor } from './stage/screenModel';

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
  tables: propTables = [], seats = [], zones = [], layout = null, tiers = [], currency = null,
  purchaseMode = 'seat_only', eventTitle = '',
  selectedSeatIds = NO_SET, selectedTableIds = NO_SET, highlightTierId = null,
  // The buyer's category filter (several at once) and "show unavailable seats".
  highlightTierIds = null, hideTaken = false,
  onSelectSeat, onSelectTable,
  // A vendor booth tapped on the 2D map (2026-11-23, SeatMapCanvas).
  onSelectBooth = null,
  frameClassName = '', boxClassName = '',
  // The seat page shows the venue card in its own side column.
  showVenueInfo = true,
  // The organizer's availability view: colours every seat and allows any to
  // be pressed. `seatAction` replaces the buyer's Select button.
  paint = null, pickAny = false, seatAction = null,
  // { key, tierIds }: take the buyer to these ticket types' seats (2026-11-17).
  frameRequest = null,
  // The event's table categories ({ id, name, color }): a table in one is
  // painted its colour in every view (mapStyle.js, THE MAP'S COLOUR RULES).
  categories = [],
  // A private table not yet unlocked was pressed: the page asks for its
  // password (2026-11-24). Absent: private tables are scenery.
  onLockedTable = null,
  // What the stage screen shows (the map API's `screenFeed`): the event's
  // cover, lineup, sponsors and times. Null: the screen shows the title.
  screenFeed = null,
}) {
  const [view, setView] = useState('2d');
  /**
   * A NEW "take me to these seats" request switches to the 2D map, where the
   * seats are chosen, and the canvas glides to them. Adjusted during render
   * (React's way to respond to a prop), so the 3D view is never painted first.
   */
  const [seenFrame, setSeenFrame] = useState(frameRequest?.key ?? null);
  if (frameRequest && frameRequest.key !== seenFrame) {
    setSeenFrame(frameRequest.key);
    if (view !== '2d') setView('2d');
  }
  const [focusId, setFocusId] = useState(null);
  // The seat whose card is open over the 3D or 360° view. Separate from
  // `focusId` because in 360° a tap must not move the camera: the card's
  // "View from here" does that.
  const [pickId, setPickId] = useState(null);
  // In 360°, choosing a seat takes you into it — but only once the choice
  // has landed: the page may refuse it (the per-order limit) or ask first
  // (the ticket details popup), so the jump waits for `selectedSeatIds`.
  const [goTo, setGoTo] = useState(null);
  const [shot, setShot] = useState('auto');
  const [hover, setHover] = useState(null);
  // The organizer's track would not play here; Showtime plays Eventsli music.
  const [trackFailed, setTrackFailed] = useState(false);
  // After every useState above: this calls their setters, and a `const`
  // setter used before its line is a crash, not a no-op.
  if (goTo && selectedSeatIds.has(goTo.seatId)) {
    setGoTo(null);
    setFocusId(goTo.entryId);
    setShot('seat');
    setPickId(null);
  }
  const frameRef = useRef(null);
  const controls = useRef(null);

  // ...and brings the map on screen: on a phone the categories sit above it,
  // and the glide is no use if the map is scrolled away. `nearest` leaves a map
  // that is already in view where it is.
  useEffect(() => {
    if (!frameRequest || !frameRef.current?.scrollIntoView) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    frameRef.current.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [frameRequest?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const studio = useMemo(() => readStudio(layout), [layout]);
  // The organizer's styling (mapStyle.js): each table's colours and seats per
  // side, and the map's look. A table that already carries a style (the
  // editor's preview) keeps its own.
  const look = useMemo(() => readLook(layout), [layout]);
  const styledTables = useMemo(() => withTableStyles(propTables, layout), [propTables, layout]);
  const tables = styledTables;
  // The map's own size: percentages resolve against it in every view.
  const world = worldOf(layout);
  const sections = useMemo(() => liveSections(studio.sections, tables), [studio.sections, tables]);
  const index = useMemo(() => sectionIndex(sections), [sections]);
  const tableById = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const tierById = useMemo(() => new Map(tiers.map((t) => [t.id, t])), [tiers]);
  const palette = useMemo(() => tierPalette(tiers, seats, look), [tiers, seats, look]);
  // Colour by ticket type only when there is more than one on this map; a
  // single-type room keeps the map's own seat colour.
  const usePalette = useMemo(() => new Set(seats.map((s) => s.tierId).filter(Boolean)).size > 1, [seats]);
  // Each table's assigned colour — its category's, else its ticket type's —
  // the one rule the editor uses too (venueModel.tableTint).
  const tint = useMemo(
    () => tableTint({ tiers, seats, tables, categories, look }),
    [tiers, seats, tables, categories, look],
  );
  // Tables drawn as rows (no body) and what each table is painted, for 3D.
  const tablePaints = useMemo(
    () => new Map(tables.map((t) => [t.id, tablePaint(t, look, { fill: tint(t) })])),
    [tables, look, tint],
  );

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
  // A screen to play a show on: the stage's (when screens are on) or one
  // the organizer placed on the map.
  const hasScreen = (studio.scene.screens && zones.some((z) => z.kind === 'stage')) || zones.some((z) => z.kind === 'screen');
  // "Use the 2D map" when a 3D or 360° view cannot draw on this device.
  const toMap = () => { setView('2d'); setHover(null); setPickId(null); setGoTo(null); };
  const model = useMemo(
    () => (in3d ? buildSceneModel({
      tables, seatsByTable, zones, scene: studio.scene, world,
      // The table tops in 3D take the same colour as on the 2D map.
      bodyColor: (t) => tablePaints.get(t.id)?.fill || null,
    }) : null),
    [in3d, tables, seatsByTable, zones, studio.scene, world, tablePaints],
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

  // NO SECTION NAMES ON THE 2D MAP (owner, 2026-11-10). Written over the
  // seats they hid them, and a buyer read the gap as "no seats here"; under
  // them they still crowded the rows. The section is named where it is read:
  // the seat's tooltip, the basket ("Section Orchestra C · Row A · Seat 7"),
  // and the ticket categories beside the map.

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
  /**
   * A chair's colour in 3D and 360°, by THE MAP'S COLOUR RULES (mapStyle.js):
   * a chair at a table is black; a seat in a row takes its row's colour. The
   * selected seat is the accent here — 3D has no ring to draw — and a seat
   * nobody can choose is grey, as before.
   */
  const colorFor = useCallback((entry) => {
    const s = entry.seat;
    if (!s) return dark ? '#3d3c48' : '#bdbdc5';
    if (selectedSeatIds.has(s.id)) return '#ff414b';
    if (paint) return paint(s);
    if (!s.available) return hideTaken ? (dark ? '#1f1e28' : '#dcdce1') : (dark ? '#3d3c48' : '#bdbdc5');
    if (focusTiers && !focusTiers.has(s.tierId)) return dark ? '#34333f' : '#d4d4da';
    if (entry.atTable) return CHAIR;
    const p = tablePaints.get(entry.tableId);
    return p?.seat || p?.tint || (usePalette && palette.get(s.tierId)) || look?.seat || '#17a2a6';
  }, [selectedSeatIds, paint, focusTiers, hideTaken, usePalette, palette, dark, tablePaints, look]);
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
  const picked = model && pickId ? model.seats.find((s) => s.id === pickId) : null;
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

  const placesMode = !pickAny && isTablePlaces(purchaseMode);
  const freeAt = (tableId) => seats.filter((x) => x.tableId === tableId && x.available).length;

  const actionFor = (entry) => {
    const s = entry?.seat;
    if (!s) return { label: 'Not on sale yet', disabled: true };
    const table = tableById.get(entry.tableId);
    if (seatAction) return seatAction(s, table);
    // Places at a table (2026-11-25): a chair stands for its table.
    if (placesMode && table) {
      if (selectedTableIds.has(table.id)) return { label: `Remove table ${table.label}`, tone: 'secondary', onPress: () => onSelectTable?.(table) };
      return freeAt(table.id) > 0
        ? { label: `Choose table ${table.label}`, onPress: () => onSelectTable?.(table) }
        : { label: 'This table is full', disabled: true };
    }
    if (purchaseMode === 'table_only') {
      return table?.canBookWhole
        ? { label: `Book table ${table.label}`, onPress: () => onSelectTable?.(table) }
        : { label: 'Sold by the table', disabled: true };
    }
    if (selectedSeatIds.has(s.id)) return { label: 'Remove seat', tone: 'secondary', onPress: () => onSelectSeat?.(s, table) };
    if (!s.available) return { label: 'Taken', disabled: true };
    return {
      label: 'Select seat',
      onPress: () => {
        if (view === '360') setGoTo({ seatId: s.id, entryId: entry.id });
        onSelectSeat?.(s, table);
      },
    };
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

  // Seats placed on the photo — only on a photo the organizer has lined up
  // (it has a `spot`). Where they fall depends on the room and the photo;
  // how they look depends on the selection, so that part is per render.
  const placed = useMemo(
    () => (view === '360' && shotPhoto?.spot && model ? projectSeats(model, shotPhoto) : []),
    [view, shotPhoto, model],
  );
  const choose = (entry) => {
    setFocusId(entry.id);
    if (shotPhoto) setShot(shotPhoto.id);
    actionFor(entry).onPress?.();
  };
  const photoSpots = placed.length ? placed.map((p) => {
    const s = p.entry.seat;
    const chosen = Boolean(s && selectedSeatIds.has(s.id));
    const action = actionFor(p.entry);
    const info = describe(p.entry);
    const taken = !chosen && (!s || !s.available);
    return {
      id: p.entry.id, yaw: p.yaw, pitch: p.pitch, distance: p.distance,
      state: chosen ? 'chosen' : taken ? 'taken' : 'open',
      color: !chosen && !taken ? info.color : null,
      dim: !chosen && !taken && focusTiers && !focusTiers.has(s.tierId),
      active: p.entry.id === active?.id,
      disabled: Boolean(action.disabled || !action.onPress),
      label: `${info.name}${info.price ? `, ${info.price}` : ''}${taken ? ', unavailable' : ''}`,
    };
  }) : null;
  const entryById = (id) => placed.find((p) => p.entry.id === id)?.entry;

  return (
    <div ref={frameRef} className={`es-venuex ${frameClassName}`}>
      <div className="fx-row fx-row--between gap-2">
        <ViewSwitch value={view} onChange={(v) => { setView(v); setHover(null); setPickId(null); setGoTo(null); }} />
        {/* From `sm`: on a phone the pinned bar below already says "Tap a
            seat to choose it", and this row is worth its height in map. */}
        <p className="hidden text-xs text-subtle sm:block">
          {view === '2d' && (pickAny ? 'Tap a seat to block or release it' : 'Tap a seat to choose it')}
          {view === '3d' && `Drag to turn · scroll to zoom · tap a seat${hasScreen ? ' · tap the screen' : ''}`}
          {view === '360' && (shotPhoto ? photoSpots ? 'Tap a seat in the photo to choose it · drag to look around' : 'A photo from this part of the venue · choose from the seats it shows' : 'Drag to look around · tap a seat to choose it')}
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
          pickAny={pickAny}
          frameRequest={frameRequest}
          look={look}
          onSelectBooth={onSelectBooth}
          tableTint={tint}
          onLockedTable={onLockedTable}
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
            onPick={(entry) => {
              setHover(null);
              const table = tableById.get(entry.tableId);
              // A PRIVATE TABLE in 3D asks for its password too (2026-11-24),
              // as on the 2D map; the page then chooses the tapped seat.
              if (onLockedTable && table?.locked) {
                setPickId(null);
                onLockedTable(table, entry.seat || null);
                return;
              }
              setPickId(entry.id);
              if (view === '3d') { setFocusId(entry.id); setShot('auto'); }
              // ONE TAP CHOOSES (owner, 2026-11-24: "no select then select").
              // An open seat is added as it is tapped, exactly as on the 2D
              // map; the card stays open to say so, with Remove and "View from
              // seat". Tapping a chosen seat only opens its card, so a stray
              // tap while turning the room never drops one. The organizer's
              // availability view (`seatAction`) keeps its explicit button.
              const s = entry.seat;
              // Places at a table: a tap on any chair chooses its table (once).
              if (!seatAction && placesMode) {
                if (table && freeAt(table.id) > 0 && !selectedTableIds.has(table.id)) onSelectTable?.(table);
                return;
              }
              if (seatAction || !s || !s.available || selectedSeatIds.has(s.id)) return;
              if (purchaseMode === 'table_only') {
                if (table?.canBookWhole) onSelectTable?.(table);
                return;
              }
              onSelectSeat?.(s, table);
            }}
            onHover={(entry, at) => setHover(entry ? { entry, ...at } : null)}
            onFallback={toMap}
            screen={studio.scene.screen}
            screenFeed={screenFeed}
            onTrackFailed={() => setTrackFailed(true)}
          />

          {/* Mounted whenever the room is: over a 360° photo too, so the button
              always says whether the show is on. */}
          {hasScreen && (
            <ShowtimeBar
              controls={controls}
              hasSound={soundFor(studio.scene.screen, studio.scene.mood).kind !== 'off'}
              trackFailed={trackFailed}
              volume={studio.scene.screen.sound.volume}
            />
          )}

          {view === '360' && shotPhoto && (
            // A wrapper places it: the viewer's own root is `relative`, which
            // would beat an `absolute` passed in and drop it below the box.
            <div className="es-venuex__photo">
              <PanoramaViewer
                key={shotPhoto.id} className="h-full w-full" url={shotPhoto.url} heading={shotPhoto.heading}
                label={shotPhoto.name} onFallback={toMap}
                spots={photoSpots}
                onSpot={(id) => { const entry = entryById(id); if (entry) choose(entry); }}
              />
            </div>
          )}

          {view === '360' && shotPhoto && (
            <PhotoSeatPanel
              key={shotPhoto.id}
              view={shotPhoto}
              // With the seats on the photo itself the list starts folded, so
              // the photo is what a buyer sees first.
              startOpen={!photoSpots}
              model={model}
              index={index}
              selectedSeatIds={selectedSeatIds}
              focusTiers={focusTiers}
              activeId={active?.id}
              actionFor={actionFor}
              describe={describe}
              // Keep this photo up: on 'auto' a seat whose row is also in
              // another photo would swap the picture out from under the tap.
              onFocus={(entry) => { setFocusId(entry.id); setShot(shotPhoto.id); }}
            />
          )}

          <div className="es-venuex__tools">
            <button type="button" className="es-iconbtn" onClick={() => controls.current?.zoom(1.25)} aria-label="Zoom in">+</button>
            <button type="button" className="es-iconbtn" onClick={() => controls.current?.zoom(0.8)} aria-label="Zoom out">−</button>
            {view === '3d' && (
              <button type="button" className="es-iconbtn" onClick={() => controls.current?.reset()} aria-label="Reset the view">⟲</button>
            )}
            <button type="button" className="es-iconbtn" onClick={toggleFullscreen} aria-label="Full screen">⤢</button>
          </div>

          {hover && !picked && (
            <div className="es-venuex__tip" style={{ left: hover.x + 14, top: hover.y + 14 }} aria-hidden="true">
              <strong>{describe(hover.entry).name}</strong>
              <span>{hover.entry.seat?.available === false ? 'Taken' : describe(hover.entry).price}</span>
            </div>
          )}

          {picked && (
            <div className="es-venuex__card">
              <SeatCard
                compact
                {...describe(picked)}
                status={picked.seat && !picked.seat.available && !selectedSeatIds.has(picked.seat.id) ? 'Taken' : null}
                action={actionFor(picked)}
                secondary={view === '360' && picked.id === active?.id ? null : {
                  label: view === '360' ? 'View from here' : 'View from seat',
                  onPress: () => { setFocusId(picked.id); setView('360'); setPickId(null); setShot('auto'); },
                }}
                onClose={() => setPickId(null)}
              />
            </div>
          )}

          {view === '360' && active && !picked && (
            <>
              {!shotPhoto && (
                <>
                  <button type="button" className="es-venuex__nav es-venuex__nav--prev es-iconbtn" onClick={() => step(-1)} aria-label="Previous seat">‹</button>
                  <button type="button" className="es-venuex__nav es-venuex__nav--next es-iconbtn" onClick={() => step(1)} aria-label="Next seat">›</button>
                </>
              )}
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

      {!paint && (
        <MapLegend
          accessible={zones.some((z) => z.kind === 'accessible')}
          locked={tables.some((t) => t.locked)}
          categories={categories.filter((c) => c.color && tables.some((t) => t.categoryId === c.id))}
        />
      )}

      {showVenueInfo && <VenueInfoCard venue={studio.venue} tables={tables} zones={zones} />}
    </div>
  );
}

/**
 * What the colours mean, in the frame, under every view. Chairs are black
 * (THE MAP'S COLOUR RULES), so the key says what a chair's ring and fade
 * mean; the table colours are the ticket categories beside the map and, when
 * the organizer uses them, the table categories listed here.
 */
function MapLegend({ accessible, locked = false, categories = [] }) {
  return (
    <ul className="es-maplegend" aria-label="Map key">
      <li><span className="es-maplegend__dot es-maplegend__dot--selected" aria-hidden="true" />Selected</li>
      <li><span className="es-maplegend__dot es-maplegend__dot--open" aria-hidden="true" />Available</li>
      <li><span className="es-maplegend__dot es-maplegend__dot--taken" aria-hidden="true" />Unavailable</li>
      {locked && (
        <li>
          <svg className="es-maplegend__lock" viewBox="-10 -10 20 20" aria-hidden="true"><LockBadge /></svg>
          Private — needs a password
        </li>
      )}
      {accessible && <li><span className="es-maplegend__dot es-maplegend__dot--access" aria-hidden="true" />Accessible seating</li>}
      {categories.map((c) => (
        <li key={c.id}><span className="es-maplegend__swatch" style={{ background: c.color }} aria-hidden="true" />{c.name}</li>
      ))}
    </ul>
  );
}
