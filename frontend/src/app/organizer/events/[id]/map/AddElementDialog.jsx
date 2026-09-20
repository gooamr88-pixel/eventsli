'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useModal } from '../../../../hooks/useModal';
import { WORLD, SHAPES, tableBody } from '../../../../components/seating/seatingGeometry';
import { ZONES, ZONE_KINDS, zoneMeta } from '../../../../components/seating/venueZones';
import { SHAPE_NAMES, SHAPE_HINTS } from './shapeNames';
import { MAX_SEATS_PER_TABLE } from './draftRules';
import ZonePreview from './ZonePreview';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Add tables and venue zones — one at a time, or a whole section at once.
 *
 * THE MULTI-ADD IS THE REASON THIS IS A DIALOG rather than a button.
 *
 * A real room is not laid out one table at a time. It is "four rows of six
 * round tables, ten seats each, numbered from 1" — and doing that by hand is
 * twenty-four clicks of Add, twenty-four drags into position and twenty-four
 * renames, every one of which can be off by one. It is also, done that way,
 * twenty-four entries in the undo stack, so backing out of a mistake means
 * pressing Ctrl+Z twenty-four times.
 *
 * Here it is one submission, one undo step, and the numbering cannot skip.
 *
 * WHERE THINGS LAND. New elements are placed from the top-left of what is
 * currently on screen, not from the middle of the world — an organizer who has
 * panned to the empty half of the room to build a section expects the section
 * to appear where they are looking. The caller supplies that origin, because
 * only it knows the viewport.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MAX_BATCH = 50;
const GRID_MAX = 12;

export default function AddElementDialog({ origin, roomForTables, onAdd, onClose }) {
  const [kind, setKind] = useState({ family: 'table', key: 'round' });
  const [seatCount, setSeatCount] = useState(10);
  const [label, setLabel] = useState('');
  const [multiple, setMultiple] = useState(false);
  const [arrangement, setArrangement] = useState('row');
  const [quantity, setQuantity] = useState(6);
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(3);
  const [gap, setGap] = useState(28);
  const [startNumber, setStartNumber] = useState('');

  const dialogRef = useRef(null);
  const isTable = kind.family === 'table';

  /**
   * THE CONTAINER, not the first control.
   *
   * The form carries `tabIndex={-1}` and `aria-labelledby`, so focusing it
   * announces "Add to the map, dialog" rather than dropping the reader onto an
   * unlabelled shape tile. `useModal` never places initial focus for exactly
   * this reason — a generic "first focusable" would be wrong here.
   *
   * Passive, which is the hook's one contract: it captures where focus came
   * from in a layout effect, and anything moving focus before that capture
   * gets recorded as the opener by mistake.
   */
  useEffect(() => { dialogRef.current?.focus(); }, []);

  /**
   * Escape, the Tab trap, the scroll lock and focus restoration. See
   * `useModal`; the last two were missing here.
   *
   * `aria-modal="true"` below is what makes the trap a correctness issue
   * rather than a nicety: the attribute tells a screen reader that everything
   * outside this form is inert, and without the trap Tab walked straight out
   * into the canvas and toolbar behind the scrim — the map editor, whose
   * controls move and delete tables.
   *
   * `stopEscape`, because the editor underneath has its own Escape binding in
   * `useEditorKeys`: one press should close this dialog, not also clear the
   * selection behind it.
   */
  useModal(dialogRef, onClose, { stopEscape: true });

  const count = useMemo(() => {
    if (!multiple) return 1;
    if (arrangement === 'grid') return clampInt(cols, 1, GRID_MAX) * clampInt(rows, 1, GRID_MAX);
    return clampInt(quantity, 2, MAX_BATCH);
  }, [multiple, arrangement, cols, rows, quantity]);

  // Tables have a ceiling the API enforces; zones have their own, and the
  // caller knows how much room is left. Saying so here — before the click —
  // is the difference between "24 added" and a refusal after the fact.
  const willAdd = isTable ? Math.min(count, roomForTables) : count;
  const truncated = willAdd < count;

  function submit(e) {
    e.preventDefault();
    if (willAdd < 1) return;

    // The step between elements, in percentages of the world, is the element's
    // own size plus the gap — so a row of banquet tables spaces itself out
    // further than a row of two-tops, without the organizer having to work out
    // what number to type.
    const size = isTable
      ? tableBody(kind.key, seatCount)
      : { width: zoneMeta(kind.key).w, height: zoneMeta(kind.key).h };
    const stepX = ((size.width + Number(gap || 0)) / WORLD.width) * 100;
    const stepY = ((size.height + Number(gap || 0)) / WORLD.height) * 100;

    const specs = [];
    for (let i = 0; i < willAdd; i += 1) {
      const col = arrangement === 'grid' ? i % clampInt(cols, 1, GRID_MAX) : (arrangement === 'row' ? i : 0);
      const row = arrangement === 'grid' ? Math.floor(i / clampInt(cols, 1, GRID_MAX)) : (arrangement === 'column' ? i : 0);
      const position = {
        x: clamp(origin.x + (multiple ? col * stepX : 0), 0, 100),
        y: clamp(origin.y + (multiple ? row * stepY : 0), 0, 100),
      };

      if (isTable) {
        const base = String(startNumber).trim();
        specs.push({
          shape: kind.key,
          seatCount: clampInt(seatCount, 1, MAX_SEATS_PER_TABLE),
          position,
          // A blank start number means "carry on from whatever is free", which
          // `addTables` works out. A typed one numbers from there, because an
          // organizer with a printed plan already knows what these are called.
          ...(base && /^\d+$/.test(base) ? { label: `T${Number(base) + i}` } : {}),
        });
      } else {
        specs.push({
          kind: kind.key,
          position,
          label: String(label).trim() || (multiple ? ZONES[kind.key].label : ''),
        });
      }
    }

    onAdd(isTable ? { tables: specs } : { zones: specs });
    onClose();
  }

  return (
    /**
     * `.es-backdrop`, and this dialog is the reason the class exists.
     *
     * It was `z-50` — a bare number, which the z-index map in globals.css warns
     * is "how stacking wars start" — and the shell's sidebar is 59 and its bottom
     * tab bar 55. So this dialog's full-screen scrim dimmed the page while the
     * navigation sat on top of it at full brightness, and on a phone the tab bar
     * covered the bottom of the panel. `--es-z-modal` is 5000, above all four
     * shell layers with room to spare.
     *
     * It also had `bg-ink/50` where the other two hand-rolled dialogs had
     * `bg-black/50`, so the same product dimmed the page two different ways.
     */
    <div
      className="es-backdrop"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        ref={dialogRef}
        tabIndex={-1}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="es-add-title"
        // `--wide`: the body is a grid of shape tiles, not a form, and 32rem
        // wraps it to two columns on a laptop.
        className="es-backdrop__panel es-backdrop__panel--wide"
      >
        <h2 id="es-add-title" className="text-lg">Add to the map</h2>

        <fieldset className="fx-stack fx-stack--sm">
          <legend className="text-xs uppercase tracking-wide text-subtle">Tables</legend>
          <div className="fx-grid" style={{ '--fx-col': '104px', '--fx-gap': '8px' }}>
            {SHAPES.map((s) => (
              <Tile
                key={s}
                active={isTable && kind.key === s}
                onClick={() => setKind({ family: 'table', key: s })}
                title={SHAPE_HINTS[s]}
                art={<ShapeArt shape={s} />}
                label={SHAPE_NAMES[s] || s}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="fx-stack fx-stack--sm">
          <legend className="text-xs uppercase tracking-wide text-subtle">Venue zones</legend>
          <p className="text-xs text-subtle">
            Furniture, not stock — zones are drawn on the map and never sold or ticketed.
          </p>
          <div className="fx-grid" style={{ '--fx-col': '104px', '--fx-gap': '8px' }}>
            {ZONE_KINDS.map((k) => (
              <Tile
                key={k}
                active={!isTable && kind.key === k}
                onClick={() => setKind({ family: 'zone', key: k })}
                art={<ZonePreview kind={k} size={26} />}
                label={ZONES[k].label}
              />
            ))}
          </div>
        </fieldset>

        <div className="fx-stack fx-stack--sm border-t border-border-base pt-4">
          {isTable ? (
            <NumberField
              label="Seats on each table" value={seatCount} min={1} max={MAX_SEATS_PER_TABLE}
              onChange={setSeatCount}
              hint="The table is drawn to fit them, so a 4-top and a 12-top do not look alike."
            />
          ) : (
            <TextField
              label="Label" value={label} onChange={setLabel} maxLength={40}
              placeholder={ZONES[kind.key].label}
              hint="Left empty, it shows the zone's own name. Sizes and colours are on the panel after you add it."
            />
          )}

          <label className="fx-row items-start gap-2 text-sm">
            <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="block text-ink">Add several at once</span>
              <span className="block text-xs text-subtle">
                A row, a column or a grid — placed, spaced and numbered in one step.
              </span>
            </span>
          </label>

          {multiple && (
            <div className="fx-stack fx-stack--sm rounded-(--es-radius-md) bg-bg-sunken p-3">
              <div className="fx-grid" style={{ '--fx-col': '150px', '--fx-gap': '10px' }}>
                <SelectField
                  label="Arrangement" value={arrangement} onChange={setArrangement}
                  options={[['row', 'A row'], ['column', 'A column'], ['grid', 'A grid']]}
                />
                {arrangement === 'grid' ? (
                  <>
                    <NumberField label="Columns" value={cols} min={1} max={GRID_MAX} onChange={setCols} />
                    <NumberField label="Rows" value={rows} min={1} max={GRID_MAX} onChange={setRows} />
                  </>
                ) : (
                  <NumberField label="How many" value={quantity} min={2} max={MAX_BATCH} onChange={setQuantity} />
                )}
                <NumberField
                  label="Gap between them" value={gap} min={0} max={400} onChange={setGap}
                  hint="In map units, measured edge to edge."
                />
                {isTable && (
                  <TextField
                    label="Number from" value={startNumber} onChange={setStartNumber}
                    inputMode="numeric" placeholder="next free"
                    hint="Names them T7, T8, T9… Leave empty to carry on from the last free number."
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {truncated && (
          <p className="text-sm text-warning">
            Only {willAdd} will fit — the map is close to its {isTable ? 'table' : 'zone'} limit.
          </p>
        )}

        <div className="fx-row fx-row--between flex-wrap gap-2 border-t border-border-base pt-4">
          <p className="text-sm text-muted">
            Adding {willAdd} {isTable ? (willAdd === 1 ? 'table' : 'tables') : (willAdd === 1 ? 'zone' : 'zones')}.
          </p>
          <div className="fx-row gap-2">
            <button type="button" onClick={onClose} className="es-btn es-btn--ghost">Cancel</button>
            <button type="submit" disabled={willAdd < 1} className="es-btn es-btn--primary">
              Add to map
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Tile({ active, onClick, art, label, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`fx-stack fx-stack--sm items-center gap-1 rounded-(--es-radius-md) border p-2 text-center transition-colors ${
        active ? 'border-accent bg-accent/10' : 'border-border-base hover:bg-bg-sunken'
      }`}
    >
      <span className="grid h-8 place-items-center">{art}</span>
      <span className="text-xs text-ink">{label}</span>
    </button>
  );
}

/** A miniature of the shape itself, drawn by the same function that draws it on
 *  the canvas — so the tile cannot promise a silhouette the map then contradicts. */
function ShapeArt({ shape }) {
  const body = tableBody(shape, 8);
  const k = 26 / Math.max(body.width, body.height, 1);
  const w = body.width * k;
  const h = Math.max(body.height * k, 3);

  return (
    <svg width={28} height={28} viewBox="-14 -14 28 28" aria-hidden="true">
      {body.kind === 'ellipse' && <ellipse rx={w / 2} ry={h / 2} fill="none" stroke="currentColor" strokeWidth={1.4} />}
      {body.kind === 'rect' && <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={2} fill="none" stroke="currentColor" strokeWidth={1.4} />}
      {body.kind === 'none' && [-8, -3, 2, 7].map((x) => <circle key={x} cx={x} cy={0} r={2} fill="currentColor" />)}
    </svg>
  );
}

function TextField({ label, value, onChange, hint, ...rest }) {
  const id = `es-add-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      <input id={id} className="es-input" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, hint }) {
  const id = `es-add-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      <input
        id={id} type="number" className="es-input" value={value} min={min} max={max}
        // Held to the bounds on COMMIT, not on keystroke: clamping as you type
        // makes "10" impossible to reach through "1" when the minimum is 2.
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        onBlur={(e) => onChange(clampInt(e.target.value, min, max))}
      />
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  const id = `es-add-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      <select id={id} className="es-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function clampInt(value, lo, hi) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
