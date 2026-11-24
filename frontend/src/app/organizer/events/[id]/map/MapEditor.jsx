'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { describeError } from '../../../../utils/errors';
import { usePanZoom } from '../../../../components/seating/usePanZoom';
import { Loading } from '../../../../components/Feedback';
import EditorCanvas, { editorBounds } from './EditorCanvas';
import EditorToolbar from './EditorToolbar';
import PhoneTools from './PhoneTools';
import AddElementDialog from './AddElementDialog';
import EditorSidePanel from './EditorSidePanel';
import { BuildPalette } from './BuildPanel';
import LayersSection from './LayersCard';
import { MapHeader, MapBanner, MapNotices, countUnpriced, isUnpriced } from './MapChrome';
import { useEventContext } from '../EventContext';
import SelectionJump from './SelectionJump';
import MapStarter from './MapStarter';
import { frameFor, sameBox, clamp, freeSpot } from './mapApi';
import { zoneMeta } from '../../../../components/seating/venueZones';
import { tableReach } from '../../../../components/seating/seatingGeometry';
import { liveSections } from '../../../../components/venue/venueModel';
import { writeLook } from '../../../../components/seating/mapStyle';
import StudioTabs from './studio/StudioTabs';
import SectionDialog from './studio/SectionDialog';
import StudioWorkspace from './studio/StudioWorkspace';
import StudioStatsBar from './studio/StudioStatsBar';
import Preview3DCard from './studio/Preview3DCard';
import { useStudioDraft } from './studio/useStudioDraft';
import SeatingPackModal from './print/SeatingPackModal';
import SeatingDesigner from './SeatingDesigner';
import { useAiQuota } from '../../../../hooks/useAiQuota';
import { useMapDraft, keyOf, MAX_TABLES } from './useMapDraft';
import { useMapPersistence } from './useMapPersistence';
import { useSelection, soleSelected } from './useSelection';
import { useCanvasInteraction } from './useCanvasInteraction';
import { useEditorKeys } from './useEditorKeys';
import { useUnsavedGuard } from './useUnsavedGuard';
import { useStepSave } from '../BuildStep';
import { useWallTool } from './style/useWallTool';
import MapTemplateDialog from './style/MapTemplateDialog';
import SaveMapTemplateDialog from './style/SaveMapTemplateDialog';
import ImageImportDialog from './style/ImageImportDialog';
import BoothRowDialog from './BoothRowDialog';
import { BOOTH_KIND, BOOTH_META } from '../../../../components/seating/venueZones';
import { MAX_BOOTHS, codePrefix, nextBoothNumber } from '../../../../components/seating/boothZones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The venue map editor.
 *
 * Saving is a FULL REPLACE — `PUT /events/:id/venue-map` takes the whole table
 * list and reconciles it in ONE transaction. Anything still listed is created
 * or updated, anything dropped is deleted, and every deletion is checked
 * against live stock first. A refusal rolls the whole thing back. Everything
 * on this screen rides that one save — tables, zones, the Venue Studio, and
 * the seats blocked in its Preview (useMapPersistence.js).
 *
 * WHICH IS ALSO WHY LEAVING ASKS FIRST (useUnsavedGuard), and why Ctrl+Z
 * inside a text field undoes the typing rather than the map. Tables are added
 * only on purpose — Add to layout, the Add menu, the starter card; the floor's
 * double-click no longer drops one (2026-11-21).
 *
 * TABLES AND ZONES TAKE DIFFERENT ROADS TO THE SAME SAVE. Tables are stock —
 * rows in `tables`, each generating the seats that holds and tickets point at.
 * Zones are furniture, and live in `layout_json`. One `PUT` carries both, so a
 * map can never be saved with its tables moved and its stage left where it
 * was. `layoutZones.js` argues the storage choice at length.
 *
 * THIS COMPONENT OWNS THE VIEWPORT AND THE GESTURES rather than the canvas,
 * because they are needed outside it: the toolbar drives the zoom, the keyboard
 * pans, and the print pack needs the same zone list the canvas is drawing. The
 * round trips are useMapPersistence; the side panel is EditorSidePanel.
 *
 * VENDOR BOOTHS ARE ON THIS MAP TOO (2026-11-22, the owner: "merge the seating
 * map of the event and the seating map of vendors"). One drawing of the hall:
 * booths are added from "Vendor booths" in Add to layout, carried as zones of
 * kind `booth`, and saved to the vendor floor plan by the same Save
 * (boothZones.js, useMapPersistence.js). A separate plan drawn earlier is
 * offered once, as "Bring them onto this map".
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function MapEditor({ eventId }) {
  const draft = useMapDraft();
  const { tables, zones, world, problems } = draft;

  // The Venue Studio's draft (venue, 3D, 360°, sections, seat blocks).
  const studioDraft = useStudioDraft();
  const { studio } = studioDraft;
  const [workspace, setWorkspace] = useState('layout');
  const [showSection, setShowSection] = useState(false);
  const dirty = draft.dirty || studioDraft.studioDirty;

  const selection = useSelection();
  /**
   * WHAT THE EDITOR FRAMES: the room, plus anything drawn outside it, with a
   * margin (2026-10-16, owner's review). Set once the map has loaded, and
   * again by Fit; never on an edit, which would yank the view mid-drag —
   * except a change of venue size (a resize, or its undo), which changes the
   * sheet itself.
   */
  const [frame, setFrame] = useState(() => editorBounds(world));
  const [framedWorld, setFramedWorld] = useState(world);
  if (framedWorld !== world) {
    setFramedWorld(world);
    setFrame(frameFor(tables, zones, world));
  }
  // Touch stays direct (one finger drags tables); the frame changes only on
  // load, Fit and a venue resize, so it is always followed. A bare wheel
  // scrolls the page except in full screen (usePanZoom, 2026-11-19).
  const panzoom = usePanZoom(frame, { wheelMode: 'pan', touch: 'direct', follow: 'always' });
  const fitRoom = () => {
    const next = frameFor(tables, zones, world);
    // The same frame again does not re-trigger the hook, so ask it directly.
    if (sameBox(next, frame)) panzoom.fit(); else setFrame(next);
  };

  const io = useMapPersistence({ eventId, draft, studioDraft, selection, onFrame: setFrame });
  const { tiers, categories, layout, eventTitle, eventInfo } = io;

  // Vendor booths (boothZones.js): editable here once the floor plan was read
  // and any separate plan's booths have been brought onto this map.
  const booths = zones.filter((z) => z.kind === BOOTH_KIND);
  const offerImport = !!io.boothImport && booths.length === 0;
  const vendorsOn = !!io.vendor && !offerImport;
  const [showBoothRow, setShowBoothRow] = useState(false);
  const purchaseMode = eventInfo.purchaseMode;
  /**
   * THE EVENT MAP (2026-11-23): every ticketed event has one. A
   * general-admission event's sells nothing — no seats, no tables — so its
   * editor offers the room, the furniture and the vendor booths only, and
   * the server refuses a general-admission map that carries seats.
   */
  const ctxAdmission = useEventContext()?.event?.admissionType;
  const seating = (eventInfo.admissionType || ctxAdmission || 'reserved') !== 'general';

  /**
   * S-04: on a live event every seat needs a price, and the server refuses a
   * save that leaves one without. Said here, with Save disabled, rather than
   * after a round trip — the same bargain as the rest of `problems`. Exactly
   * the server's rule: selling whole tables only, seats need no price.
   */
  const eventStatus = useEventContext()?.event?.status || null;
  const eventVenueName = useEventContext()?.event?.venueName || null;
  const liveUnpriced = eventStatus === 'published' && purchaseMode !== 'table_only'
    ? countUnpriced(tables, purchaseMode) : 0;
  const saveProblems = liveUnpriced > 0
    ? [...problems, `This event is on sale, so every seat needs a price. ${liveUnpriced} ${liveUnpriced === 1 ? 'table has' : 'tables have'} none — choose a ticket type for ${liveUnpriced === 1 ? 'it' : 'them'}.`]
    : problems;

  const [showAdd, setShowAdd] = useState(false);
  const [showPack, setShowPack] = useState(false);
  const [showDesigner, setShowDesigner] = useState(false);
  const { quota: aiQuota } = useAiQuota();
  // AI is offered (in Add to layout, the Add menu and the empty-map banner)
  // whenever it is set up — and when it cannot run here, its dialog says why.
  const aiOn = !!(aiQuota?.enabled || aiQuota?.reason === 'ADMIN_ACCOUNT');
  const [toolsOpen, setToolsOpen] = useState(false);   // phones only — PhoneTools.jsx
  // What the canvas draws (LayersCard.jsx). The map itself is unchanged.
  const [layers, setLayers] = useState({ zones: true, labels: true, booths: true });
  const toggleLayer = useCallback((key) => setLayers((l) => ({ ...l, [key]: !l[key] })), []);
  // The Layers list offers "Vendor booths" only where the event has a vendor floor plan.
  const shownLayers = io.vendor ? layers : { zones: layers.zones, labels: layers.labels };

  const [tool, setTool] = useState('select');
  const [snapToGrid, setSnapToGrid] = useState(false);
  const toolRef = useRef('select');
  const setToolBoth = useCallback((next) => { toolRef.current = next; setTool(next); }, []);

  useUnsavedGuard(dirty);

  // Which kind the side panel asked "Add to the map" to open on (null: the
  // toolbar's plain Add element), and the card Full screen enlarges.
  const [addInitial, setAddInitial] = useState(null);
  const canvasCard = useRef(null);
  const panelRef = useRef(null);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else canvasCard.current?.requestFullscreen?.();
  };

  /**
   * "SAVE AND CONTINUE" SAVES THE MAP. The step bar is the one way out of
   * this screen that can do better than ask, because it knows where the reader
   * is going and can commit first. The problem list is a refusal: returning
   * false keeps the reader on the canvas, the only place it can be fixed.
   */
  useStepSave(async () => {
    if (!dirty) return true;
    if (saveProblems.length > 0) return false;
    return io.save();
  });

  /* ── the selection's operations, shared by the panels and the keyboard ──── */

  // State, not the ref beside it, and no useCallback: React's compiler cannot
  // verify a useCallback that reaches into a ref, and every caller here is an
  // event handler running against the committed render.
  const duplicateSelected = () => {
    const next = draft.duplicateSelection(selection.selection);
    // Selecting the COPIES is what makes a repeated Ctrl+D lay out a row.
    if (next) selection.replace(next.tables, next.zones);
  };

  const removeSelected = () => {
    draft.removeSelection(selection.selection);
    selection.clear();
  };

  /** One ticket type for every selected table — the side panel's assignment.
   *  One undo step for the lot, not one per table. */
  const assignTier = (tierId) => {
    draft.updateTables([...selection.selection.tables], () => ({ tierId }));
  };

  /** One whole-table price for every selected table (2026-11-21) — what an
   *  event that sells whole tables needs after "Select these N". */
  const assignTablePrice = (priceCents) => {
    draft.updateTables([...selection.selection.tables], () => ({ priceCents }));
  };

  /**
   * Private, or public again, for every selected table (owner, 2026-11-24:
   * "mark all selected tables as Private in one action"). One undo step. The
   * password rides the save like a single table's; public clears it.
   */
  const setPrivateSelected = (on, password) => {
    draft.updateTables([...selection.selection.tables], () => (on
      ? { isPrivate: true, ...(password ? { password } : {}) }
      : { isPrivate: false, password: '' }));
  };

  /** One category for every selected table (2026-11-19). */
  const assignCategory = (categoryId) => {
    draft.updateTables([...selection.selection.tables], () => ({ categoryId }));
  };

  /** One size for every selected table. A slider drag is one undo step. */
  const resizeSelected = (scale) => {
    draft.updateTables([...selection.selection.tables], (t) => {
      const { scale: _old, ...rest } = t.style || {};
      const style = scale === 1 ? rest : { ...rest, scale };
      return { style: Object.keys(style).length ? style : null };
    }, { mergeKey: `resize:${[...selection.selection.tables].sort().join(',')}` });
  };

  const rotateSelected = (degrees) => {
    draft.rotateSelection(selection.selection, degrees);
  };

  const { spacePan, spacePanRef, onElementKeyDown } = useEditorKeys({
    draft,
    selection,
    snapToGrid,
    setTool: setToolBoth,
    panByScreen: panzoom.panByScreen,
    onDuplicate: duplicateSelected,
    onRemove: removeSelected,
    active: workspace === 'layout',
  });

  /** Draw walls (style/useWallTool.jsx): its walls land selected, as one undo step. */
  const wallTool = useWallTool({
    svgRef: panzoom.svgRef, view: panzoom.view, world, look: draft.look, zones, active: tool === 'wall',
    onCreate: (segments) => selection.replace([], draft.addZones(segments)),
    onExit: () => setToolBoth('select'),
  });

  /** An Add-to-layout item: a tool (Draw walls), a seating section, or the Add dialog. */
  // A ready-made map: false, true (the picker), or a venue map's id to open
  // on (the empty map's suggestion, or Templates → Use in an event, which
  // arrives as ?venueMap=<id>).
  const venueMapParam = useSearchParams()?.get('venueMap') || null;
  const [showMapTpl, setShowMapTpl] = useState(() => venueMapParam || false);
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const addFrom = (initial) => {
    if (initial.family === 'template') { setShowMapTpl(initial.templateId || true); return; }
    if (initial.family === 'image') { setShowImport(true); return; }
    if (initial.family === 'ai') { setShowDesigner(true); return; }
    if (initial.family === 'tool') { selection.clear(); setToolBoth(initial.key); return; }
    if (initial.family === 'section') { setShowSection(true); return; }
    if (initial.family === 'boothRow') { setShowBoothRow(true); return; }
    // One booth, at once (like a stage): numbered after the last booth added,
    // in its series and of its type, so clicking Booth five times lays a run.
    if (initial.family === 'booth') {
      if (booths.length >= MAX_BOOTHS) return;
      const last = booths[booths.length - 1] || null;
      const prefix = last ? codePrefix(last.label) : 'A';
      const position = freeSpot(panzoom.view, { w: BOOTH_META.w, h: BOOTH_META.h }, tables, zones, world);
      const ids = draft.addZones([{
        kind: BOOTH_KIND,
        position,
        overrides: { label: `${prefix}${nextBoothNumber(zones, prefix)}`.slice(0, 12), boothTypeId: last?.boothTypeId || null, blocked: false },
      }]);
      if (ids.length) selection.replace([], ids);
      return;
    }
    // ONE THING, NO FORM (2026-11-21). A stage, an area, a door, a word on the
    // floor, a decoration or a single seat has nothing to count or number,
    // so it appears at once — in the middle of the view, at the nearest free
    // spot (mapApi.freeSpot) — selected, with its settings beside it. Tables
    // and rows keep the Add dialog: how many, in what arrangement, numbered
    // from where.
    if (initial.family === 'zone' && !initial.pick) {
      const meta = zoneMeta(initial.key);
      const position = freeSpot(panzoom.view, { w: meta.w, h: meta.h }, tables, zones, world);
      const ids = draft.addZones([{ kind: initial.key, position }]);
      if (ids.length) selection.replace([], ids);
      return;
    }
    if (initial.family === 'table' && initial.seatCount === 1) {
      const reach = tableReach({ shape: initial.key, seatCount: 1, style: null });
      const position = freeSpot(panzoom.view, { w: reach * 2, h: reach * 2 }, tables, zones, world);
      const keys = draft.addTables([{ shape: initial.key, seatCount: 1, position }]);
      if (keys.length) selection.replace(keys, []);
      return;
    }
    setAddInitial(initial); setShowAdd(true);
  };

  /** "Apply to all tables": clears the tables' own colours so the look shows. */
  const applyLookToTables = () => {
    draft.updateTables(tables.map(keyOf), (t) => {
      const { fill, labelColor, stroke, strokeWidth, ...rest } = t.style || {};  
      return { style: Object.keys(rest).length ? rest : null };
    });
  };

  /** "Select them": exactly the tables that cannot be sold yet, so the
   *  inspector opens on them with the ticket-type picker ready (2026-11-21). */
  const selectUnpriced = () => {
    selection.replace(tables.filter((t) => isUnpriced(t, purchaseMode)).map(keyOf), []);
  };

  const interaction = useCanvasInteraction({
    svgRef: panzoom.svgRef,
    view: panzoom.view,
    panByScreen: panzoom.panByScreen,
    draft,
    selection,
    snapToGrid,
    toolRef,
    spacePanRef,
  });

  /* ── derived ────────────────────────────────────────────────────────────── */

  const sections = liveSections(studio.sections, tables);
  // The Studio's preview shows the draft's look, not the last saved one.
  const previewLayout = useMemo(() => writeLook(layout, draft.look), [layout, draft.look]);
  const preview3d = (
    <Preview3DCard
      tables={tables} zones={zones} world={world} scene={studio.scene} tiers={tiers}
      categories={categories} look={draft.look} onOpen={() => setWorkspace('3d')}
    />
  );

  const sole = soleSelected(selection.selection, tables, zones);

  /** Sold and held seats per table, so the canvas can draw which stock is
   *  already spoken for before a save refuses to delete it. */
  const soldByTable = useMemo(() => {
    const map = new Map();
    for (const t of tables) {
      if (t.soldSeats) map.set(keyOf(t), t.soldSeats);
    }
    return map;
  }, [tables]);

  /** Tables marked Unavailable (pending blocks included), for the canvas. */
  const unavailableByTable = useMemo(() => {
    const map = new Map();
    for (const t of tables) {
      const s = t.id ? studioDraft.tableStock.get(t.id) : null;
      if (s && s.total > 0 && s.open === 0 && s.blocked > 0) map.set(keyOf(t), true);
    }
    return map;
  }, [tables, studioDraft.tableStock]);

  const seatTotal = tables.reduce((sum, t) => sum + (Number(t.seatCount) || 0), 0);
  const soldTotal = tables.reduce((sum, t) => sum + (Number(t.soldSeats) || 0), 0);
  const blockedTotal = tables.reduce((sum, t) => sum + (Number(t.blockedSeats) || 0), 0);
  // Why a whole-map replacement (a template's map, a picture) is refused.
  const replaceBlocked = soldTotal > 0 ? `${soldTotal} seat${soldTotal === 1 ? ' is' : 's are'} already held or sold on this map, so it can’t be replaced. Edit the map by hand instead.` : null;

  /** Where the dialogs BUILD a new group before it is placed: the top-left of
   *  what is on screen. `placeAt` then moves the finished group to the
   *  nearest free spot in view (mapApi.freeSpot, 2026-11-21) — so a section
   *  lands in the middle of the room, clear of the seats already there. */
  const addOrigin = useMemo(() => ({
    x: clamp(((panzoom.view.x + panzoom.view.width * 0.12) / world.width) * 100, 0, 96),
    y: clamp(((panzoom.view.y + panzoom.view.height * 0.14) / world.height) * 100, 0, 94),
  }), [panzoom.view, world]);
  const placeAt = useCallback(
    (size) => freeSpot(panzoom.view, size, tables, zones, world),
    [panzoom.view, tables, zones, world],
  );

  if (io.loading) return <Loading variant="card" />;

  if (io.loadError) {
    const { title, recovery } = describeError(io.loadError);
    return (
      <div className="fx-stack fx-stack--sm">
        <p className="font-medium text-ink">{title}</p>
        <p className="text-sm text-muted">{recovery}</p>
        <Link href={`/organizer/events/${eventId}`} className="text-sm text-accent">
          Back to the event
        </Link>
      </div>
    );
  }

  return (
    <div className="fx-stack">
      <MapHeader
        tables={tables}
        zones={zones.filter((z) => z.kind !== BOOTH_KIND)}
        soldTotal={soldTotal}
        blockedTotal={blockedTotal}
        dirty={dirty}
        saving={io.saving}
        canSave={!io.saving && dirty && saveProblems.length === 0}
        onSave={io.save}
        onExport={() => setShowPack(true)}
        onSaveTemplate={() => setShowSaveTpl(true)}
      />

      <StudioTabs
        value={workspace}
        onChange={setWorkspace}
        badges={{
          layout: tables.length ? `${seatTotal.toLocaleString('en')} seats` : null,
          '360': studio.views.length ? `${studio.views.length} photo${studio.views.length === 1 ? '' : 's'}` : null,
        }}
      />

      {/* An empty map is invited ON the canvas (MapStarter: rows, tables, a
          template, or AI — seen on a phone too, the 2026-11-03 ask), so no
          banner repeats it up here; once there is seating, this says what
          still stops it selling. */}
      {workspace === 'layout' && (tables.length > 0 || zones.length > 0) && (
        <MapBanner tables={tables} purchaseMode={purchaseMode} onSelectUnpriced={selectUnpriced} />
      )}

      <MapNotices
        problems={saveProblems} saveError={io.saveError} saveNote={io.saveNote}
        lookupFailed={io.lookupFailed} dirty={dirty} onReload={io.reload}
      />

      {/* A vendor floor plan drawn before booths lived on this map. */}
      {workspace === 'layout' && offerImport && (
        <section className="es-boothimport" aria-labelledby="booth-import-title">
          <div className="fx-min0">
            <h3 id="booth-import-title" className="es-boothimport__title">
              Your {io.boothImport.count} vendor booth{io.boothImport.count === 1 ? ' is' : 's are'} on a separate floor plan
            </h3>
            <p className="es-boothimport__text">
              Bring {io.boothImport.count === 1 ? 'it' : 'them'} onto this map to sell seats and booths from one drawing of the hall.
              They arrive selected, so you can drag them into place before you save
              {io.boothImport.extras > 0 ? '. The old plan’s walls and labels stay behind — this map draws the room.' : '.'}
            </p>
          </div>
          <button
            type="button" className="es-btn es-btn--primary"
            onClick={() => { const ids = io.importBooths(); if (ids.length) selection.replace([], ids); }}
          >
            Bring them onto this map
          </button>
        </section>
      )}

      <div id="studio-panel" role="tabpanel" aria-labelledby={`studio-tab-${workspace}`} className="fx-stack">
      <StudioWorkspace
        workspace={workspace} eventId={eventId} tables={tables} zones={zones} layout={previewLayout}
        world={world} onResizeWorld={draft.resizeWorld}
        sections={sections} tiers={tiers} eventTitle={eventTitle} eventInfo={eventInfo} draft={studioDraft}
        categories={categories} look={draft.look}
      />
      {workspace === 'layout' && (<>

      {/* The properties sit beside the map once there is room (2026-10-16):
          a container query puts a fixed 19rem panel to the right whenever the
          editor itself is 52rem wide. */}
      <div className="es-mapeditor">
      <div className="es-mapeditor__body">
        {/* THE LEFT COLUMN of the owner's Venue Builder mockup (2026-11-10):
            Add to layout, then Layers. Drawn only where the editor is wide
            enough for three columns; narrower, the same list is the
            toolbar's Add menu (BuildPanel.jsx). */}
        <div className="es-mapeditor__tools">
          <BuildPalette onAdd={addFrom} ai={aiOn} vendors={vendorsOn} seating={seating}>
            <LayersSection layers={shownLayers} onToggle={toggleLayer} />
          </BuildPalette>
        </div>
        {/* The toolbar sits ON the canvas card, as one surface — and that card
            is what Full screen enlarges, toolbar and all. */}
        <div ref={canvasCard} className="es-dcard es-mapcard">
          {/* Phones: a sentence and a switch, the toolbar folded — PhoneTools.jsx. */}
          <PhoneTools open={toolsOpen} onToggle={() => setToolsOpen((open) => !open)} controls="map-tools" />
          <div id="map-tools" className="es-maptools" data-open={toolsOpen ? 'true' : 'false'}>
            <EditorToolbar
              tables={tables}
              zones={zones}
              selection={selection}
              tool={tool}
              onToolChange={setToolBoth}
              snapToGrid={snapToGrid}
              onSnapChange={setSnapToGrid}
              canUndo={draft.canUndo}
              canRedo={draft.canRedo}
              onUndo={draft.undo}
              onRedo={draft.redo}
              onAdd={addFrom}
              ai={aiOn}
              vendors={vendorsOn}
              seating={seating}
              onFullscreen={toggleFullscreen}
              zoom={{
                // 100 % is the whole venue in view, whatever its size.
                scale: world.width / Math.max(panzoom.view.width, 1),
                in: panzoom.zoomIn,
                out: panzoom.zoomOut,
                fit: fitRoom,
              }}
            />
          </div>
          <EditorCanvas
            className="es-mapcanvas"
            tables={tables}
            zones={zones}
            categories={categories}
            tiers={tiers}
            soldByTable={soldByTable}
            unavailableByTable={unavailableByTable}
            world={world}
            selection={selection}
            panzoom={panzoom}
            interaction={interaction}
            tool={tool}
            spacePan={spacePan}
            snapToGrid={snapToGrid}
            onNudge={onElementKeyDown}
            layers={layers}
            boothInfo={io.boothInfo}
            look={draft.look}
            wallTool={wallTool}
            emptyState={<MapStarter eventId={eventId} onAdd={addFrom} ai={aiOn} seating={seating} vendors={vendorsOn} />}
          />
        </div>
        {/* Outside the card, so the zoom pill floating on the canvas's corner
            never sits on it; a grid cell only where it shows (below 52rem). */}
        <SelectionJump selection={selection} sole={sole} drawingWalls={wallTool.active} panelRef={panelRef} />

        {/* The inspector, then the 3D preview — always in that order, as in
            the owner's mockup. The preview used to jump above or below the
            inspector on every click, so the panel moved under the pointer. */}
        <div ref={panelRef} className="es-mapeditor__panel">
        <EditorSidePanel
          sole={sole} selection={selection} draft={draft} tables={tables} tiers={tiers} world={world}
          categories={categories} purchaseMode={purchaseMode} onTierCreated={io.addTier}
          onAssignTier={assignTier} onAssignCategory={assignCategory} onResizeSelected={resizeSelected}
          onRotate={rotateSelected} onDuplicate={duplicateSelected}
          onRemoveSelected={removeSelected}
          onSelectUnpriced={selectUnpriced}
          onAssignTablePrice={assignTablePrice}
          layers={shownLayers}
          onToggleLayer={toggleLayer}
          eventId={eventId}
          boothInfo={io.boothInfo}
          dirty={dirty} saving={io.saving} canSave={!io.saving && dirty && saveProblems.length === 0} onSave={io.save} onAdd={addFrom}
          wallTool={wallTool}
          onApplyLook={applyLookToTables}
          onSetPrivateSelected={setPrivateSelected}
          tableStock={studioDraft.tableStock}
          onSetUnavailable={studioDraft.setTablesUnavailable}
        />
        {preview3d}
        </div>
      </div>
      </div>
      <StudioStatsBar tables={tables} sections={sections} tiers={tiers} standing={studio.venue.standingCapacity} />
      </>)}
      </div>

      {showSection && (
        <SectionDialog
          origin={addOrigin}
          placeAt={placeAt}
          world={world}
          zones={zones}
          tables={tables}
          tiers={tiers}
          onTierCreated={io.addTier}
          roomForTables={Math.max(0, MAX_TABLES - tables.length)}
          onClose={() => setShowSection(false)}
          onAdd={({ tables: rows, sections: added }) => {
            const keys = draft.addTables(rows);
            selection.replace(keys, []);
            studioDraft.edit('sections', [...studio.sections, ...added]);
          }}
        />
      )}

      {showBoothRow && (
        <BoothRowDialog
          zones={zones}
          boothTypes={io.boothInfo?.boothTypes || []}
          world={world}
          placeAt={placeAt}
          roomForBooths={Math.max(0, MAX_BOOTHS - booths.length)}
          onClose={() => setShowBoothRow(false)}
          onAdd={(specs) => { const ids = draft.addZones(specs); if (ids.length) selection.replace([], ids); }}
        />
      )}

      {showImport && (
        <ImageImportDialog
          eventId={eventId}
          replacing={tables.length > 0 || zones.length > 0}
          blocked={replaceBlocked}
          onClose={() => setShowImport(false)}
          onApply={(map) => {
            selection.replace(draft.loadMap(map), []);
            studioDraft.edit('sections', []);
            setShowImport(false);
          }}
        />
      )}

      {showMapTpl && (
        <MapTemplateDialog
          eventId={eventId}
          initialId={typeof showMapTpl === 'string' ? showMapTpl : null}
          tiers={tiers}
          categories={categories}
          replacing={tables.length > 0 || zones.length > 0}
          blocked={replaceBlocked}
          onClose={() => setShowMapTpl(false)}
          onApply={(spec) => {
            selection.replace(draft.loadMap(spec), []);
            studioDraft.edit('sections', spec.sections || []);
            setShowMapTpl(false);
          }}
        />
      )}

      {showSaveTpl && (
        <SaveMapTemplateDialog
          eventId={eventId}
          venueName={eventVenueName}
          dirty={dirty}
          saving={io.saving}
          canSave={!io.saving && dirty && saveProblems.length === 0}
          onSaveMap={io.save}
          onClose={() => setShowSaveTpl(false)}
        />
      )}

      {showAdd && (
        <AddElementDialog
          initial={addInitial}
          origin={addOrigin}
          placeAt={placeAt}
          world={world}
          roomForTables={Math.max(0, MAX_TABLES - tables.length)}
          onClose={() => setShowAdd(false)}
          onAdd={({ tables: newTables, zones: newZones }) => {
            if (newTables) selection.replace(draft.addTables(newTables), []);
            if (newZones) selection.replace([], draft.addZones(newZones));
          }}
        />
      )}

      {showDesigner && (
        <SeatingDesigner
          eventId={eventId}
          tiers={tiers}
          categories={categories}
          replacing={tables.length > 0 || zones.length > 0}
          world={world}
          blocked={aiQuota?.reason === 'ADMIN_ACCOUNT'
            ? 'The Seating Designer is used from the organizer’s own account, so it never spends their daily AI drafts on their behalf. Sign in as the organizer to use it.'
            : soldTotal > 0
              ? `${soldTotal} seat${soldTotal === 1 ? ' is' : 's are'} already held or sold on this map, so the layout can’t be replaced. Edit the map by hand instead.`
              : null}
          onClose={() => setShowDesigner(false)}
          onApply={(plan) => {
            const { tableKeys, zoneIds } = draft.replaceLayout(plan.tables, plan.zones);
            selection.replace(tableKeys, zoneIds);
          }}
        />
      )}

      {showPack && (
        <SeatingPackModal
          eventTitle={eventTitle}
          tables={tables}
          zones={zones}
          categories={categories}
          dirty={dirty}
          world={world}
          onClose={() => setShowPack(false)}
        />
      )}
    </div>
  );
}
