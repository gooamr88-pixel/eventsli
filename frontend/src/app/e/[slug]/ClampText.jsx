'use client';

import { useState } from 'react';

/**
 * The event description in the header: four lines, then "See more".
 *
 * The whole text is in the HTML either way (a crawler and a screen reader get
 * all of it); only the visual clamp toggles. The button appears only when the
 * text is long enough to have been cut — a "See more" that reveals nothing is
 * a broken promise.
 */
const LONG = 260;

export default function ClampText({ text }) {
  const [open, setOpen] = useState(false);
  const long = String(text || '').length > LONG;
  return (
    <div className="es-evx-about">
      <p className={`es-evx-about__text fx-break ${long && !open ? 'is-clamped' : ''}`}>{text}</p>
      {long && (
        <button type="button" className="es-evx-about__more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  );
}
