'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { describeError } from '../../../../utils/errors';
import { usePanZoom } from '../../../../components/seating/usePanZoom';
import { Loading } from '../../../../components/Feedback';
import EditorCanvas, { editorBounds } from './EditorCanvas';
import EditorToolbar from './EditorToolbar';
import PhoneTools from './PhoneTools';
import AddElementDialog from './AddElementDialog';
import EditorSidePanel from './EditorSidePanel';
import { BuildPalette } from './BuildPanel';
import LayersCard from './LayersCard';
import { MapHeader, MapBanner, MapNotices, countUnpriced } from './MapChrome';
import { useEventContext } from '../EventContext';
import { frameFor, sameBox, clamp } from './mapApi';
import { liveSections } from '../../../../components/venue/venueModel';
import StudioTabs from './studio/StudioTabs';
import SectionDialog from './studio/SectionDialog';
import StudioWorkspace from './studio/StudioWorkspace';
import StudioStatsBar from './studio/StudioStatsBar';
import Preview3DCard from './studio/Preview3DCard';
import { useStudioDraft } from './studio/useStudioDraft';
import SeatingPackModal from './print/SeatingPackModal';
import SeatingDesigner, { DesignBanner } from './SeatingDesigner';
import { useAiQuota } from '../../../../hooks/useAiQuota';
import { useMapDraft, keyOf, MAX_TABLES } from './useMapDraft';
import { useMapPersistence } from './useMapPersistence';
import { useSelection, soleSelected } from './useSelection';
import { useCanvasInteraction } from './useCanvasInteraction';
import { useEditorKeys } from './useEditorKeys';
import { useUnsavedGuard } from './useUnsavedGuard';
import { useStepSave } from '../BuildStep';

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
 * WHICH IS ALSO WHY LEAVING ASKS FIRST (useUnsavedGuard), why a table can be
 * added with a button as well as a double-click (which touch screens do not
 * reliably send), and why Ctrl+Z inside a text field undoes the typing rather
 * than the map.
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
  const panzoom = usePanZoom(frame, { wheelMode: 'pan' });
  const fitRoom = () => {
    const next = frameFor(tables, zones, world);
    // The same frame again does not re-trigger the hook, so ask it directly.
    if (sameBox(next, frame)) panzoom.fit(); else setFrame(next);
  };

  const io = useMapPersistence({ eventId, draft, studioDraft, selection, onFrame: setFrame });
  const { tiers, categories, layout, eventTitle, eventInfo } = io;
  const purchaseMode = eventInfo.purchaseMode;

  /**
   * S-04: on a live event every seat needs a price, and the server refuses a
   * save that leaves one without. Said here, with Save disabled, rather than
   * after a round trip — the same bargain as the rest of `problems`. Exactly
   * the server's rule: selling whole tables only, seats need no price.
   */
  const eventStatus = useEventContext()?.event?.status || null;
  const liveUnpriced = eventStatus === 'published' && purchaseMode !== 'table_only'
    ? countUnpriced(tables, purchaseMode) : 0;
  const saveProblems = liveUnpriced > 0
    ? [...problems, `This event is on sale, so every seat needs a price. ${liveUnpriced} ${liveUnpriced === 1 ? 'table has' : 'tables have'} none — choose a ticket type for ${liveUnpriced === 1 ? 'it' : 'them'}.`]
    : problems;

  const [showAdd, setShowAdd] = useState(false);
  const [showPack, setShowPack] = useState(false);
  const [showDesigner, setShowDesigner] = useState(false);
  const { quota: aiQuota } = useAiQuota();
  const [toolsOpen, setToolsOpen] = useState(false);   // phones only — PhoneTools.jsx
  // What the canvas draws (LayersCard.jsx). The map itself is unchanged.
  const [layers, setLayers] = useState({ zones: true, labels: true });
  const toggleLayer = useCallback((key) => setLayers((l) => ({ ...l, [key]: !l[key] })), []);

  const [tool, setTool] = useState('select');
  const [snapToGrid, setSnapToGrid] = useState(false);
  const toolRef = useRef('select');
  const setToolBoth = useCallback((next) => { toolRef.current = next; setTool(next); }, []);

  useUnsavedGuard(dirty);

  // Which kind the side panel asked "Add to the map" to open on (null: the
  // toolbar's plain Add element), and the card Full screen enlarges.
  const [addInitial, setAddInitial] = useState(null);
  const canvasCard = useRef(null);
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

  /** One ticket type for every selected table — the side panel's assignment. */
  const assignTier = (tierId) => {
    for (const key of selection.selection.tables) draft.updateTable(key, { tierId });
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
  });

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
  const preview3d = <Preview3DCard tables={tables} zones={zones} world={world} scene={studio.scene} tiers={tiers} onOpen={() => setWorkspace('3d')} />;

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

  const seatTotal = tables.reduce((sum, t) => sum + (Number(t.seatCount) || 0), 0);
  const soldTotal = tables.reduce((sum, t) => sum + (Number(t.soldSeats) || 0), 0);
  const blockedTotal = tables.reduce((sum, t) => sum + (Number(t.blockedSeats) || 0), 0);

  /** Where a newly added element lands: the top-left of what is on screen,
   *  inset a little, so a section built after panning appears where the
   *  organizer is looking rather than in the middle of the world. */
  const addOrigin = useMemo(() => ({
    x: clamp(((panzoom.view.x + panzoom.view.width * 0.12) / world.width) * 100, 0, 96),
    y: clamp(((panzoom.view.y + panzoom.view.height * 0.14) / world.height) * 100, 0, 94),
  }), [panzoom.view, world]);

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
        zones={zones}
        seatTotal={seatTotal}
        soldTotal={soldTotal}
        blockedTotal={blockedTotal}
        dirty={dirty}
        saving={io.saving}
        canSave={!io.saving && dirty && saveProblems.length === 0}
        onSave={io.save}
        onExport={() => setShowPack(true)}
      />

      <StudioTabs
        value={workspace}
        onChange={setWorkspace}
        badges={{
          layout: tables.length ? `${seatTotal.toLocaleString('en')} seats` : null,
          '360': studio.views.length ? `${studio.views.length} photo${studio.views.length === 1 ? '' : 's'}` : null,
        }}
      />

      {workspace === 'layout' && <MapBanner tables={tables} purchaseMode={purchaseMode} />}

      <MapNotices
        problems={saveProblems} saveError={io.saveError} saveNote={io.saveNote}
        lookupFailed={io.lookupFailed} dirty={dirty} onReload={io.reload}
      />

      <div id="studio-panel" role="tabpanel" aria-labelledby={`studio-tab-${workspace}`} className="fx-stack">
      <StudioWorkspace
        workspace={workspace} eventId={eventId} tables={tables} zones={zones} layout={layout}
        world={world} onResizeWorld={draft.resizeWorld}
        sections={sections} tiers={tiers} eventTitle={eventTitle} eventInfo={eventInfo} draft={studioDraft}
      />
      {workspace === 'layout' && (<>

      {/* Outside the folded tools, so it is seen on a phone too (2026-11-03:
          "no AI button" — it was inside the toolbar a phone hides). */}
      {(aiQuota?.enabled || aiQuota?.reason === 'ADMIN_ACCOUNT') && (
        <DesignBanner empty={tables.length === 0 && zones.length === 0} onOpen={() => setShowDesigner(true)} />
      )}

      {/* The properties sit beside the map once there is room (2026-10-16):
          a container query puts a fixed 19rem panel to the right whenever the
          editor itself is 52rem wide. */}
      <div className="es-mapeditor">
      <div className="es-mapeditor__body">
        {/* THE LEFT COLUMN of the owner's Venue Builder mockup (2026-11-10):
            Add to layout, then Layers. Drawn only where the editor is wide
            enough for three columns; narrower, the add tools stay in the
            panel on the right (EditorSidePanel → BuildPanel). */}
        <div className="es-mapeditor__tools">
          <BuildPalette onAdd={(initial) => {
            if (initial.family === 'section') { setShowSection(true); return; }
            setAddInitial(initial); setShowAdd(true);
          }} />
          <LayersCard layers={layers} onToggle={toggleLayer} />
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
              onAdd={() => { setAddInitial(null); setShowAdd(true); }}
              onFullscreen={toggleFullscreen}
              // Shown whenever AI is set up — and when it cannot run here, the dialog
              // says why, rather than the button silently not being there.
              onDesign={aiQuota?.enabled || aiQuota?.reason === 'ADMIN_ACCOUNT' ? () => setShowDesigner(true) : null}
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
            world={world}
            selection={selection}
            panzoom={panzoom}
            interaction={interaction}
            tool={tool}
            spacePan={spacePan}
            snapToGrid={snapToGrid}
            onAddAt={(position) => {
              const [key] = draft.addTables([{ position }]);
              if (key) selection.selectOnly('table', key);
            }}
            onNudge={onElementKeyDown}
            layers={layers}
          />
        </div>

        <div className="es-mapeditor__panel">
        {/* On top while nothing is selected (the panel's resting state), below the
            properties once something is — the properties are what the click was for. */}
        {selection.count === 0 && preview3d}
        <EditorSidePanel
          sole={sole} selection={selection} draft={draft} tables={tables} tiers={tiers} world={world}
          categories={categories} purchaseMode={purchaseMode} onTierCreated={io.addTier}
          onAssignTier={assignTier} onRotate={rotateSelected} onDuplicate={duplicateSelected}
          onRemoveSelected={removeSelected}
          onAdd={(initial) => {
            if (initial.family === 'section') { setShowSection(true); return; }
            setAddInitial(initial); setShowAdd(true);
          }}
        />
        {selection.count > 0 && preview3d}
        </div>
      </div>
      </div>
      <StudioStatsBar tables={tables} sections={sections} tiers={tiers} standing={studio.venue.standingCapacity} />
      </>)}
      </div>

      {showSection && (
        <SectionDialog
          origin={addOrigin}
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

      {showAdd && (
        <AddElementDialog
          initial={addInitial}
          origin={addOrigin}
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
