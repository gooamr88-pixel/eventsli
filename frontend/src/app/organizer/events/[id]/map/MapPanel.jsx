'use client';

import NavIcon from '../../../../components/shell/NavIcon';
import MapLookCard from './style/MapLookCard';
import { LayerToggles } from './LayersCard';
import { Inspector, InspectorSection, Checklist, ChecklistStep } from '../../../../components/inspector/Inspector';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The inspector while NOTHING is selected: the map as a whole (2026-11-21).
 *
 * It used to be a second, longer copy of "Add to layout" (twelve items with a
 * sentence each, already in the left column) followed by a card of presets and
 * seven colour pickers. Now it holds what belongs to the whole map and nowhere
 * else:
 *
 *   GETTING STARTED  add seating → give every seat a ticket type → save,
 *               each step ticking itself off with the button that does it.
 *               Step two's button selects exactly the unpriced tables — so
 *               "link seats to ticket types" is two clicks (select them, pick
 *               the type) instead of a hunt across the canvas.
 *   MAP LOOK    the theme (MapLookCard).
 *   SHORTCUTS   folded; the keys that make the editor fast, which nothing on
 *               screen used to mention.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SHORTCUTS = [
  ['V', 'Select'],
  ['M', 'Pick several'],
  ['H', 'Pan around the map'],
  ['Arrows', 'Nudge the selection'],
  ['Ctrl+D', 'Duplicate'],
  ['Delete', 'Remove'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+A', 'Select everything'],
  ['Ctrl+wheel', 'Zoom'],
];

const Step = ChecklistStep;

export default function MapPanel({
  tableCount, unpricedCount, purchaseMode, onSelectUnpriced, look, onLookChange, onApplyLook,
  layers = null, onToggleLayer = null,
  dirty = false, saving = false, canSave = false, onSave = null, onAdd = null,
}) {
  const what = purchaseMode === 'table_only' ? 'whole-table price' : 'ticket type';
  const placed = tableCount > 0;
  const priced = placed && unpricedCount === 0;
  const saved = placed && !dirty;
  const doneCount = [placed, priced, saved].filter(Boolean).length;
  return (
    <Inspector
      label="Map"
      icon={<NavIcon name="map" size={22} />}
      title="Whole map"
      meta="Select a table or area to edit it."
    >
      {/* GETTING STARTED (2026-11-21): the three things a map needs before it
          can sell, in order, each ticking itself off from the draft and each
          with the one button that does it — so nobody has to know where
          ticket types are assigned, or that a whole-table price does not
          price the seats. */}
      <InspectorSection
        id="map-start" title={doneCount === 3 ? 'Ready to sell' : 'Getting started'}
        summary={doneCount === 3 ? 'All done' : `${doneCount} of 3 done`}
      >
        <Checklist>
          <Step n={1} done={placed} current={!placed} title="Add seating" detail={placed ? `${tableCount} ${tableCount === 1 ? 'table or row' : 'tables and rows'}` : 'Rows of seats, tables, or a ready-made map.'}>
            {!placed && onAdd && (
              <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => onAdd({ family: 'section' })}>
                <NavIcon name="plus" size={16} />Add rows of seats
              </button>
            )}
          </Step>
          <Step
            n={2} done={priced} current={placed && !priced}
            title={purchaseMode === 'table_only' ? 'Price every table' : 'Give every seat a ticket type'}
            detail={!placed ? 'After you add seating.' : priced ? 'Everything is on sale.' : `${unpricedCount} of ${tableCount} still need a ${what}.`}
          >
            {placed && !priced && (
              <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={onSelectUnpriced}>
                Select {unpricedCount === 1 ? 'it' : `these ${unpricedCount}`}
              </button>
            )}
          </Step>
          <Step
            n={3} done={saved} current={priced && !saved} title="Save the map"
            detail={saved ? 'All changes saved.' : placed ? 'Nothing is live until you save.' : 'Saves everything on every tab.'}
          >
            {placed && !saved && onSave && (
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={onSave} disabled={!canSave}>
                {saving ? 'Saving…' : 'Save map'}
              </button>
            )}
          </Step>
        </Checklist>
      </InspectorSection>

      <InspectorSection id="map-look" title="Map look" summary={look?.name || (look ? 'Custom' : 'Plain')}>
        <MapLookCard look={look} onChange={onLookChange} onApplyToTables={onApplyLook} tableCount={tableCount} />
      </InspectorSection>

      {/* The Layers card's switches, where the editor is too narrow for the
          left column that holds it (`.es-insp__sec--narrow`). */}
      {layers && (
        <InspectorSection id="map-layers-narrow" title="Show on the map" className="es-insp__sec--narrow" defaultOpen={false}>
          <LayerToggles layers={layers} onToggle={onToggleLayer} />
        </InspectorSection>
      )}

      <InspectorSection id="map-keys" title="Keyboard shortcuts" defaultOpen={false}>
        <dl className="es-keys">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
          ))}
        </dl>
      </InspectorSection>
    </Inspector>
  );
}
