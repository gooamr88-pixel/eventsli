'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { get, put } from '../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../utils/errors';
import { WORLD, contentBounds } from '../../../../components/seating/seatingGeometry';
import { usePanZoom } from '../../../../components/seating/usePanZoom';
import { readZones, writeZones } from '../../../../components/seating/layoutZones';
import { Loading } from '../../../../components/Feedback';
import EditorCanvas, { EDITOR_BOUNDS } from './EditorCanvas';
import EditorToolbar from './EditorToolbar';
import PhoneTools from './PhoneTools';
import AddElementDialog from './AddElementDialog';
import TablePanel from './TablePanel';
import ZonePanel from './ZonePanel';
import SelectionPanel from './SelectionPanel';
import SeatingPackModal from './print/SeatingPackModal';
import { useMapDraft, keyOf, MAX_TABLES } from './useMapDraft';
import { useSelection, soleSelected } from './useSelection';
import { useCanvasInteraction } from './useCanvasInteraction';
import { useEditorKeys } from './useEditorKeys';
import { useUnsavedGuard } from './useUnsavedGuard';
import { useStepSave } from '../BuildStep';
import { MAX_ZONES } from '../../../../components/seating/venueZones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The venue map editor.
 *
 * Saving is a FULL REPLACE — `PUT /events/:id/venue-map` takes the whole table
 * list and reconciles it in ONE transaction. Anything still listed is created
 * or updated, anything dropped is deleted, and every deletion is checked
 * against live stock first. A refusal rolls the whole thing back.
 *
 * That last part is why this screen can be confident: the save either lands
 * completely or changes nothing. The alternative, which this API used to be, was
 * a loop of separate statements — a network blip halfway left the map half
 * saved, with no way to tell which half and no way back. For someone laying out
 * a two-hundred-table room, that is their afternoon.
 *
 * WHICH IS ALSO WHY LEAVING ASKS FIRST (useUnsavedGuard), why a table can be
 * added with a button as well as a double-click (which touch screens do not
 * reliably send), and why Ctrl+Z inside a text field undoes the typing rather
 * than the map.
 *
 *
 * TABLES AND ZONES TAKE DIFFERENT ROADS TO THE SAME SAVE.
 *
 * Tables are stock — rows in `tables`, each generating the seats that holds and
 * tickets point at. Zones are furniture, and live in `layout_json`, the blob
 * this endpoint round-trips verbatim. One `PUT` carries both, inside the one
 * transaction, so a map can never be saved with its tables moved and its stage
 * left where it was. `layoutZones.js` argues the storage choice at length.
 *
 * THIS COMPONENT OWNS THE VIEWPORT AND THE GESTURES rather than the canvas,
 * because they are needed outside it: the toolbar drives the zoom, the keyboard
 * pans, and the print pack needs the same zone list the canvas is drawing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function MapEditor({ eventId }) {
  const draft = useMapDraft();
  const { tables, zones, dirty, problems, reset } = draft;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tiers, setTiers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [layout, setLayout] = useState({});
  const [eventTitle, setEventTitle] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showPack, setShowPack] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);   // phones only — PhoneTools.jsx

  const [tool, setTool] = useState('select');
  const [snapToGrid, setSnapToGrid] = useState(false);
  const toolRef = useRef('select');
  const setToolBoth = useCallback((next) => { toolRef.current = next; setTool(next); }, []);

  const selection = useSelection();
  /**
   * WHAT THE EDITOR FRAMES: the room, plus anything drawn outside it, with a
   * margin (2026-10-16, owner's review). It framed the fixed room box alone —
   * edge to edge, with nothing around it to say "this is the sheet" — and
   * anything placed outside the room (an older map, an import) was not just
   * off screen but out of reach, because panning is held inside the frame.
   * Set once the map has loaded, and again by Fit; never on an edit, which
   * would yank the view while a table is being dragged.
   */
  const [frame, setFrame] = useState(EDITOR_BOUNDS);
  const panzoom = usePanZoom(frame, { wheelMode: 'pan' });
  const fitRoom = () => {
    const next = frameFor(tables, zones);
    // The same frame again does not re-trigger the hook, so ask it directly.
    if (sameBox(next, frame)) panzoom.fit(); else setFrame(next);
  };

  useUnsavedGuard(dirty);

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * "SAVE AND CONTINUE" SAVES THE MAP.
   *
   * `useUnsavedGuard` above already stops a drawn-but-unsaved plan leaving by
   * the browser's back button or a closed tab — but it can only ASK, and the
   * answer it offers is "leave and lose it". The step bar is the one way out
   * of this screen that can do better than ask, because it knows where the
   * reader is going and can commit first.
   *
   * THE PROBLEM LIST IS A REFUSAL, not a warning. It is the same condition the
   * Save button is disabled on — overlapping tables, seats outside the world
   * box — and the server rejects those plans. Returning false keeps the reader
   * on the canvas with the problems listed beside it, which is the only place
   * they can be fixed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useStepSave(async () => {
    if (!dirty) return true;
    if (problems.length > 0) return false;
    return save();
  });

  /* ── the selection's operations, shared by the panels and the keyboard ──── */

  /**
   * The three operations that act on "whatever is selected".
   *
   * They read `selection.selection` — the STATE — rather than the ref beside
   * it, and they are deliberately not wrapped in `useCallback`. Both follow
   * from the same thing: React's compiler memoizes this component, and a manual
   * `useCallback` whose body reaches into a ref is memoization it cannot verify,
   * so it gives up and optimizes nothing in the whole component.
   *
   * Reading state is also simply correct here. Every caller is an event handler
   * or a button, so it runs against the committed render; the ref exists for
   * the gesture handlers that are bound once and cannot see re-renders at all,
   * which is not this.
   */
  const duplicateSelected = () => {
    const next = draft.duplicateSelection(selection.selection);
    // Selecting the COPIES is what makes a repeated Ctrl+D lay out a row —
    // `useMapDraft.duplicateSelection` explains why at the other end.
    if (next) selection.replace(next.tables, next.zones);
  };

  const removeSelected = () => {
    draft.removeSelection(selection.selection);
    selection.clear();
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

  /* ── load ───────────────────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [map, tierList, categoryList, event] = await Promise.all([
          get(`/events/${eventId}/venue-map`, { cache: 'no-store' }),
          get(`/events/${eventId}/tiers`, { cache: 'no-store' }).catch(() => []),
          get(`/events/${eventId}/table-categories`, { cache: 'no-store' }).catch(() => []),
          // Only the printed pack's letterhead needs this, so a failure here
          // must not gate the editor — the pack simply prints without a title.
          get(`/events/${eventId}`, { cache: 'no-store' }).catch(() => null),
        ]);
        if (cancelled) return;

        const loadedTables = (map?.tables || []).map(fromApi);
        const loadedZones = readZones(map?.layout);
        reset(loadedTables, loadedZones);
        setFrame(frameFor(loadedTables, loadedZones));
        setLayout(map?.layout || {});
        setTiers(Array.isArray(tierList) ? tierList : []);
        setCategories(Array.isArray(categoryList) ? categoryList : []);
        setEventTitle(event?.title || event?.event?.title || '');
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reset]);

  /* ── save ───────────────────────────────────────────────────────────────── */

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await put(`/events/${eventId}/venue-map`, {
        // The rest of the blob is round-tripped untouched: `writeZones` replaces
        // one key and preserves every other, so an editor that predates a future
        // `layout.floorPlanImage` cannot destroy it on a full-replace save.
        layout: writeZones({ ...layout, world: { width: WORLD.width, height: WORLD.height } }, zones),
        tables: tables.map(toApi),
      }, { noRedirect: true });

      // Re-read rather than trusting local state: the save assigns ids to new
      // tables and generates their seat rows, and neither exists here. What
      // `reset` loads counts as saved, so "unsaved changes" clears.
      const map = await get(`/events/${eventId}/venue-map`, { cache: 'no-store' });
      reset((map?.tables || []).map(fromApi), readZones(map?.layout));
      setLayout(map?.layout || {});
      selection.clear();
      return true;
    } catch (err) {
      setSaveError(err);
      return false;
    } finally {
      setSaving(false);
    }
  }

  /* ── derived ────────────────────────────────────────────────────────────── */

  const sole = soleSelected(selection.selection, tables, zones);

  /** Sold and held seats per table, so the canvas can draw which stock is
   *  already spoken for — and the organizer can see why a table will refuse to
   *  be deleted before the save tells them. */
  const soldByTable = useMemo(() => {
    const map = new Map();
    for (const t of tables) {
      if (t.soldSeats) map.set(keyOf(t), t.soldSeats);
    }
    return map;
  }, [tables]);

  const seatTotal = tables.reduce((sum, t) => sum + (Number(t.seatCount) || 0), 0);
  const soldTotal = tables.reduce((sum, t) => sum + (Number(t.soldSeats) || 0), 0);

  /** Where a newly added element lands: the top-left of what is on screen,
   *  inset a little, so a section built after panning appears where the
   *  organizer is looking rather than in the middle of the world. */
  const addOrigin = useMemo(() => ({
    x: clamp(((panzoom.view.x + panzoom.view.width * 0.12) / WORLD.width) * 100, 0, 96),
    y: clamp(((panzoom.view.y + panzoom.view.height * 0.14) / WORLD.height) * 100, 0, 94),
  }), [panzoom.view]);

  if (loading) return <Loading variant="card" />;

  if (loadError) {
    const { title, recovery } = describeError(loadError);
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
      <div className="fx-row fx-row--between flex-wrap gap-3">
        <div className="fx-stack fx-stack--sm fx-min0 gap-2">
          <h2 className="text-xl">Seating map</h2>
          {/* What the room holds, as figures an organizer plans by — seats,
              not just tables. The limits appear only when they are close. */}
          <ul className="es-mapsum" aria-label="This room">
            <li>
              <b className="es-nums">{tables.length}</b>
              {tables.length === 1 ? ' table' : ' tables'}
              {tables.length >= MAX_TABLES * 0.8 && <span className="text-subtle"> of {MAX_TABLES}</span>}
            </li>
            <li><b className="es-nums">{seatTotal}</b>{seatTotal === 1 ? ' seat' : ' seats'}</li>
            {zones.length > 0 && (
              <li>
                <b className="es-nums">{zones.length}</b>
                {zones.length === 1 ? ' zone' : ' zones'}
                {zones.length >= MAX_ZONES * 0.8 && <span className="text-subtle"> of {MAX_ZONES}</span>}
              </li>
            )}
            {soldTotal > 0 && <li><b className="es-nums">{soldTotal}</b> sold or held</li>}
            {dirty && <li className="es-mapsum__dirty">Unsaved changes</li>}
          </ul>
        </div>

        <div className="fx-row flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowPack(true)}
            disabled={tables.length === 0 && zones.length === 0}
            className="es-btn es-btn--secondary"
          >
            Print / export
          </button>
          <button
            type="button" onClick={save}
            disabled={saving || !dirty || problems.length > 0}
            className="es-btn es-btn--primary"
          >
            {saving ? 'Saving…' : 'Save map'}
          </button>
        </div>
      </div>

      {/* Refused BEFORE the round trip. The API's messages for these are
          accurate but arrive after a save that looked like it was working. */}
      {problems.length > 0 && (
        <ul className="fx-stack fx-stack--sm rounded-(--es-radius-md) bg-warning/10 px-4 py-3 text-sm text-muted">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      {saveError && <SaveError error={saveError} />}

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
        onAdd={() => setShowAdd(true)}
        zoom={{
          scale: WORLD.width / Math.max(panzoom.view.width, 1),
          in: panzoom.zoomIn,
          out: panzoom.zoomOut,
          fit: fitRoom,
        }}
      />
      </div>

      {/* THE PROPERTIES SIT BESIDE THE MAP once there is room (2026-10-16,
          owner's review). This was a two-column grid whose columns had to be
          640px each, so below about 1,500px of screen the panel wrapped UNDER
          the canvas: select a table on a laptop and its settings appeared
          below the fold. Now a container query puts a fixed 19rem panel to the
          right whenever the editor itself is 52rem wide. */}
      <div className="es-mapeditor">
      <div className="es-mapeditor__body">
        <EditorCanvas
          className="es-mapcanvas"
          tables={tables}
          zones={zones}
          categories={categories}
          soldByTable={soldByTable}
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
        />

        <div className="es-mapeditor__panel">
        {selection.count > 1 ? (
          <SelectionPanel
            tableCount={selection.selection.tables.size}
            zoneCount={selection.selection.zones.size}
            onRotate={rotateSelected}
            onDuplicate={duplicateSelected}
            onRemove={removeSelected}
            onClear={selection.clear}
          />
        ) : sole?.kind === 'zone' ? (
          <ZonePanel
            zone={sole.zone}
            onChange={draft.updateZone}
            onRotate={rotateSelected}
            onResetSize={draft.resetZoneSize}
            onDuplicate={duplicateSelected}
            onRemove={(id) => { draft.removeZone(id); selection.clear(); }}
          />
        ) : (
          <TablePanel
            table={sole?.kind === 'table' ? sole.table : null}
            tiers={tiers}
            categories={categories}
            // Consecutive edits to the same field of the same table are one undo
            // step: typing a name used to be one step per keystroke.
            onChange={(key, patch) => draft.updateTable(key, patch, {
              mergeKey: `${key}:${Object.keys(patch).sort().join(',')}`,
            })}
            onRotate={rotateSelected}
            onDuplicate={duplicateSelected}
            onRemove={(key) => { draft.removeTable(key); selection.clear(); }}
          />
        )}
        </div>
      </div>
      </div>

      {showAdd && (
        <AddElementDialog
          origin={addOrigin}
          roomForTables={Math.max(0, MAX_TABLES - tables.length)}
          onClose={() => setShowAdd(false)}
          onAdd={({ tables: newTables, zones: newZones }) => {
            if (newTables) selection.replace(draft.addTables(newTables), []);
            if (newZones) selection.replace([], draft.addZones(newZones));
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
          onClose={() => setShowPack(false)}
        />
      )}
    </div>
  );
}

/**
 * A save refusal is usually about STOCK, not about the map: a table with sold
 * seats cannot be deleted, and a table cannot be shrunk past its booked seats.
 * The API names which ones, and that message is the useful part — so it is
 * shown rather than replaced with a generic sentence.
 */
function SaveError({ error }) {
  const { title } = describeError(error);
  return (
    <div role="alert" className="rounded-(--es-radius-md) bg-danger/10 px-4 py-3">
      <p className="text-sm font-medium text-ink">{title}</p>
      {/* `messageFor` keeps exactly the preference argued above — the server's
          sentence wins, because "table 12 has 3 seats sold" is the useful
          part. It only differs where `error.message` was never worth showing:
          a dropped connection put "Failed to fetch" here, under a heading
          about the map, next to a line promising nothing was saved. */}
      <p className="text-sm text-muted">{messageFor(error)}</p>
      <p className="mt-1 text-xs text-subtle">
        Nothing was saved — the whole change was rolled back, so the map is exactly as it
        was.
      </p>
    </div>
  );
}

/** The API's table → the editor's. `password` is never returned, only
 *  `hasPassword`, so the field starts empty and an untouched one means keep. */
function fromApi(t) {
  return {
    id: t.id,
    label: t.label,
    seatCount: t.seatCount,
    priceCents: t.priceCents,
    isPrivate: t.isPrivate,
    hasPassword: t.hasPassword,
    status: t.status,
    shape: t.shape,
    categoryId: t.categoryId,
    // Seats carry the tier, and every seat on a table shares it — so the first
    // one is the table's band. A table with no seats yet has none.
    tierId: t.seats?.[0]?.tierId || null,
    seatPriceCents: t.seats?.[0]?.priceOverrideCents ?? null,
    // How much of this table is already spoken for. Drawn on the canvas, and
    // the reason a delete will be refused — worth seeing before rearranging the
    // room around a table that cannot move.
    soldSeats: (t.seats || []).filter((s) => s.status && s.status !== 'available').length,
    position: t.position,
  };
}

/** The editor's table → the API's. */
function toApi(t) {
  return {
    // Absent on a new table, which is how the API tells create from update.
    ...(t.id ? { id: t.id } : {}),
    label: String(t.label).trim(),
    seatCount: Number(t.seatCount),
    priceCents: t.priceCents ?? null,
    isPrivate: !!t.isPrivate,
    // Sent only when actually typed. Sending the editor's state back without a
    // password must not silently unprotect a table — the API keeps the existing
    // hash unless a new one arrives, and clears it only on `isPrivate: false`.
    ...(t.password ? { password: t.password } : {}),
    shape: t.shape,
    categoryId: t.categoryId || null,
    tierId: t.tierId || null,
    seatPriceCents: t.seatPriceCents ?? null,
    position: {
      x: t.position?.x ?? 0,
      y: t.position?.y ?? 0,
      rotation: t.position?.rotation ?? 0,
    },
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** The room box united with everything drawn, plus a 5% margin all round, so
 *  the sheet sits ON the canvas instead of being cut by its edges. */
function frameFor(tables, zones) {
  const c = (tables.length || zones.length) ? contentBounds(tables, zones) : { x: 0, y: 0, width: 0, height: 0 };
  const x0 = Math.min(0, c.x);
  const y0 = Math.min(0, c.y);
  const x1 = Math.max(WORLD.width, c.x + c.width);
  const y1 = Math.max(WORLD.height, c.y + c.height);
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05;
  return { x: x0 - pad, y: y0 - pad, width: x1 - x0 + pad * 2, height: y1 - y0 + pad * 2 };
}

function sameBox(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
