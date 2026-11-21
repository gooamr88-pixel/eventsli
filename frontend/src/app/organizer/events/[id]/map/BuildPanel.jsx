'use client';

import { useEffect, useRef, useState } from 'react';
import NavIcon from '../../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CAN BE ADDED TO THE MAP, IN THREE GROUPS (2026-11-21).
 *
 * It was twelve items in one list — a seat, a row, then "Import from a
 * picture" (which replaces the whole map) between a text label and a
 * fountain — offered from four places: the left column, a long copy of it in
 * the right panel, the toolbar's Add element, and an AI banner plus an AI
 * button. Now there is one list, grouped by what the item does:
 *
 *   SEATING  stock — what is sold.
 *   ROOM     furniture and the room itself — never sold.
 *   START FROM  a whole map at once: a template, a picture, or AI.
 *
 * …and two places it is shown, never both: the left column wherever the editor
 * is wide enough for three columns (`BuildPalette`), and an Add menu on the
 * toolbar when it is not (`AddMenu`; `.es-mapadd` in globals.css hides it at
 * the width where the column appears).
 *
 * Each item opens "Add to the map" already set to that kind — the dialog is
 * still where counts, rows × columns and numbering are chosen. A "Seat" is a
 * one-seat row, which is how the editor models a lone seat.
 *
 * Click, not drag: the editor places new elements in view and the organizer
 * drags them where they belong, which works the same with a mouse, a trackpad
 * and a finger.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const BUILD_GROUPS = [
  {
    key: 'seating',
    title: 'Seating',
    items: [
      // The Venue Studio's builder: many rows at once, named as a section,
      // fanned toward the stage if asked (studio/SectionDialog.jsx).
      { key: 'section', icon: 'grid', title: 'Seating section', text: 'Rows × seats in one go — straight, or fanned toward the stage.', initial: { family: 'section' } },
      { key: 'table', icon: 'layers', title: 'Table', text: 'A table with seats around it — round, oval, long and more.', initial: { family: 'table', key: 'round', seatCount: 10 } },
      { key: 'row', icon: 'list', title: 'Row', text: 'A straight row of seats, theatre style.', initial: { family: 'table', key: 'row', seatCount: 10 } },
      { key: 'seat', icon: 'user', title: 'Single seat', text: 'One seat — an accessible spot, a judge’s chair.', initial: { family: 'table', key: 'row', seatCount: 1 } },
    ],
  },
  {
    key: 'room',
    title: 'Room',
    items: [
      { key: 'stage', icon: 'flag', title: 'Stage', text: 'Where everyone looks. Not for sale.', initial: { family: 'zone', key: 'stage' } },
      { key: 'area', icon: 'map', title: 'Area', text: 'A labelled space — standing area, bar, walkway, screen.', initial: { family: 'zone', key: 'custom' } },
      { key: 'wall', icon: 'pencil', title: 'Draw walls', text: 'Click the room’s corners. Leave gaps where the doors are.', initial: { family: 'tool', key: 'wall' } },
      { key: 'door', icon: 'door', title: 'Door', text: 'A named gap in a wall — Entrance, Side door.', initial: { family: 'zone', key: 'door_gap' } },
      { key: 'text', icon: 'fileText', title: 'Text label', text: 'Words anywhere on the floor.', initial: { family: 'zone', key: 'text' } },
      { key: 'decor', icon: 'target', title: 'Decoration', text: 'A fountain, tree or centrepiece, drawn in rings.', initial: { family: 'zone', key: 'decor' } },
    ],
  },
  {
    key: 'start',
    title: 'Start from',
    items: [
      { key: 'template', icon: 'copy', title: 'A template', text: 'One of your saved maps, or an Eventsli one. Replaces this map.', initial: { family: 'template' } },
      // A picture of a seating map, read by AI and redrawn (2026-11-19).
      { key: 'image', icon: 'image', title: 'A picture', text: 'Upload a floor plan or seating chart; AI redraws it. Replaces this map.', initial: { family: 'image' } },
      // Shown only when AI is set up for this organizer (`ai` prop).
      { key: 'ai', icon: 'sparkle', title: 'A description (AI)', text: 'Describe the room and AI lays it out. Replaces this map.', initial: { family: 'ai' }, needsAi: true },
    ],
  },
];

/** Flat, for anything that needs one item by key. */
export const BUILD_ITEMS = BUILD_GROUPS.flatMap((g) => g.items);

const visible = (group, ai) => group.items.filter((it) => !it.needsAi || ai);

/**
 * "Add to layout", the LEFT column of the owner's Venue Builder mockup
 * (2026-11-10): always in view, one line per item, grouped.
 */
export function BuildPalette({ onAdd, ai = false, children = null }) {
  return (
    <section className="es-dcard es-mappalette" aria-labelledby="map-palette">
      <h2 id="map-palette" className="es-mappalette__title">Add to layout</h2>
      {BUILD_GROUPS.map((g) => (
        <div key={g.key} className="es-mappalette__group">
          <h3 className="es-mappalette__h">{g.title}</h3>
          <ul className="es-mappalette__list">
            {visible(g, ai).map((it) => (
              <li key={it.key}>
                <button type="button" className="es-mappalette__item" onClick={() => onAdd(it.initial)} title={it.text}>
                  <NavIcon name={it.icon} size={18} />
                  <span>{it.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {/* Layers, in the same card (2026-11-21): one column, one surface,
          rather than a second card for two switches. */}
      {children}
    </section>
  );
}

/**
 * The same list as a toolbar menu, for an editor too narrow for the left
 * column. A menu of buttons (not role="menu": each is an ordinary action, and
 * Tab moves through them as it does everywhere else in the editor).
 */
export function AddMenu({ onAdd, ai = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="es-mapadd relative">
      <button type="button" className="es-tbtn es-tbtn--primary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <NavIcon name="plus" size={17} /><span>Add</span>
      </button>
      {open && (
        <div className="es-mapmenu es-mapmenu--add">
          {BUILD_GROUPS.map((g) => (
            <div key={g.key} className="es-mappalette__group">
              <p className="es-mappalette__h">{g.title}</p>
              <ul className="es-mappalette__list">
                {visible(g, ai).map((it) => (
                  <li key={it.key}>
                    <button
                      type="button" className="es-mappalette__item es-mappalette__item--rich"
                      onClick={() => { setOpen(false); onAdd(it.initial); }}
                    >
                      <NavIcon name={it.icon} size={18} />
                      <span className="fx-min0"><b>{it.title}</b><small>{it.text}</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
