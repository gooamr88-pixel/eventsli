'use client';

import NavIcon from '../../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Layers, under "Add to layout" (the owner's Venue Builder mockup, 2026-11-10).
 *
 * What the canvas DRAWS, never what the map holds: hiding the areas or the
 * names makes a dense room easier to work in, and nothing is removed or saved
 * differently. Seats are always drawn — they are the stock — so their row
 * says so rather than offering a switch that would hide what is for sale.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const LAYERS = [
  { key: 'zones', label: 'Areas', hint: 'Stage, bars, walkways, entrances' },
  { key: 'labels', label: 'Names', hint: 'Table and row names' },
];

export default function LayersCard({ layers, onToggle }) {
  return (
    <section className="es-dcard es-maplayers" aria-labelledby="map-layers">
      <h2 id="map-layers" className="es-dcard__title">Layers</h2>
      <ul className="es-maplayers__list">
        <li className="es-maplayers__row">
          <span className="fx-min0"><b>Seats</b><small>Always shown</small></span>
          <span className="es-maplayers__lock" aria-hidden="true"><NavIcon name="lock" size={16} /></span>
        </li>
        {LAYERS.map((l) => (
          <li key={l.key} className="es-maplayers__row">
            <span className="fx-min0"><b>{l.label}</b><small>{l.hint}</small></span>
            <button
              type="button"
              className="es-maplayers__eye"
              aria-pressed={layers[l.key]}
              aria-label={`${layers[l.key] ? 'Hide' : 'Show'} ${l.label.toLowerCase()}`}
              onClick={() => onToggle(l.key)}
            >
              <NavIcon name={layers[l.key] ? 'eye' : 'ban'} size={18} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
