'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { put } from '../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../utils/errors';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { usePanZoom } from '../../../../components/seating/usePanZoom';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { Booth, Decor, FloorPlanDefs, paintOrder } from '../../../../components/vendors/floorPlan/FloorPlanShapes';
import {
  INK, makeElement, makeRow, moveBy, nextCode, newId, starterPlan,
} from '../../../../components/vendors/floorPlan/floorPlanModel';
import { PlanPanel, ToolPanel, ItemPanel, MultiPanel } from './FloorPlanPanels';
import Link from 'next/link';
import FloorPlanViewer from '../../../../components/vendors/floorPlan/FloorPlanViewer';
import { planBooths } from '../../../../components/seating/boothZones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VENDOR FLOOR PLAN EDITOR (owner, 2026-11-20 — "very professional, as
 * this exactly", with two expo-hall plans as the reference).
 *
 * TOOLS. Select; Booth (click to place); Row of booths (count, size, code
 * prefix — the touching rows and long corridor tables of the reference);
 * Wall (click corner by corner, click the first corner or Finish to close);
 * Door; Area (the stage, the restaurant); Label; Arrow (click start, then end);
 * Round table; Theatre seats.
 *
 * GESTURES. Drag an item to move it (everything selected moves together);
 * drag empty floor to pan; Ctrl/⌘ + wheel or a pinch to zoom. Shift-click adds
 * to the selection. Keys: Delete, ⌘/Ctrl+Z / +Shift+Z, ⌘/Ctrl+D duplicate,
 * arrows nudge (Shift = 10), R rotates 15°, Esc drops the tool.
 *
 * Booths that a vendor holds (offered or booked) show SOLD or reserved, as the
 * public sees them, and cannot be deleted: the save says which vendor holds
 * them. Saving sends the whole plan with the version it was loaded at, so a
 * second tab cannot silently overwrite the first.
 *
 * RESERVED-SEATING EVENTS DRAW THEIR BOOTHS ON THE VENUE MAP (2026-11-22, the
 * owner: "merge the seating map of the event and the seating map of
 * vendors"). For them this tab shows the merged map and sends the organizer
 * to the venue map editor, where booths sit beside the seats in one drawing
 * of the hall. This editor stays for general-admission expos, which have no
 * seat map to draw on.
 * ─────────────────────────────────────────────────────────────────────────────
 */
// [key, full name (tooltip, panel title), icon, short name on the button].
const TOOLS = [
  ['select', 'Select', 'pointer', 'Select'],
  ['booth', 'Booth', 'grid', 'Booth'],
  ['row', 'Row of booths', 'layers', 'Row'],
  ['wall', 'Wall', 'pencil', 'Wall'],
  ['door', 'Door', 'door', 'Door'],
  ['area', 'Area', 'image', 'Area'],
  ['label', 'Label', 'tag', 'Label'],
  ['arrow', 'Arrow', 'arrow', 'Arrow'],
  ['table', 'Round table', 'users', 'Table'],
  ['seats', 'Theatre seats', 'masks', 'Seats'],
];
const SNAP = 5;
const snap = (v, on) => (on ? Math.round(v / SNAP) * SNAP : Math.round(v));
const ROTATABLE = new Set(['booth', 'area', 'label', 'door', 'seats']);

export default function FloorPlanEditor({ eventId, currency }) {
  const api = useApi(`/events/${eventId}/vendors/floor-plan`);
  if (api.error) return <ErrorNotice error={api.error} onRetry={api.reload} />;
  if (!api.data) return <Loading variant="card" label="Loading the floor plan" />;
  if (api.data.seatMap) return <OnTheVenueMap eventId={eventId} currency={currency} loaded={api.data} />;
  return <Editor key={api.data.version} eventId={eventId} currency={currency} loaded={api.data} onSaved={api.reload} />;
}

/** A reserved-seating event: its booths live on the venue map, with the seats. */
function OnTheVenueMap({ eventId, currency, loaded }) {
  const count = planBooths(loaded.plan).length;
  const linked = !!loaded.plan.onSeatMap;
  return (
    <div className="fx-stack">
      <section className="es-boothimport" aria-labelledby="fp-venue-title">
        <div className="fx-min0">
          <h3 id="fp-venue-title" className="es-boothimport__title">Booths are drawn on your venue map</h3>
          <p className="es-boothimport__text">
            {linked || count === 0
              ? 'This event has reserved seating, so its booths sit on the same map as the seats: one drawing of the hall for buyers and vendors. Add, number and move booths in the venue map, under Add to layout › Vendor booths.'
              : `Your ${count} booth${count === 1 ? ' is' : 's are'} still on a separate floor plan. Open the venue map and choose “Bring them onto this map” to place them beside the seats.`}
          </p>
        </div>
        <Link className="es-btn es-btn--primary" href={`/organizer/events/${eventId}/map`}>
          <NavIcon name="map" size={18} />Edit booths on the venue map
        </Link>
      </section>
      {count > 0 ? (
        <FloorPlanViewer
          floorPlan={{ plan: loaded.plan, booths: loaded.booths, boothTypes: loaded.boothTypes, venue: loaded.venue }}
          currency={currency}
          title={linked ? 'Booths on the venue map' : 'Separate floor plan'}
        />
      ) : (
        <p className="text-sm text-muted">No booths yet. Booth types you make under Booths can be given to booths on the map.</p>
      )}
    </div>
  );
}

function Editor({ eventId, currency, loaded, onSaved }) {
  const toast = useToast();
  const boothTypes = useMemo(() => loaded.boothTypes || [], [loaded.boothTypes]);
  const states = useMemo(() => loaded.booths || {}, [loaded.booths]);
  const [plan, setPlan] = useState(() => (loaded.plan.elements.length ? loaded.plan : starterPlan()));
  // A brand-new plan starts from the hall outline, which is not saved yet.
  const [dirty, setDirty] = useState(!loaded.plan.elements.length);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [tool, setTool] = useState('select');
  const [selected, setSelected] = useState([]);
  const [snapOn, setSnapOn] = useState(true);
  const [draftWall, setDraftWall] = useState(null);
  const [arrowStart, setArrowStart] = useState(null);
  const [rowForm, setRowForm] = useState({ count: 6, w: 60, h: 60, direction: 'right', prefix: 'A', boothTypeId: '' });
  const [saving, setSaving] = useState(false);
  const past = useRef([]);
  const future = useRef([]);

  const bounds = useMemo(() => ({ x: 0, y: 0, width: plan.width, height: plan.height }), [plan.width, plan.height]);
  const pz = usePanZoom(bounds, { wheelMode: 'pan', touch: 'direct', follow: 'always' });

  /** Change the plan; `record` false for the frames of a drag after its first. */
  const commit = useCallback((next, { record = true } = {}) => {
    setPlan((cur) => {
      const value = typeof next === 'function' ? next(cur) : next;
      if (record) { past.current.push(cur); if (past.current.length > 100) past.current.shift(); future.current = []; setCanRedo(false); }
      return value;
    });
    if (record) setCanUndo(true);
    setDirty(true);
  }, []);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    setPlan((cur) => { future.current.push(cur); return prev; });
    setCanUndo(past.current.length > 0);
    setCanRedo(true);
    setDirty(true);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    setPlan((cur) => { past.current.push(cur); return next; });
    setCanUndo(true);
    setCanRedo(future.current.length > 0);
    setDirty(true);
  }, []);

  const update = useCallback((ids, fn, opts) => commit((p) => ({ ...p, elements: p.elements.map((e) => (ids.includes(e.id) ? fn(e) : e)) }), opts), [commit]);
  const add = useCallback((els) => {
    commit((p) => ({ ...p, elements: [...p.elements, ...els] }));
    setSelected(els.map((e) => e.id));
  }, [commit]);

  const held = useCallback((id) => ['sold', 'held'].includes(states[id]?.status), [states]);
  const removeSelected = useCallback(() => {
    const blocked = selected.filter(held);
    if (blocked.length) {
      toast.error('A vendor holds that booth. Move it, or close their offer first.', { title: 'Cannot delete a held booth' });
      return;
    }
    commit((p) => ({ ...p, elements: p.elements.filter((e) => !selected.includes(e.id)) }));
    setSelected([]);
  }, [selected, held, commit, toast]);

  const duplicate = useCallback(() => {
    const copies = plan.elements.filter((e) => selected.includes(e.id))
      .map((e) => ({ ...moveBy(e, 20, 20), id: newId(e.kind), ...(e.kind === 'booth' ? { code: '' } : {}) }));
    if (copies.length) add(copies);
  }, [plan.elements, selected, add]);

  // ── Keys ──
  useEffect(() => {
    function onKey(ev) {
      const t = ev.target && ev.target.closest ? ev.target : null;
      // Text fields and dialogs keep every key.
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [aria-modal="true"]')) return;
      const mod = ev.ctrlKey || ev.metaKey;
      // Enter finishes a wall being drawn — even with the Wall button still
      // focused, whose own Enter would re-pick the tool and drop the corners.
      if (ev.key === 'Enter' && draftWall) { ev.preventDefault(); finishWall(false); return; }
      // Keys pressed elsewhere on the Vendors page are not the plan's
      // (2026-11-21): Backspace on a sidebar link must not delete a booth.
      if (t && t !== document.body && !t.closest('.es-fpe')) return;
      // Space and Enter press the focused button or switch.
      if ((ev.code === 'Space' || ev.key === 'Enter') && t?.closest('button, a, [role="switch"]')) return;
      // In the side panel the bare keys belong to its controls: Backspace on
      // "Available to book" used to delete the booth, R rotated it.
      if (!mod && ev.key !== 'Escape' && t?.closest('.es-fpe__panel')) return;
      if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
      if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicate(); return; }
      if (ev.key === 'Escape') { setTool('select'); setDraftWall(null); setArrowStart(null); setSelected([]); return; }
      if (!selected.length) return;
      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); removeSelected(); return; }
      const step = ev.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (d) { ev.preventDefault(); update(selected, (e) => moveBy(e, d[0], d[1])); return; }
      if (ev.key.toLowerCase() === 'r') update(selected, (e) => (ROTATABLE.has(e.kind) ? { ...e, r: ((e.r || 0) + 15) % 360 } : e));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ── Dragging items ──
  const drag = useRef(null);
  function startDrag(ev, e) {
    if (tool !== 'select') return;
    ev.stopPropagation();
    const ids = ev.shiftKey
      ? (selected.includes(e.id) ? selected.filter((x) => x !== e.id) : [...selected, e.id])
      : (selected.includes(e.id) ? selected : [e.id]);
    setSelected(ids);
    if (ev.shiftKey) return;
    const start = pz.toWorldPoint(ev.clientX, ev.clientY);
    drag.current = { start, ids, base: new Map(plan.elements.filter((x) => ids.includes(x.id)).map((x) => [x.id, x])), moved: false };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
  }
  function onDragMove(ev) {
    const g = drag.current;
    if (!g) return;
    const at = pz.toWorldPoint(ev.clientX, ev.clientY);
    let dx = at.x - g.start.x;
    let dy = at.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) < 2) return;
    // Snap the first item's anchor; the rest keep their offsets from it.
    const first = g.base.get(g.ids[0]);
    if (first && snapOn && first.x !== undefined) {
      dx = snap(first.x + dx, true) - first.x;
      dy = snap(first.y + dy, true) - first.y;
    }
    const record = !g.moved;
    g.moved = true;
    commit((p) => ({ ...p, elements: p.elements.map((e) => (g.base.has(e.id) ? moveBy(g.base.get(e.id), dx, dy) : e)) }), { record });
  }
  function onDragEnd() {
    window.removeEventListener('pointermove', onDragMove);
    drag.current = null;
  }

  // ── Placing with a tool ──
  function onCanvasClick(ev) {
    if (pz.wasDragged()) return;
    const raw = pz.toWorldPoint(ev.clientX, ev.clientY);
    const at = { x: snap(raw.x, snapOn), y: snap(raw.y, snapOn) };
    // A click on an item with Select was its selection (startDrag); it is not a click on the floor.
    if (tool === 'select' && ev.target.closest?.('.es-fpe__item')) return;
    // EVERY TOOL HANDS BACK TO SELECT once it has placed something
    // (2026-11-21), as the seating map's Draw walls does: what was just added
    // is selected, so the inspector beside it is already on it — a row's
    // codes to renumber, a booth's type, a wall's "Closed outline". The tool's
    // options are kept for the next time it is picked.
    switch (tool) {
      case 'select': setSelected([]); return;
      case 'booth': {
        const prefix = rowForm.prefix || '';
        add([makeElement('booth', at, { code: prefix ? `${prefix}${nextCode(plan.elements, prefix)}` : '', boothTypeId: rowForm.boothTypeId || null })]);
        setTool('select');
        return;
      }
      case 'row': {
        const prefix = rowForm.prefix || '';
        add(makeRow({
          at, count: Number(rowForm.count) || 1, w: Number(rowForm.w) || 60, h: Number(rowForm.h) || 60, direction: rowForm.direction,
          prefix, start: prefix ? nextCode(plan.elements, prefix) : 1, boothTypeId: rowForm.boothTypeId || null,
        }));
        setTool('select');
        return;
      }
      case 'wall': {
        if (!draftWall) { setDraftWall([[at.x, at.y]]); return; }
        const [fx, fy] = draftWall[0];
        if (draftWall.length > 2 && Math.hypot(at.x - fx, at.y - fy) < 14) { finishWall(true); return; }
        setDraftWall((pts) => [...pts, [at.x, at.y]]);
        return;
      }
      case 'arrow': {
        if (!arrowStart) { setArrowStart(at); return; }
        add([makeElement('arrow', at, { x1: arrowStart.x, y1: arrowStart.y, x2: at.x, y2: at.y })]);
        setArrowStart(null);
        setTool('select');
        return;
      }
      default:
        add([makeElement(tool, at)]);
        setTool('select');
    }
  }
  function finishWall(closed) {
    if (draftWall && draftWall.length >= 2) {
      add([{ id: newId('wall'), kind: 'wall', points: draftWall, closed }]);
      setTool('select');
    }
    setDraftWall(null);
  }

  async function save() {
    setSaving(true);
    try {
      await put(`/events/${eventId}/vendors/floor-plan`, { plan, version: loaded.version }, { noRedirect: true });
      toast.success('Floor plan saved.');
      setDirty(false);
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setSaving(false);
    }
  }

  const ordered = useMemo(() => paintOrder(plan.elements), [plan.elements]);
  const sel = plan.elements.filter((e) => selected.includes(e.id));
  const hintText = {
    booth: 'Click the floor to place a booth.',
    row: 'Click where the first booth of the row goes.',
    wall: draftWall ? 'Click the next corner. Click the first corner again to close the room.' : 'Click the first corner of the wall.',
    arrow: arrowStart ? 'Click where the arrow points to.' : 'Click where the arrow starts.',
    door: 'Click a wall to place a door.', area: 'Click to place an area — a stage, a bar, a restaurant.',
    label: 'Click to place a label.', table: 'Click to place a round table.', seats: 'Click where the stage is; the seats face it.',
  }[tool];

  const pickTool = (key) => { setTool(key); setDraftWall(null); setArrowStart(null); };
  const panelRef = useRef(null);
  const rootRef = useRef(null);
  const barRef = useRef(null);
  // The toolbar's real height, for the panel that sticks under it: one row
  // on a laptop, two on a narrower screen.
  useEffect(() => {
    const bar = barRef.current;
    const root = rootRef.current;
    if (!bar || !root || typeof ResizeObserver === 'undefined') return undefined;
    const publish = () => root.style.setProperty('--es-fpe-bar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  const toolMeta = TOOLS.find(([key]) => key === tool);

  return (
    <div className="es-fpe" ref={rootRef}>
      {/* The same toolbar buttons as the seating map (2026-11-21): the tools
          as one segmented control, then undo / redo, snap, zoom, and Save. */}
      <div ref={barRef} className="es-maptoolbar es-fpe__bar" role="toolbar" aria-label="Floor plan tools">
        <div role="group" aria-label="Tool" className="es-tseg es-fpe__tools">
          {TOOLS.map(([key, label, icon, short]) => (
            <button key={key} type="button" aria-pressed={tool === key} aria-label={label} title={label} onClick={() => pickTool(key)}>
              <NavIcon name={icon} size={17} /><span className="es-tbtn__text">{short}</span>
            </button>
          ))}
        </div>
        <div className="es-maptoolbar__group">
          <button type="button" className="es-tbtn es-tbtn--icon" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><NavIcon name="undo" size={17} /></button>
          <button type="button" className="es-tbtn es-tbtn--icon" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><NavIcon name="redo" size={17} /></button>
          <button type="button" className="es-tbtn es-tbtn--icon" aria-pressed={snapOn} aria-label="Snap to grid" title="Snap to grid" onClick={() => setSnapOn((v) => !v)}>
            <NavIcon name="magnet" size={17} />
          </button>
        </div>
        {/* Saved is a STATE, not a disabled button: a pale coral "Saved" read
            as an error. The coral button appears only when there is work to
            keep — the seating map's header does the same. */}
        <div className="es-maptoolbar__group es-fpe__save">
          {dirty || saving ? (
            <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={save} disabled={saving}>
              <NavIcon name="tick" size={16} />{saving ? 'Saving…' : 'Save floor plan'}
            </button>
          ) : (
            <span className="es-savedchip" role="status" title="All changes saved"><NavIcon name="tick" size={14} />Saved</span>
          )}
        </div>
      </div>

      <div className="es-fpe__body">
        <div
          className="es-fpe__canvas" data-tool={tool}
          // Pressing the plan hands the keyboard back to it (the panel keeps
          // bare keys for its own controls, and the SVG takes no focus).
          onPointerDownCapture={() => {
            const el = document.activeElement;
            if (el instanceof HTMLElement && el.closest('.es-fpe__panel')) el.blur();
          }}
        >
          <svg
            ref={pz.svgRef}
            viewBox={`${pz.view.x} ${pz.view.y} ${pz.view.width} ${pz.view.height}`}
            className="es-fpe__svg"
            style={{ touchAction: pz.touchAction }}
            role="application"
            aria-label="Floor plan editor"
            {...pz.handlers}
            onClick={onCanvasClick}
            onDoubleClick={() => { if (draftWall) finishWall(false); }}
          >
            <FloorPlanDefs />
            <defs>
              <pattern id="es-fpe-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M20 0 L0 0 0 20" fill="none" stroke="#e9e9ee" strokeWidth="1" />
              </pattern>
            </defs>
            <rect x={0} y={0} width={plan.width} height={plan.height} fill="#ffffff" />
            <rect x={0} y={0} width={plan.width} height={plan.height} fill="url(#es-fpe-grid)" stroke="#d6d6dd" />
            {ordered.map((e) => (
              <g key={e.id} onPointerDown={(ev) => startDrag(ev, e)} className="es-fpe__item" data-selected={selected.includes(e.id) || undefined}>
                {e.kind === 'booth'
                  ? <Booth e={e} state={states[e.id]} boothTypes={boothTypes} selected={selected.includes(e.id)} />
                  : <SelectableDecor e={e} selected={selected.includes(e.id)} />}
              </g>
            ))}
            {draftWall && (
              <polyline points={draftWall.map((p) => p.join(',')).join(' ')} fill="none" stroke={INK.wall} strokeWidth={2} strokeDasharray="6 4" style={{ vectorEffect: 'non-scaling-stroke' }} />
            )}
            {arrowStart && <circle cx={arrowStart.x} cy={arrowStart.y} r={4} fill={INK.wall} />}
          </svg>
          {hintText && (
            <p className="es-fpe__hint" role="status">
              {hintText}
              {/* Here as well as in the panel: on a tablet the panel is below
                  the canvas, and a tap cannot double-click or press Enter. */}
              {tool === 'wall' && draftWall?.length >= 2 && (
                <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => finishWall(false)}>Finish wall</button>
              )}
            </p>
          )}
          {/* The zoom pill on the canvas's corner, as on the seating map. */}
          <div className="es-maptoolbar__group es-maptoolbar__zoom" role="group" aria-label="Zoom">
            <button type="button" className="es-tbtn es-tbtn--icon" onClick={pz.zoomOut} aria-label="Zoom out" title="Zoom out"><NavIcon name="minus" size={17} /></button>
            <button type="button" className="es-tbtn es-tbtn--icon" onClick={pz.zoomIn} aria-label="Zoom in" title="Zoom in"><NavIcon name="plus" size={17} /></button>
            <button type="button" className="es-tbtn" onClick={pz.fit} aria-label="Fit the hall in view" title="Fit the hall in view">Fit</button>
          </div>
        </div>

        {/* Below `lg` the panel is under the canvas: say what it holds, with a
            way down to it (`.es-fpe__jump` is hidden where they sit side by side). */}
        {(tool !== 'select' || sel.length > 0) && (
          <div className="es-mapjump es-fpe__jump">
            <span className="fx-min0 fx-truncate">
              {tool !== 'select' ? `${toolMeta[1]} — options below` : sel.length === 1 ? 'Item selected' : `${sel.length} selected`}
            </span>
            <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {tool !== 'select' ? 'Options' : 'Edit details'} <NavIcon name="arrowDown" size={16} />
            </button>
          </div>
        )}

        {/* One inspector at a time, in the same order of precedence as the
            seating map: the tool being used, then the selection, then the hall. */}
        <div ref={panelRef} className="es-fpe__panel">
          {tool !== 'select' ? (
            <ToolPanel
              tool={tool} label={toolMeta[1]} icon={toolMeta[2]} hint={hintText}
              rowForm={rowForm} setRowForm={setRowForm} boothTypes={boothTypes}
              draftWall={draftWall} onFinishWall={() => finishWall(false)} onDone={() => pickTool('select')}
            />
          ) : sel.length === 1 ? (
            <ItemPanel
              key={sel[0].id} e={sel[0]} update={(fn) => update([sel[0].id], fn)} boothTypes={boothTypes} state={states[sel[0].id]}
              onDelete={removeSelected} onDuplicate={duplicate} rotatable={ROTATABLE.has(sel[0].kind)}
            />
          ) : sel.length > 1 ? (
            <MultiPanel items={sel} update={(fn) => update(selected, fn)} boothTypes={boothTypes} onDelete={removeSelected} onDuplicate={duplicate} isHeld={held} />
          ) : (
            <PlanPanel
              plan={plan} commit={commit} boothTypes={boothTypes} currency={currency} states={states}
              dirty={dirty} saving={saving} onSave={save} onPickTool={pickTool} onSelect={setSelected}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** A non-booth item with a dashed box when selected. */
function SelectableDecor({ e, selected }) {
  return (
    <>
      <Decor e={e} />
      {selected && <SelectionBox e={e} />}
    </>
  );
}
function SelectionBox({ e }) {
  let x; let y; let w; let h;
  if (e.kind === 'wall') {
    const xs = e.points.map((p) => p[0]); const ys = e.points.map((p) => p[1]);
    [x, y, w, h] = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  } else if (e.kind === 'arrow') {
    [x, y, w, h] = [Math.min(e.x1, e.x2), Math.min(e.y1, e.y2), Math.abs(e.x2 - e.x1), Math.abs(e.y2 - e.y1)];
  } else if (e.kind === 'area') {
    [x, y, w, h] = [e.x, e.y, e.w, e.h];
  } else {
    const s = e.kind === 'seats' ? e.radius + e.rows * 17 : e.kind === 'label' ? e.size * Math.max(2, e.text.length) * 0.3 : (e.size || 20) * 1.1;
    [x, y, w, h] = [e.x - s, e.y - s, s * 2, s * 2];
  }
  return <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} fill="none" stroke={INK.selected} strokeDasharray="5 3" strokeWidth={1.5} style={{ vectorEffect: 'non-scaling-stroke' }} pointerEvents="none" />;
}
