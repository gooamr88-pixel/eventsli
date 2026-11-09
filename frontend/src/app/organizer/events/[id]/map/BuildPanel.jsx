'use client';

import NavIcon from '../../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The panel beside the map when nothing is selected: what can be added, and
 * how ticket types get onto seats.
 *
 * Each item opens "Add to the map" already set to that kind — the dialog is
 * still where counts, rows × columns and numbering are chosen. A "Seat" is a
 * one-seat row of seats, which is how the editor models a lone seat (an
 * accessible spot, a judge's chair); there is no second element type for it.
 *
 * Click, not drag: the editor places new elements in view and the organizer
 * drags them where they belong, which works the same with a mouse, a
 * trackpad and a finger.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const BUILD_ITEMS = [
  // The Venue Studio's builder: many rows at once, named as a section, fanned
  // toward the stage if asked (studio/SectionDialog.jsx).
  { key: 'section', icon: 'grid', title: 'Seating section', text: 'Rows × seats in one go — straight, or fanned toward the stage.', initial: { family: 'section' } },
  { key: 'seat', icon: 'user', title: 'Seat', text: 'A single seat — an accessible spot, a judge’s chair.', initial: { family: 'table', key: 'row', seatCount: 1 } },
  { key: 'row', icon: 'list', title: 'Row', text: 'A straight row of seats, theatre style.', initial: { family: 'table', key: 'row', seatCount: 10 } },
  { key: 'table', icon: 'layers', title: 'Table', text: 'A table with seats around it — round, oval or long.', initial: { family: 'table', key: 'round', seatCount: 10 } },
  { key: 'stage', icon: 'flag', title: 'Stage', text: 'Where everyone looks. Not for sale.', initial: { family: 'zone', key: 'stage' } },
  { key: 'area', icon: 'map', title: 'Area', text: 'A labelled space — standing area, bar, walkway, screen.', initial: { family: 'zone', key: 'custom' } },
];

export default function BuildPanel({ onAdd, tableCount, unpricedCount }) {
  return (
    <aside className="es-dcard es-mapbuild" aria-labelledby="map-build">
      <div>
        <h2 id="map-build" className="es-dcard__title">Build your seating map</h2>
        <p className="es-ovcard__desc">Add items, then drag them into place on the map.</p>
      </div>
      <ul className="es-mapbuild__list">
        {BUILD_ITEMS.map((it) => (
          <li key={it.key}>
            <button type="button" className="es-mapbuild__item" onClick={() => onAdd(it.initial)}>
              <span className="es-mapbuild__icon" aria-hidden="true"><NavIcon name={it.icon} size={22} /></span>
              <span className="fx-min0">
                <b>{it.title}</b>
                <small>{it.text}</small>
              </span>
              <NavIcon name="plus" size={18} />
            </button>
          </li>
        ))}
      </ul>

      <div className="es-mapbuild__assign">
        <h3 className="es-mapbuild__h">Ticket type assignment</h3>
        <p className="es-ovcard__desc">
          Select tables or rows on the map — click one, or drag across several — then choose their ticket type here.
        </p>
        <p className="es-mapbuild__hint">
          <NavIcon name="tag" size={16} />
          {tableCount === 0
            ? 'Nothing to assign yet.'
            : unpricedCount > 0
              ? `${unpricedCount} of ${tableCount} not priced yet.`
              : `All ${tableCount} have a ticket type or price.`}
        </p>
      </div>
    </aside>
  );
}
