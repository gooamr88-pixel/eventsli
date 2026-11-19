'use client';

import { timeLabel } from '../../lib/demoTime';

/**
 * A day's open times. Picking one shows "Select" beside it (the reference's
 * two-step pick), so a stray tap does not jump straight to the form.
 */
export default function DemoTimes({ slots, zone, chosen, onChoose, onConfirm, durationMinutes }) {
  return (
    <div className="es-demo-times">
      <p className="es-demo-times__head">Choose a time <span>· {durationMinutes} min</span></p>
      <ul className="es-demo-times__list">
        {slots.map((iso) => (
          <li key={iso} className={iso === chosen ? 'is-on' : ''}>
            <button
              type="button"
              className="es-demo-times__slot"
              aria-pressed={iso === chosen}
              onClick={() => onChoose(iso)}
            >
              {timeLabel(iso, zone)}
            </button>
            {iso === chosen && (
              <button type="button" className="es-demo-times__go" onClick={() => onConfirm(iso)}>
                Select
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
