'use client';

import { useState } from 'react';
import NavIcon from '../../../../components/shell/NavIcon';
import { formatMoney } from '../../../../utils/money';
import { AREA_COLORS, INK, typeColor } from '../../../../components/vendors/floorPlan/floorPlanModel';
import { Inspector, InspectorSection, InspectorAction, InspectorNote, Checklist, ChecklistStep } from '../../../../components/inspector/Inspector';
import {
  NumberField, Pair, Segmented, SelectField, TextField, Toggle,
} from '../../../../components/inspector/fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VENDOR FLOOR PLAN'S SIDE PANEL (2026-11-21), on the same Inspector and
 * fields as the seating map, so the two editors an organizer uses for one
 * event read and behave alike.
 *
 * Before this the panel was its own small world: `<p>` titles, inline labels
 * over raw inputs, bare checkboxes, a booth-type list that snapped back to
 * "Choose…" after every pick, Duplicate and Delete as two loose buttons — and
 * the Booth and Row tools' options in a strip ABOVE the canvas that pushed the
 * drawing down whenever one of them was picked. Now:
 *
 *   PlanPanel   nothing selected: the hall, the booths at a glance, the colour
 *               key, shortcuts.
 *   ToolPanel   a placing tool is on: what a click will do, and that tool's
 *               options (the row's count, size and code, a wall's Finish).
 *   ItemPanel   one item: what it is, its fields, the same footer as the map.
 *   MultiPanel  several: booth type (showing the shared value or "Mixed"),
 *               renumbering, availability.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const KIND = {
  booth: { label: 'Booth', icon: 'grid' },
  wall: { label: 'Wall', icon: 'pencil' },
  door: { label: 'Door', icon: 'door' },
  area: { label: 'Area', icon: 'image' },
  label: { label: 'Label', icon: 'tag' },
  arrow: { label: 'Arrow', icon: 'arrow' },
  table: { label: 'Round table', icon: 'users' },
  seats: { label: 'Theatre seats', icon: 'masks' },
};

const SIZE_PRESETS = [['60x60', 'Square', 60, 60], ['90x60', 'Wide', 90, 60], ['45x18', 'Corridor', 45, 18], ['120x60', 'Double', 120, 60]];
const STATUS = { sold: 'Booked', held: 'Offered', blocked: 'Unavailable' };

const SHORTCUTS = [
  ['Drag', 'Move (selection moves together)'],
  ['Shift-click', 'Add to the selection'],
  ['Arrows', 'Nudge (Shift: 10)'],
  ['R', 'Rotate 15°'],
  ['Ctrl+D', 'Duplicate'],
  ['Delete', 'Remove'],
  ['Ctrl+Z', 'Undo'],
  ['Esc', 'Back to Select'],
];

/** Colour swatches with a custom picker, as one labelled group. */
function Swatches({ label, value, palette, onChange }) {
  return (
    <div className="es-field">
      <span className="es-field__label">{label}</span>
      <span className="es-fpe__colors" role="group" aria-label={label}>
        {palette.map((c) => (
          <button key={c} type="button" className="es-fpe__color" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={value === c} onClick={() => onChange(c)} />
        ))}
        <input type="color" className="es-colourswatch" value={value || palette[0]} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: custom colour`} />
      </span>
    </div>
  );
}

const typeOptions = (boothTypes) => [['', 'None'], ...boothTypes.map((t) => [t.id, t.name])];

export function PlanPanel({
  plan, commit, boothTypes, currency, states, dirty = false, saving = false, onSave = null, onPickTool = null, onSelect = null,
}) {
  const booths = plan.elements.filter((e) => e.kind === 'booth');
  const count = (s) => booths.filter((b) => states[b.id]?.status === s).length;
  const sold = count('sold');
  const held = count('held');
  const blocked = booths.filter((b) => b.blocked).length;
  const free = booths.length - sold - held - blocked;
  const hasWalls = plan.elements.some((e) => e.kind === 'wall');
  const untyped = booths.filter((b) => !b.boothTypeId && !b.blocked);
  const typed = booths.length > 0 && untyped.length === 0;
  const steps = [hasWalls, booths.length > 0, typed, booths.length > 0 && !dirty];
  const doneCount = steps.filter(Boolean).length;
  const next = steps.indexOf(false);
  return (
    <Inspector
      label="Floor plan"
      icon={<NavIcon name="map" size={22} />}
      title="Whole hall"
      meta="Select an item to edit it."
    >
      {/* The same getting-started list as the seating map (2026-11-21):
          walls, booths, booth types, save — each with the button that does it. */}
      <InspectorSection id="fp-start" title={doneCount === 4 ? 'Ready for vendors' : 'Getting started'} summary={doneCount === 4 ? 'All done' : `${doneCount} of 4 done`}>
        <Checklist>
          <ChecklistStep n={1} done={hasWalls} current={next === 0} title="Draw the hall" detail={hasWalls ? 'The outline is drawn.' : 'Click the corners of the room.'}>
            {!hasWalls && onPickTool && <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => onPickTool('wall')}><NavIcon name="pencil" size={16} />Draw walls</button>}
          </ChecklistStep>
          <ChecklistStep n={2} done={booths.length > 0} current={next === 1} title="Add booths" detail={booths.length ? `${booths.length} booths on the plan.` : 'A whole row at once is quickest.'}>
            {next === 1 && onPickTool && <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => onPickTool('row')}><NavIcon name="plus" size={16} />Add a row of booths</button>}
          </ChecklistStep>
          <ChecklistStep
            n={3} done={typed} current={next === 2} title="Give every booth a type"
            detail={boothTypes.length === 0 ? 'First add booth types on the Booths tab.' : typed ? 'Every booth has a price and colour.' : booths.length ? `${untyped.length} still need one.` : 'Sets each booth’s price and colour.'}
          >
            {booths.length > 0 && !typed && boothTypes.length > 0 && onSelect && (
              <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => onSelect(untyped.map((b) => b.id))}>
                Select {untyped.length === 1 ? 'it' : `these ${untyped.length}`}
              </button>
            )}
          </ChecklistStep>
          <ChecklistStep n={4} done={booths.length > 0 && !dirty} current={next === 3} title="Save the plan" detail={!dirty && booths.length ? 'All changes saved.' : 'Vendors see it once it’s saved.'}>
            {dirty && onSave && <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save floor plan'}</button>}
          </ChecklistStep>
        </Checklist>
      </InspectorSection>

      <InspectorSection id="fp-booths" title="Booths" summary={`${booths.length} booths`}>
        <dl className="es-insp__facts">
          <div><dt>Free</dt><dd className="es-nums">{free}</dd></div>
          <div><dt>Offered</dt><dd className="es-nums">{held}</dd></div>
          <div><dt>Booked</dt><dd className="es-nums">{sold}</dd></div>
          <div><dt>Unavailable</dt><dd className="es-nums">{blocked}</dd></div>
        </dl>
        {boothTypes.length === 0 ? (
          <InspectorNote>Add booth types on the Booths tab — free booths are drawn in their type’s colour.</InspectorNote>
        ) : (
          <ul className="es-fpe__types" aria-label="Booth types">
            {boothTypes.map((t) => (
              <li key={t.id}>
                <span className="es-fp__swatch" style={{ background: typeColor(boothTypes, t.id) }} aria-hidden="true" />
                <span className="fx-min0 flex-1">{t.name}</span>
                <span className="text-subtle es-nums">{t.priceCents ? formatMoney(t.priceCents, currency) : 'Free'}</span>
              </li>
            ))}
          </ul>
        )}
      </InspectorSection>

      <InspectorSection id="fp-hall" title="Hall size" summary={`${plan.width} × ${plan.height}`}>
        <Pair>
          <NumberField live={false} label="Width" value={plan.width} min={200} max={20000} onChange={(n) => { if (n !== '') commit((p) => ({ ...p, width: n })); }} />
          <NumberField live={false} label="Depth" value={plan.height} min={200} max={20000} onChange={(n) => { if (n !== '') commit((p) => ({ ...p, height: n })); }} />
        </Pair>
        <InspectorNote>In drawing units: a standard booth is 60 × 60.</InspectorNote>
      </InspectorSection>

      <InspectorSection id="fp-keys" title="Keyboard shortcuts" defaultOpen={false}>
        <dl className="es-keys">
          {SHORTCUTS.map(([k, v]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}
        </dl>
      </InspectorSection>
    </Inspector>
  );
}

/** A placing tool is on: what the next click does, and the tool's own options. */
export function ToolPanel({ tool, label, icon, hint, rowForm, setRowForm, boothTypes, draftWall, onFinishWall, onDone }) {
  const set = (patch) => setRowForm((f) => ({ ...f, ...patch }));
  const preset = SIZE_PRESETS.find(([, , w, h]) => Number(rowForm.w) === w && Number(rowForm.h) === h)?.[0] || null;
  const walling = tool === 'wall' && draftWall?.length >= 2;
  return (
    <Inspector
      label="Tool"
      icon={<NavIcon name={icon} size={22} />}
      title={label}
      // The canvas already says what a click does; with options to set, the
      // panel says to set them first.
      meta={tool === 'booth' || tool === 'row' ? 'Set the options below, then click the floor.' : hint}
      actions={(
        <>
          {tool === 'wall' && <InspectorAction icon="tick" primary onClick={onFinishWall} disabled={!walling}>Finish wall</InspectorAction>}
          <InspectorAction icon="pointer" onClick={onDone}>Done</InspectorAction>
        </>
      )}
    >
      {(tool === 'booth' || tool === 'row') && (
        <>
          {tool === 'row' && (
            <Pair>
              <NumberField label="Booths" value={rowForm.count} min={1} max={60} onChange={(count) => set({ count })} />
              <SelectField label="Direction" value={rowForm.direction} onChange={(direction) => set({ direction })} options={[['right', 'Across'], ['down', 'Down']]} />
            </Pair>
          )}
          <Segmented
            stacked label="Size" value={preset}
            options={SIZE_PRESETS.map(([key, name, w, h]) => ({ key, label: name, sub: `${w}×${h}` }))}
            onChange={(key) => { const [, , w, h] = SIZE_PRESETS.find((p) => p[0] === key); set({ w, h }); }}
          />
          <Pair>
            <NumberField label="Width" value={rowForm.w} min={8} max={400} onChange={(w) => set({ w })} />
            <NumberField label="Depth" value={rowForm.h} min={8} max={400} onChange={(h) => set({ h })} />
          </Pair>
          <Pair>
            <TextField label="Code prefix" value={rowForm.prefix} maxLength={6} placeholder="DB" onChange={(prefix) => set({ prefix })} />
            <SelectField label="Booth type" value={rowForm.boothTypeId} onChange={(boothTypeId) => set({ boothTypeId })} options={typeOptions(boothTypes)} />
          </Pair>
          <InspectorNote>Codes continue from the last one with this prefix (DB1, DB2…).</InspectorNote>
        </>
      )}
      {tool === 'wall' && (
        <InspectorNote>Click each corner. Click the first corner again to close the room, or Finish wall to leave it open. Enter finishes too.</InspectorNote>
      )}
    </Inspector>
  );
}

export function ItemPanel({ e, update, boothTypes, state, onDelete, onDuplicate, rotatable }) {
  const set = (patch) => update((x) => ({ ...x, ...patch }));
  const kind = KIND[e.kind] || { label: e.kind, icon: 'info' };
  const holding = !!state && ['sold', 'held'].includes(state.status);
  const status = e.kind === 'booth' ? (holding ? STATUS[state.status] : e.blocked ? STATUS.blocked : 'Free') : null;
  const rotation = (deg) => <NumberField label="Rotation" value={e.r || 0} min={-360} max={360} step={deg} suffix="°" onChange={(r) => { if (r !== '') set({ r }); }} />;

  return (
    <Inspector
      label={kind.label}
      icon={<NavIcon name={kind.icon} size={22} />}
      title={e.kind === 'booth' ? (e.code || 'Booth without a code') : e.kind === 'area' || e.kind === 'label' ? (e.text || kind.label) : kind.label}
      meta={status ? `${status}${holding && state.vendor?.name ? ` — ${state.vendor.name}` : ''}` : null}
      status={holding ? <InspectorNote tone="warning">A vendor holds this booth, so it can’t be deleted. Close their offer first.</InspectorNote> : null}
      actions={(
        <>
          {rotatable && <InspectorAction icon="rotate" title="Turn 15° (R)" onClick={() => set({ r: ((e.r || 0) + 15) % 360 })}>Rotate</InspectorAction>}
          <InspectorAction icon="copy" onClick={onDuplicate}>Duplicate</InspectorAction>
          <InspectorAction icon="trash" tone="danger" onClick={onDelete} disabled={holding}>Delete</InspectorAction>
        </>
      )}
    >
      {e.kind === 'booth' && (
        <>
          <InspectorSection id="fp-booth" title="Booth" summary={e.code || 'No code'}>
            <TextField label="Code" value={e.code} maxLength={12} placeholder="DB1" hint="What vendors and visitors see on the map." onChange={(code) => set({ code })} />
            <SelectField label="Booth type" value={e.boothTypeId || ''} onChange={(v) => set({ boothTypeId: v || null })} options={typeOptions(boothTypes)} hint="Sets its price and colour." />
            <Toggle
              label="Available to book" checked={!e.blocked} disabled={holding}
              hint={e.blocked ? 'Shown with a no-entry mark; nobody can book it.' : null}
              onChange={(on) => set({ blocked: !on })}
            />
          </InspectorSection>
          <InspectorSection id="fp-size" title="Size & rotation" summary={`${e.w} × ${e.h}`}>
            <Pair>
              <NumberField label="Width" value={e.w} min={8} max={2000} onChange={(w) => { if (w !== '') set({ w }); }} />
              <NumberField label="Depth" value={e.h} min={8} max={2000} onChange={(h) => { if (h !== '') set({ h }); }} />
            </Pair>
            {rotation(15)}
          </InspectorSection>
        </>
      )}
      {e.kind === 'area' && (
        <>
          <TextField label="Title" value={e.text} maxLength={40} placeholder="Stage" onChange={(text) => set({ text })} />
          <TextField label="Subtitle" value={e.sub} maxLength={40} placeholder="Main hall" onChange={(sub) => set({ sub })} />
          <Pair>
            <NumberField label="Width" value={e.w} min={10} max={5000} onChange={(w) => { if (w !== '') set({ w }); }} />
            <NumberField label="Depth" value={e.h} min={10} max={5000} onChange={(h) => { if (h !== '') set({ h }); }} />
          </Pair>
          {rotation(15)}
          <Swatches label="Colour" value={e.fill} palette={AREA_COLORS} onChange={(fill) => set({ fill })} />
        </>
      )}
      {e.kind === 'label' && (
        <>
          <TextField label="Text" value={e.text} maxLength={60} onChange={(text) => set({ text })} />
          <Pair>
            <NumberField label="Text size" value={e.size} min={8} max={160} onChange={(size) => { if (size !== '') set({ size }); }} />
            {rotation(15)}
          </Pair>
          <Swatches label="Colour" value={e.color} palette={[INK.label, INK.wall, '#111018', '#16a34a', '#d61f2c']} onChange={(color) => set({ color })} />
        </>
      )}
      {e.kind === 'door' && (
        <>
          <Pair>
            <NumberField label="Width" value={e.size} min={10} max={400} onChange={(size) => { if (size !== '') set({ size }); }} />
            {rotation(90)}
          </Pair>
          <Toggle label="Double door" checked={!!e.double} onChange={(on) => set({ double: on })} />
        </>
      )}
      {e.kind === 'table' && (
        <Pair>
          <NumberField label="Size" value={e.size} min={10} max={200} onChange={(size) => { if (size !== '') set({ size }); }} />
          <NumberField label="Chairs" value={e.seats} min={0} max={16} onChange={(n) => { if (n !== '') set({ seats: Math.round(n) }); }} />
        </Pair>
      )}
      {e.kind === 'seats' && (
        <>
          <Pair>
            <NumberField label="Rows" value={e.rows} min={1} max={20} onChange={(n) => { if (n !== '') set({ rows: Math.round(n) }); }} />
            <NumberField label="Distance" value={e.radius} min={20} max={3000} onChange={(radius) => { if (radius !== '') set({ radius }); }} />
          </Pair>
          <Pair>
            <NumberField label="Arc width" value={e.spread} min={10} max={300} step={10} suffix="°" onChange={(spread) => { if (spread !== '') set({ spread }); }} />
            <NumberField label="Facing" value={e.r || 0} min={-360} max={360} step={15} suffix="°" onChange={(r) => { if (r !== '') set({ r }); }} />
          </Pair>
        </>
      )}
      {e.kind === 'arrow' && (
        <Swatches label="Colour" value={e.color} palette={[INK.wall, INK.label, '#111018', '#16a34a']} onChange={(color) => set({ color })} />
      )}
      {e.kind === 'wall' && (
        <Toggle label="Closed outline" hint="Joins the last corner back to the first." checked={!!e.closed} onChange={(on) => set({ closed: on })} />
      )}
    </Inspector>
  );
}

const MIXED = '__mixed__';

export function MultiPanel({ items, update, boothTypes, onDelete, onDuplicate, isHeld }) {
  const booths = items.filter((e) => e.kind === 'booth');
  const [prefix, setPrefix] = useState('');
  const [start, setStart] = useState(1);
  const firstType = booths[0]?.boothTypeId || '';
  const sharedType = booths.every((b) => (b.boothTypeId || '') === firstType) ? firstType : MIXED;
  const blockedCount = booths.filter((b) => b.blocked).length;
  const availability = blockedCount === 0 ? 'open' : blockedCount === booths.length ? 'blocked' : null;
  const anyHeld = items.some((e) => isHeld(e.id));

  function renumber() {
    // In reading order: top to bottom, then left to right.
    const order = [...booths].sort((a, b) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x)).map((b) => b.id);
    update((e) => (e.kind === 'booth' ? { ...e, code: `${prefix}${Number(start) + order.indexOf(e.id)}` } : e));
  }

  return (
    <Inspector
      label="Selection"
      icon={<NavIcon name="multi" size={22} />}
      title={`${items.length} selected`}
      meta={booths.length ? `${booths.length} booth${booths.length === 1 ? '' : 's'}${items.length > booths.length ? ` and ${items.length - booths.length} other` : ''}` : null}
      status={anyHeld ? <InspectorNote tone="warning">Some of these booths are held by vendors, so the selection can’t be deleted.</InspectorNote> : null}
      actions={(
        <>
          <InspectorAction icon="copy" onClick={onDuplicate}>Duplicate</InspectorAction>
          <InspectorAction icon="trash" tone="danger" onClick={onDelete} disabled={anyHeld} label={`Delete ${items.length} selected`}>Delete</InspectorAction>
        </>
      )}
    >
      {booths.length > 0 && (
        <>
          <InspectorSection id="fp-multi-type" title="Booths" summary={sharedType === MIXED ? 'Mixed types' : 'One type'}>
            <SelectField
              label={`Booth type for all ${booths.length}`}
              value={sharedType}
              onChange={(v) => { if (v !== MIXED) update((e) => (e.kind === 'booth' ? { ...e, boothTypeId: v || null } : e)); }}
              options={[...(sharedType === MIXED ? [[MIXED, 'Mixed — choose one for all']] : []), ...typeOptions(boothTypes)]}
            />
            <Segmented
              stacked label="Availability" value={availability}
              options={[{ key: 'open', label: 'Available' }, { key: 'blocked', label: 'Unavailable' }]}
              onChange={(v) => update((e) => (e.kind === 'booth' && !isHeld(e.id) ? { ...e, blocked: v === 'blocked' } : e))}
            />
          </InspectorSection>
          <InspectorSection id="fp-multi-codes" title="Renumber" defaultOpen={false}>
            <Pair>
              <TextField label="Code prefix" value={prefix} maxLength={6} placeholder="A" onChange={setPrefix} />
              <NumberField label="Start at" value={start} min={0} max={9999} onChange={setStart} />
            </Pair>
            <button type="button" className="es-btn es-btn--secondary es-btn--sm self-start" onClick={renumber}>
              Renumber {booths.length} booths
            </button>
            <InspectorNote>Top to bottom, then left to right — {prefix || ''}{start}, {prefix || ''}{Number(start) + 1}…</InspectorNote>
          </InspectorSection>
        </>
      )}
      {booths.length === 0 && <InspectorNote>Drag any one to move them together.</InspectorNote>}
    </Inspector>
  );
}
