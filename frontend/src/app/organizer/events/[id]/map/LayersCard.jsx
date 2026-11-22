'use client';

import { Toggle } from '../../../../components/inspector/fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Layers (the owner's Venue Builder mockup, 2026-11-10): the foot of the left
 * column's "Add to layout" card since 2026-11-21, rather than a second card
 * for two switches.
 *
 * What the canvas DRAWS, never what the map holds: hiding the areas or the
 * names makes a dense room easier to work in, and nothing is removed or saved
 * differently. Seats are always drawn — they are the stock — so there is no
 * switch that would hide what is for sale.
 *
 * `LayerToggles` is the list alone, with its hints: the Map inspector shows it
 * as "Show on the map" where the editor is too narrow for the left column.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const LAYERS = [
  { key: 'zones', label: 'Areas', hint: 'Stage, bars, walls, doors' },
  // Shown only where the event has vendors on this map (2026-11-22).
  { key: 'booths', label: 'Vendor booths', hint: 'The booths vendors book' },
  { key: 'labels', label: 'Names', hint: 'Table and row names' },
];

export function LayerToggles({ layers, onToggle, compact = false }) {
  return (
    <>
      {LAYERS.filter((l) => l.key in layers).map((l) => (
        <Toggle
          key={l.key} label={compact ? l.label : `Show ${l.label.toLowerCase()}`} hint={compact ? null : l.hint}
          checked={!!layers[l.key]} onChange={() => onToggle(l.key)}
        />
      ))}
      <p className="es-field__hint">Seats are always shown.</p>
    </>
  );
}

/** The palette card's Layers group. */
export default function LayersSection({ layers, onToggle }) {
  return (
    <div className="es-mappalette__group es-maplayers" role="group" aria-labelledby="map-layers">
      <h3 id="map-layers" className="es-mappalette__h">Layers</h3>
      <div className="es-maplayers__list">
        <LayerToggles layers={layers} onToggle={onToggle} compact />
      </div>
    </div>
  );
}
