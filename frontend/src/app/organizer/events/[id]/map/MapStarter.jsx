'use client';

import NavIcon from '../../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AN EMPTY MAP ASKS ONE QUESTION: WHAT KIND OF ROOM IS THIS? (2026-11-21)
 *
 * It used to show a grey line — "Add tables and venue zones, or double-click
 * the floor" — over an empty canvas, and leave the organizer to find out what
 * a "venue zone" is and where adding happens. Now the canvas itself offers the
 * four ways to begin, each named for the event it suits, and the double-click
 * is a footnote for those who already know.
 *
 * The card takes pointer events; the floor around it still does, so a
 * double-click anywhere else drops a table as it always has.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function MapStarter({ onAdd, ai = false }) {
  const choices = [
    { key: 'section', icon: 'grid', title: 'Rows of seats', text: 'Theatre, concert, conference', initial: { family: 'section' } },
    { key: 'table', icon: 'layers', title: 'Tables', text: 'Gala, wedding, dinner', initial: { family: 'table', key: 'round', seatCount: 10 } },
    { key: 'template', icon: 'copy', title: 'A ready-made map', text: 'Yours or an Eventsli template', initial: { family: 'template' } },
    ...(ai ? [{ key: 'ai', icon: 'sparkle', title: 'Describe the room', text: 'AI lays it out for you', initial: { family: 'ai' } }] : []),
  ];
  return (
    <div className="es-mapstarter">
      <div className="es-mapstarter__card" role="group" aria-labelledby="map-starter-title">
        <h2 id="map-starter-title" className="es-mapstarter__title">How would you like to start?</h2>
        <p className="es-mapstarter__lede">Pick one — you can add anything else afterwards.</p>
        <ul className="es-mapstarter__list">
          {choices.map((c) => (
            <li key={c.key}>
              <button type="button" className="es-mapstarter__choice" onClick={() => onAdd(c.initial)}>
                <span className="es-mapstarter__icon" aria-hidden="true"><NavIcon name={c.icon} size={20} /></span>
                <span className="fx-min0"><b>{c.title}</b><small>{c.text}</small></span>
              </button>
            </li>
          ))}
        </ul>
        <p className="es-mapstarter__foot">Or double-click the floor to drop a single table.</p>
      </div>
    </div>
  );
}
