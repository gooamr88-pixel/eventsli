'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { put } from '../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { usePanZoom } from '../../../../components/seating/usePanZoom';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { Booth, Decor, FloorPlanDefs, paintOrder } from '../../../../components/vendors/floorPlan/FloorPlanShapes';
import {
  AREA_COLORS, INK, makeElement, makeRow, moveBy, nextCode, newId, starterPlan, typeColor,
} from '../../../../components/vendors/floorPlan/floorPlanModel';

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
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TOOLS = [
  ['select', 'Select', 'pointer'],
  ['booth', 'Booth', 'grid'],
  ['row', 'Row of booths', 'layers'],
  ['wall', 'Wall', 'pencil'],
  ['door', 'Door', 'door'],
  ['area', 'Area', 'image'],
  ['label', 'Label', 'tag'],
  ['arrow', 'Arrow', 'arrow'],
  ['table', 'Round table', 'users'],
  ['seats', 'Theatre seats', 'masks'],
];
const SNAP = 5;
const snap = (v, on) => (on ? Math.round(v / SNAP) * SNAP : Math.round(v));
const ROTATABLE = new Set(['booth', 'area', 'label', 'door', 'seats']);

export default function FloorPlanEditor({ eventId, currency }) {
  const api = useApi(`/events/${eventId}/vendors/floor-plan`);
  if (api.error) return <ErrorNotice error={api.error} onRetry={api.reload} />;
  if (!api.data) return <Loading variant="card" label="Loading the floor plan" />;
  return <Editor key={api.data.version} eventId={eventId} currency={currency} loaded={api.data} onSaved={api.reload} />;
}

function Editor({ eventId, currency, loaded, onSaved }) {
  const toast = useToast();
  const boothTypes = useMemo(() => loaded.boothTypes || [], [loaded.boothTypes]);
  const states = useMemo(() => loaded.booths || {}, [loaded.booths]);
  const [plan, setPlan] = useState(() => (loaded.plan.elements.length ? loaded.plan : starterPlan()));
  // A brand-new plan starts from the hall outline, which is not saved yet.
  const [dirty, setDirty] = useState(!loaded.plan.elements.length);
  const [canUndo, setCanUndo] = useState(false);
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
      if (record) { past.current.push(cur); if (past.current.length > 100) past.current.shift(); future.current = []; }
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
    setDirty(true);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    setPlan((cur) => { past.current.push(cur); return next; });
    setCanUndo(true);
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
      const t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
      if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicate(); return; }
      if (ev.key === 'Escape') { setTool('select'); setDraftWall(null); setArrowStart(null); setSelected([]); return; }
      if (ev.key === 'Enter' && draftWall) { finishWall(false); return; }
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
    switch (tool) {
      case 'select': setSelected([]); return;
      case 'booth': {
        const prefix = rowForm.prefix || '';
        add([makeElement('booth', at, { code: prefix ? `${prefix}${nextCode(plan.elements, prefix)}` : '', boothTypeId: rowForm.boothTypeId || null })]);
        return;
      }
      case 'row': {
        const prefix = rowForm.prefix || '';
        add(makeRow({
          at, count: rowForm.count, w: Number(rowForm.w) || 60, h: Number(rowForm.h) || 60, direction: rowForm.direction,
          prefix, start: prefix ? nextCode(plan.elements, prefix) : 1, boothTypeId: rowForm.boothTypeId || null,
        }));
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
        return;
      }
      default:
        add([makeElement(tool, at)]);
        setTool('select');
    }
  }
  function finishWall(closed) {
    if (draftWall && draftWall.length >= 2) add([{ id: newId('wall'), kind: 'wall', points: draftWall, closed }]);
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
  const boothCount = plan.elements.filter((e) => e.kind === 'booth').length;
  const hintText = {
    booth: 'Click the floor to place a booth.',
    row: 'Click where the first booth of the row goes.',
    wall: draftWall ? 'Click the next corner. Click the first corner to close the room, or press Finish.' : 'Click the first corner of the wall.',
    arrow: arrowStart ? 'Click where the arrow points to.' : 'Click where the arrow starts.',
    door: 'Click a wall to place a door.', area: 'Click to place an area — a stage, a bar, a restaurant.',
    label: 'Click to place a label.', table: 'Click to place a round table.', seats: 'Click where the stage is; the seats face it.',
  }[tool];

  return (
    <div className="es-fpe">
      <div className="es-fpe__bar" role="toolbar" aria-label="Floor plan tools">
        <div className="es-fpe__tools">
          {TOOLS.map(([key, label, icon]) => (
            <button key={key} type="button" className="es-fpe__tool" aria-pressed={tool === key} title={label}
              onClick={() => { setTool(key); setDraftWall(null); setArrowStart(null); }}>
              <NavIcon name={icon} size={18} /><span>{label}</span>
            </button>
          ))}
        </div>
        <div className="es-fpe__actions">
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={undo} disabled={!canUndo} aria-label="Undo"><NavIcon name="undo" size={16} /></button>
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={pz.zoomOut} aria-label="Zoom out">−</button>
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={pz.zoomIn} aria-label="Zoom in"><NavIcon name="plus" size={16} /></button>
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={pz.fit}>Fit</button>
          <label className="fx-row items-center gap-1 text-sm"><input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />Snap</label>
          <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save floor plan' : 'Saved'}
          </button>
        </div>
      </div>

      {(tool === 'row' || tool === 'booth') && (
        <div className="es-fpe__rowform">
          {tool === 'row' && (
            <>
              <label>Booths<input className="es-input es-input--sm" type="number" min={1} max={60} value={rowForm.count} onChange={(e) => setRowForm((f) => ({ ...f, count: e.target.value }))} /></label>
              <label>Direction
                <select className="es-input es-input--sm" value={rowForm.direction} onChange={(e) => setRowForm((f) => ({ ...f, direction: e.target.value }))}>
                  <option value="right">Across</option><option value="down">Down</option>
                </select>
              </label>
            </>
          )}
          <label>Width<input className="es-input es-input--sm" type="number" min={8} max={400} value={rowForm.w} onChange={(e) => setRowForm((f) => ({ ...f, w: e.target.value }))} /></label>
          <label>Depth<input className="es-input es-input--sm" type="number" min={8} max={400} value={rowForm.h} onChange={(e) => setRowForm((f) => ({ ...f, h: e.target.value }))} /></label>
          <label>Code prefix<input className="es-input es-input--sm" maxLength={6} value={rowForm.prefix} onChange={(e) => setRowForm((f) => ({ ...f, prefix: e.target.value }))} placeholder="DB" /></label>
          <label>Booth type
            <select className="es-input es-input--sm" value={rowForm.boothTypeId} onChange={(e) => setRowForm((f) => ({ ...f, boothTypeId: e.target.value }))}>
              <option value="">None yet</option>
              {boothTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <span className="es-fpe__presets" aria-label="Size presets">
            {[[60, 60, 'Square'], [90, 60, 'Wide'], [45, 18, 'Corridor table'], [120, 60, 'Double']].map(([w, h, name]) => (
              <button key={name} type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setRowForm((f) => ({ ...f, w, h }))}>{name}</button>
            ))}
          </span>
        </div>
      )}

      <div className="es-fpe__body">
        <div className="es-fpe__canvas" data-tool={tool}>
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
              {tool === 'wall' && draftWall?.length >= 2 && <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => finishWall(false)}>Finish</button>}
            </p>
          )}
        </div>

        <aside className="es-fpe__panel" aria-label="Properties">
          {sel.length === 0 && <PlanPanel plan={plan} commit={commit} boothCount={boothCount} boothTypes={boothTypes} currency={currency} states={states} />}
          {sel.length === 1 && <ItemPanel e={sel[0]} update={(fn) => update([sel[0].id], fn)} boothTypes={boothTypes} state={states[sel[0].id]} onDelete={removeSelected} onDuplicate={duplicate} />}
          {sel.length > 1 && <MultiPanel items={sel} update={(fn) => update(selected, fn)} boothTypes={boothTypes} onDelete={removeSelected} onDuplicate={duplicate} />}
        </aside>
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

// ── Panels ────────────────────────────────────────────────────────────────
function Num({ label, value, onChange, min, max, step = 1 }) {
  return (
    <label className="es-fpe__field">{label}
      <input className="es-input es-input--sm" type="number" min={min} max={max} step={step} value={Math.round(value * 10) / 10}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }} />
    </label>
  );
}
function Text({ label, value, onChange, max = 40, placeholder }) {
  return (
    <label className="es-fpe__field">{label}
      <input className="es-input es-input--sm" maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function Colors({ label, value, palette, onChange }) {
  return (
    <div className="es-fpe__field">{label}
      <span className="es-fpe__colors">
        {palette.map((c) => (
          <button key={c} type="button" className="es-fpe__color" style={{ background: c }} aria-label={c} aria-pressed={value === c} onClick={() => onChange(c)} />
        ))}
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />
      </span>
    </div>
  );
}

function PlanPanel({ plan, commit, boothCount, boothTypes, currency, states }) {
  const sold = Object.values(states).filter((s) => s.status === 'sold').length;
  return (
    <div className="fx-stack fx-stack--sm">
      <p className="es-fpe__panel-title">Floor plan</p>
      <p className="text-sm text-muted">{boothCount} booths{sold ? ` · ${sold} sold` : ''}. Click an item to edit it, or pick a tool above.</p>
      <div className="es-fpe__grid2">
        <Num label="Hall width" value={plan.width} min={200} max={20000} onChange={(n) => commit((p) => ({ ...p, width: n }))} />
        <Num label="Hall depth" value={plan.height} min={200} max={20000} onChange={(n) => commit((p) => ({ ...p, height: n }))} />
      </div>
      <p className="es-fpe__panel-title mt-2">Booth colours</p>
      {boothTypes.length === 0
        ? <p className="text-sm text-muted">Add booth types in the Booths tab; free booths are drawn in their type’s colour.</p>
        : (
          <ul className="es-fpe__types">
            {boothTypes.map((t) => (
              <li key={t.id}><span className="es-fp__swatch" style={{ background: typeColor(boothTypes, t.id) }} />{t.name}<span className="text-subtle"> · {t.priceCents ? formatMoney(t.priceCents, currency) : 'Free'}</span></li>
            ))}
          </ul>
        )}
      <p className="text-xs text-subtle">Tip: draw the room with Wall, add rows with Row of booths, then label the stage, entrances and walkways.</p>
    </div>
  );
}

function ItemPanel({ e, update, boothTypes, state, onDelete, onDuplicate }) {
  const set = (patch) => update((x) => ({ ...x, ...patch }));
  const heldBy = state?.vendor?.name;
  return (
    <div className="fx-stack fx-stack--sm">
      <p className="es-fpe__panel-title">{{ booth: 'Booth', wall: 'Wall', door: 'Door', area: 'Area', label: 'Label', arrow: 'Arrow', table: 'Round table', seats: 'Theatre seats' }[e.kind]}</p>
      {e.kind === 'booth' && (
        <>
          {state && state.status !== 'available' && (
            <p className="text-sm">{state.status === 'sold' ? 'Booked' : state.status === 'held' ? 'Offered' : 'Unavailable'}{heldBy ? ` — ${heldBy}` : ''}</p>
          )}
          <Text label="Code" value={e.code} max={12} placeholder="DB1" onChange={(v) => set({ code: v })} />
          <label className="es-fpe__field">Booth type
            <select className="es-input es-input--sm" value={e.boothTypeId || ''} onChange={(ev) => set({ boothTypeId: ev.target.value || null })}>
              <option value="">None</option>
              {boothTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div className="es-fpe__grid2">
            <Num label="Width" value={e.w} min={8} max={2000} onChange={(n) => set({ w: n })} />
            <Num label="Depth" value={e.h} min={8} max={2000} onChange={(n) => set({ h: n })} />
            <Num label="Rotation°" value={e.r} min={-360} max={360} step={15} onChange={(n) => set({ r: n })} />
          </div>
          <label className="fx-row items-center gap-2 text-sm">
            <input type="checkbox" checked={e.blocked} disabled={!!state && ['sold', 'held'].includes(state.status)} onChange={(ev) => set({ blocked: ev.target.checked })} />
            Unavailable (not for sale)
          </label>
        </>
      )}
      {e.kind === 'area' && (
        <>
          <Text label="Title" value={e.text} placeholder="stage" onChange={(v) => set({ text: v })} />
          <Text label="Subtitle" value={e.sub} placeholder="Scene" onChange={(v) => set({ sub: v })} />
          <div className="es-fpe__grid2">
            <Num label="Width" value={e.w} min={10} max={5000} onChange={(n) => set({ w: n })} />
            <Num label="Depth" value={e.h} min={10} max={5000} onChange={(n) => set({ h: n })} />
            <Num label="Rotation°" value={e.r} min={-360} max={360} step={15} onChange={(n) => set({ r: n })} />
          </div>
          <Colors label="Colour" value={e.fill} palette={AREA_COLORS} onChange={(c) => set({ fill: c })} />
        </>
      )}
      {e.kind === 'label' && (
        <>
          <Text label="Text" value={e.text} max={60} onChange={(v) => set({ text: v })} />
          <div className="es-fpe__grid2">
            <Num label="Size" value={e.size} min={8} max={160} onChange={(n) => set({ size: n })} />
            <Num label="Rotation°" value={e.r} min={-360} max={360} step={15} onChange={(n) => set({ r: n })} />
          </div>
          <Colors label="Colour" value={e.color} palette={[INK.label, INK.wall, '#111018', '#16a34a', '#d61f2c']} onChange={(c) => set({ color: c })} />
        </>
      )}
      {e.kind === 'door' && (
        <>
          <div className="es-fpe__grid2">
            <Num label="Width" value={e.size} min={10} max={400} onChange={(n) => set({ size: n })} />
            <Num label="Rotation°" value={e.r} min={-360} max={360} step={90} onChange={(n) => set({ r: n })} />
          </div>
          <label className="fx-row items-center gap-2 text-sm"><input type="checkbox" checked={e.double} onChange={(ev) => set({ double: ev.target.checked })} />Double door</label>
        </>
      )}
      {e.kind === 'table' && (
        <div className="es-fpe__grid2">
          <Num label="Size" value={e.size} min={10} max={200} onChange={(n) => set({ size: n })} />
          <Num label="Chairs" value={e.seats} min={0} max={16} onChange={(n) => set({ seats: Math.round(n) })} />
        </div>
      )}
      {e.kind === 'seats' && (
        <div className="es-fpe__grid2">
          <Num label="Rows" value={e.rows} min={1} max={20} onChange={(n) => set({ rows: Math.round(n) })} />
          <Num label="Distance" value={e.radius} min={20} max={3000} onChange={(n) => set({ radius: n })} />
          <Num label="Arc width°" value={e.spread} min={10} max={300} step={10} onChange={(n) => set({ spread: n })} />
          <Num label="Facing°" value={e.r} min={-360} max={360} step={15} onChange={(n) => set({ r: n })} />
        </div>
      )}
      {e.kind === 'arrow' && (
        <Colors label="Colour" value={e.color} palette={[INK.wall, INK.label, '#111018', '#16a34a']} onChange={(c) => set({ color: c })} />
      )}
      {e.kind === 'wall' && (
        <label className="fx-row items-center gap-2 text-sm"><input type="checkbox" checked={e.closed} onChange={(ev) => set({ closed: ev.target.checked })} />Closed outline</label>
      )}
      <div className="fx-row gap-1 mt-2">
        <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={onDuplicate}><NavIcon name="copy" size={16} />Duplicate</button>
        <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={onDelete}><NavIcon name="trash" size={16} />Delete</button>
      </div>
    </div>
  );
}

function MultiPanel({ items, update, boothTypes, onDelete, onDuplicate }) {
  const booths = items.filter((e) => e.kind === 'booth');
  const [prefix, setPrefix] = useState('');
  const [start, setStart] = useState(1);
  function renumber() {
    // In reading order: top to bottom, then left to right.
    const order = [...booths].sort((a, b) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x)).map((b) => b.id);
    update((e) => (e.kind === 'booth' ? { ...e, code: `${prefix}${Number(start) + order.indexOf(e.id)}` } : e));
  }
  return (
    <div className="fx-stack fx-stack--sm">
      <p className="es-fpe__panel-title">{items.length} items selected</p>
      {booths.length > 0 && (
        <>
          <label className="es-fpe__field">Booth type for all {booths.length} booths
            <select className="es-input es-input--sm" defaultValue="" onChange={(ev) => update((e) => (e.kind === 'booth' ? { ...e, boothTypeId: ev.target.value || null } : e))}>
              <option value="" disabled>Choose…</option>
              <option value="">None</option>
              {boothTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div className="es-fpe__grid2">
            <Text label="Code prefix" value={prefix} max={6} placeholder="A" onChange={setPrefix} />
            <Num label="Start at" value={start} min={0} max={9999} onChange={setStart} />
          </div>
          <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={renumber}>Renumber booths</button>
          <div className="fx-row gap-1">
            <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => update((e) => (e.kind === 'booth' ? { ...e, blocked: true } : e))}>Mark unavailable</button>
            <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => update((e) => (e.kind === 'booth' ? { ...e, blocked: false } : e))}>Mark available</button>
          </div>
        </>
      )}
      <div className="fx-row gap-1 mt-2">
        <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={onDuplicate}><NavIcon name="copy" size={16} />Duplicate</button>
        <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={onDelete}><NavIcon name="trash" size={16} />Delete</button>
      </div>
    </div>
  );
}
