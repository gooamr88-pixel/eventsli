'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SHAPES } from '../../../../components/seating/seatingGeometry';
import { ZONES, ZONE_KINDS } from '../../../../components/seating/venueZones';
import { SHAPE_NAMES } from './shapeNames';
import { keyOf } from './useMapDraft';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The canvas toolbar.
 *
 * Three groups, in the order a hand reaches for them: what to add and how to
 * take it back (Add / Undo / Redo), what the pointer does (Select / Move /
 * Snap), and where you are looking (zoom).
 *
 * THE SELECT / MOVE TOGGLE IS THE POINT OF THIS FILE. Before it, the only ways
 * to move around this canvas were gestures nobody discovers: hold space and
 * drag, or press the middle mouse button. A laptop trackpad has neither in easy
 * reach, so on the machines most organizers actually use, reaching a part of the
 * map that was off-screen meant holding a key with one hand and dragging with
 * the other. A visible tool toggle is what every layout tool converged on, and
 * it removes nothing — space-drag, middle-drag, right-drag, wheel and touch all
 * still pan from either tool. It is a fourth way in, not a replacement.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EditorToolbar({
  tables, zones, selection, tool, onToolChange, snapToGrid, onSnapChange,
  canUndo, canRedo, onUndo, onRedo, onAdd, zoom,
}) {
  return (
    <div className="fx-row fx-row--between flex-wrap gap-2 rounded-(--es-radius-lg) border border-border-base bg-surface px-3 py-2">
      <div className="fx-row flex-wrap gap-2">
        <button type="button" onClick={onAdd} className="es-btn es-btn--primary es-btn--sm">
          Add element
        </button>
        <ToolbarButton onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</ToolbarButton>
        <ToolbarButton onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">Redo</ToolbarButton>
        <SelectMenu tables={tables} zones={zones} selection={selection} />
      </div>

      <div className="fx-row flex-wrap items-center gap-2">
        <div role="group" aria-label="Canvas tool" className="fx-row gap-0 overflow-hidden rounded-(--es-radius-md) border border-border-strong">
          <ToolTab
            active={tool === 'select'} onClick={() => onToolChange('select')}
            title="Select tool (V) — drag the floor to box-select"
          >
            Select
          </ToolTab>
          <ToolTab
            active={tool === 'hand'} onClick={() => onToolChange('hand')}
            title="Move tool (H) — drag anywhere to move around the map"
          >
            Move
          </ToolTab>
        </div>

        <ToolbarButton
          onClick={() => onSnapChange(!snapToGrid)}
          pressed={snapToGrid}
          title="Line elements up to a grid as you drag them"
        >
          Snap to grid
        </ToolbarButton>

        {/* The zoom controls are captioned with `label`, not left to their own
            text. A button whose entire content is the glyph "−" is announced as
            "minus" — true, and useless to anyone who cannot see which group it
            is sitting in. `title` alone does not fix it either: it is only used
            as a name when there is no content, and these have content. */}
        <div className="fx-row items-center gap-1 border-l border-border-base pl-2">
          <ToolbarButton onClick={zoom.out} label="Zoom out">−</ToolbarButton>
          <span className="min-w-12 text-center text-xs tabular-nums text-muted">{Math.round(zoom.scale * 100)}%</span>
          <ToolbarButton onClick={zoom.in} label="Zoom in">+</ToolbarButton>
          <ToolbarButton onClick={zoom.fit} label="Frame the whole room">Fit</ToolbarButton>
        </div>
      </div>
    </div>
  );
}

/**
 * "Select all", narrowed.
 *
 * On a two-hundred-table room, "select everything" is rarely the thing wanted —
 * "every round table" or "every 10-seater" is, because that is the unit an
 * organizer thinks in when they want to move a section or renumber a band. Both
 * filters apply together, and the button says how many it will take BEFORE it
 * takes them, so a filter that matches nothing is visible as a disabled button
 * rather than as a click that appears to do nothing.
 */
function SelectMenu({ tables, zones, selection }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('any');
  const [capacity, setCapacity] = useState('any');
  const ref = useRef(null);

  // Closing on an outside press, not an outside click: a click that begins
  // inside the menu and ends outside it is still a click on the document, and
  // closing on it would eat the drag of a select.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const capacities = useMemo(
    () => [...new Set(tables.map((t) => Number(t.seatCount)).filter(Boolean))].sort((a, b) => a - b),
    [tables],
  );

  const zoneTypeChosen = type === 'zones' || Object.prototype.hasOwnProperty.call(ZONES, type);

  const matched = useMemo(() => {
    const capOk = (t) => capacity === 'any' || Number(t.seatCount) === Number(capacity);
    const wantTables = !zoneTypeChosen;
    const wantZones = type === 'any' || zoneTypeChosen;

    return {
      tables: wantTables
        ? tables.filter((t) => (type === 'any' || type === 'tables' || t.shape === type) && capOk(t)).map(keyOf)
        : [],
      // A seat-capacity filter cannot match furniture, so choosing one takes
      // zones OUT of the result rather than selecting every zone alongside the
      // 10-seaters — which would make "select the 10-seaters" also grab the bar.
      zones: wantZones && capacity === 'any'
        ? zones.filter((z) => type === 'any' || type === 'zones' || z.kind === type).map((z) => z.id)
        : [],
    };
  }, [tables, zones, type, capacity, zoneTypeChosen]);

  const count = matched.tables.length + matched.zones.length;
  const total = tables.length + zones.length;

  if (selection.count > 0) {
    return (
      <button
        type="button"
        onClick={selection.clear}
        className="rounded-(--es-radius-md) border border-accent bg-accent/10 px-3 py-1.5 text-sm text-accent"
      >
        {selection.count} selected · Deselect
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <ToolbarButton onClick={() => setOpen((v) => !v)} disabled={total === 0} expanded={open}>
        Select all ▾
      </ToolbarButton>

      {open && (
        <div className="fx-stack fx-stack--sm absolute left-0 top-full z-20 mt-1.5 w-64 rounded-(--es-radius-md) border border-border-base bg-surface p-3 shadow-lg">
          <button
            type="button"
            onClick={() => { selection.replace(tables.map(keyOf), zones.map((z) => z.id)); setOpen(false); }}
            className="fx-row fx-row--between w-full rounded-(--es-radius-sm) px-2 py-1.5 text-left text-sm text-ink hover:bg-bg-sunken"
          >
            <span>Everything</span>
            <span className="text-xs text-subtle">{total}</span>
          </button>

          <div className="fx-stack fx-stack--sm gap-1.5 border-t border-border-base pt-2">
            <label className="text-xs text-subtle" htmlFor="es-select-type">Type</label>
            <select
              id="es-select-type" className="es-input" value={type}
              onChange={(e) => {
                setType(e.target.value);
                if (e.target.value === 'zones' || Object.prototype.hasOwnProperty.call(ZONES, e.target.value)) setCapacity('any');
              }}
            >
              <option value="any">Anything</option>
              <option value="tables">All tables</option>
              <option value="zones">All venue zones</option>
              <optgroup label="Table shapes">
                {SHAPES.map((s) => <option key={s} value={s}>{SHAPE_NAMES[s] || s}</option>)}
              </optgroup>
              <optgroup label="Venue zones">
                {ZONE_KINDS.map((k) => <option key={k} value={k}>{ZONES[k].label}</option>)}
              </optgroup>
            </select>

            <label className="text-xs text-subtle" htmlFor="es-select-cap">Seats per table</label>
            <select
              id="es-select-cap" className="es-input" value={capacity} disabled={zoneTypeChosen}
              onChange={(e) => setCapacity(e.target.value)}
            >
              <option value="any">Any number</option>
              {capacities.map((c) => <option key={c} value={c}>{c} seats</option>)}
            </select>

            <button
              type="button"
              disabled={count === 0}
              onClick={() => { selection.replace(matched.tables, matched.zones); setOpen(false); }}
              className="es-btn es-btn--secondary es-btn--sm mt-1"
            >
              Select {count} {count === 1 ? 'element' : 'elements'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({ onClick, disabled, title, label, pressed, expanded, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      {...(label ? { 'aria-label': label } : {})}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      className={`rounded-(--es-radius-md) border px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${
        pressed
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border-strong text-ink hover:bg-bg-sunken'
      }`}
    >
      {children}
    </button>
  );
}

function ToolTab({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`px-3 py-1.5 text-sm transition-colors ${
        active ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-bg-sunken'
      }`}
    >
      {children}
    </button>
  );
}
