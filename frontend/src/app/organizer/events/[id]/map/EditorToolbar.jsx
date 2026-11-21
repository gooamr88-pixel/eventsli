'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import NavIcon from '../../../../components/shell/NavIcon';
import { SHAPES } from '../../../../components/seating/seatingGeometry';
import { ZONES, ZONE_KINDS } from '../../../../components/seating/venueZones';
import { SHAPE_NAMES } from './shapeNames';
import { keyOf } from './useMapDraft';
import { AddMenu } from './BuildPanel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The canvas toolbar.
 *
 * Four groups, in the order a hand reaches for them: add and take back (Add /
 * Undo / Redo), what the pointer does (Select / Pick several / Move), how
 * things line up and get chosen (Snap, Select all), and where you are looking
 * (zoom).
 *
 * ICONS WITH NAMES (2026-11-21). It was ten text buttons that wrapped onto two
 * or three lines in the middle column, styled with their own Tailwind instead
 * of the product's buttons, plus "Add element" and "Design with AI" — both
 * already offered by Add to layout. Now every control is one compact button
 * with an icon, a short word where there is room, and its full name as the
 * tooltip and the accessible name. Add is a menu of the same grouped list, and
 * only appears below the width where Add to layout is its own column.
 *
 * THE SELECT / MOVE TOGGLE stays the point of this file. Before it, the only
 * ways to move around this canvas were gestures nobody discovers: hold space
 * and drag, or press the middle mouse button. A visible tool toggle removes
 * nothing — space-drag, middle-drag, right-drag, wheel and touch all still pan
 * from either tool. It is a fourth way in, not a replacement.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EditorToolbar({
  tables, zones, selection, tool, onToolChange, snapToGrid, onSnapChange,
  canUndo, canRedo, onUndo, onRedo, onAdd, zoom, onFullscreen = null, ai = false,
}) {
  return (
    <div className="es-maptoolbar">
      <div className="es-maptoolbar__group">
        {/* Only below the width where "Add to layout" is its own column. */}
        <AddMenu onAdd={onAdd} ai={ai} />
        <ToolbarButton onClick={onUndo} disabled={!canUndo} label="Undo" title="Undo (Ctrl+Z)" icon="undo" />
        <ToolbarButton onClick={onRedo} disabled={!canRedo} label="Redo" title="Redo (Ctrl+Shift+Z)" icon="redo" />
      </div>

      <div role="group" aria-label="Canvas tool" className="es-tseg">
        <ToolTab active={tool === 'select'} onClick={() => onToolChange('select')} icon="pointer" title="Select (V) — click a table, or drag the floor to box-select">
          Select
        </ToolTab>
        {/* 2026-11-19: choosing several tables needed Ctrl or Shift, which a
            tablet does not have. With this on, every tap adds or removes. */}
        <ToolTab active={tool === 'multi'} onClick={() => onToolChange('multi')} icon="multi" title="Pick several (M) — each tap adds a table to the selection or takes it out">
          Pick several
        </ToolTab>
        <ToolTab active={tool === 'hand'} onClick={() => onToolChange('hand')} icon="hand" title="Pan (H) — drag to look around the map. To move a table, use Select and drag it.">
          Pan
        </ToolTab>
      </div>

      <div className="es-maptoolbar__group">
        <ToolbarButton
          onClick={() => onSnapChange(!snapToGrid)} pressed={snapToGrid} icon="magnet" label="Snap to grid"
          title="Snap to grid — line things up as you drag them" text="Snap"
        />
        <SelectMenu tables={tables} zones={zones} selection={selection} />
      </div>

      {/* The zoom controls are captioned with `label`, not left to their own
          content: a button whose content is a glyph is announced as that glyph. */}
      <div className="es-maptoolbar__group es-maptoolbar__zoom">
        <ToolbarButton onClick={zoom.out} label="Zoom out" icon="minus" />
        <span className="es-maptoolbar__pct es-nums">{Math.round(zoom.scale * 100)}%</span>
        <ToolbarButton onClick={zoom.in} label="Zoom in" icon="plus" />
        <ToolbarButton onClick={zoom.fit} label="Frame the whole room" title="Fit the whole room in view" text="Fit" />
        {onFullscreen && <ToolbarButton onClick={onFullscreen} label="Full screen" title="Full screen (Esc to leave)" icon="expand" />}
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
      // Short on screen ("3 selected ×") so it fits where "Select all" was and
      // the toolbar does not wrap the moment something is picked; named in
      // full for a screen reader.
      <button
        type="button" onClick={selection.clear} className="es-tbtn es-tbtn--on"
        aria-label={`${selection.count} selected · Deselect`} title="Deselect (Esc)"
      >
        <span>{selection.count} selected</span>
        <NavIcon name="close" size={15} />
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" className="es-tbtn" onClick={() => setOpen((v) => !v)} disabled={total === 0} aria-expanded={open}>
        <span>Select all</span>
        <NavIcon name="chevronDown" size={15} />
      </button>

      {open && (
        <div className="es-mapmenu fx-stack fx-stack--sm">
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
              id="es-select-type" className="es-input es-input--dense" value={type}
              onChange={(e) => {
                setType(e.target.value);
                if (e.target.value === 'zones' || Object.prototype.hasOwnProperty.call(ZONES, e.target.value)) setCapacity('any');
              }}
            >
              <option value="any">Anything</option>
              <option value="tables">All tables</option>
              <option value="zones">All areas</option>
              <optgroup label="Table shapes">
                {SHAPES.map((s) => <option key={s} value={s}>{SHAPE_NAMES[s] || s}</option>)}
              </optgroup>
              <optgroup label="Areas">
                {ZONE_KINDS.map((k) => <option key={k} value={k}>{ZONES[k].label}</option>)}
              </optgroup>
            </select>

            <label className="text-xs text-subtle" htmlFor="es-select-cap">Seats per table</label>
            <select
              id="es-select-cap" className="es-input es-input--dense" value={capacity} disabled={zoneTypeChosen}
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

/**
 * A toolbar button: an icon, an optional short word, and a full name for
 * screen readers and the tooltip. On a narrow canvas the word folds away and
 * the icon carries it (`.es-tbtn__text`).
 */
function ToolbarButton({ onClick, disabled, title, label, pressed, icon = null, text = null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      className={`es-tbtn${icon && !text ? ' es-tbtn--icon' : ''}`}
    >
      {icon && <NavIcon name={icon} size={17} />}
      {text && <span className={icon ? 'es-tbtn__text' : undefined}>{text}</span>}
    </button>
  );
}

function ToolTab({ active, onClick, title, icon, children }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={active}>
      <NavIcon name={icon} size={17} />
      <span className="es-tbtn__text">{children}</span>
    </button>
  );
}
