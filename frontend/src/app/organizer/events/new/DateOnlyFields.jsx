'use client';

import { useState } from 'react';
import Field from '../../../components/forms/Field';
import { todayAt } from '../../../lib/dateOnly';

/**
 * When a display-only listing happens: a date, and a last day only if it runs
 * over several. No times (see lib/dateOnly.js) — a listing sells nothing and
 * scans nobody, so the organizer is never asked to invent a start and end.
 *
 * Shared by the manual wizard, the AI creator's editor and "Event details",
 * so all three ask the same question the same way.
 */
export default function DateOnlyFields({ firstDay, lastDay, timezone, onChange, errorFirst = null, errorLast = null, zoneLabel = '' }) {
  const [multi, setMulti] = useState(Boolean(lastDay && lastDay !== firstDay));
  const today = todayAt(timezone);

  return (
    <div className="fx-stack fx-stack--sm">
      <div className="fx-grid fx-grid--2">
        <Field
          label={multi ? 'First day' : 'Date'} type="date" name="firstDay" required min={today}
          hint={zoneLabel ? `The date in ${zoneLabel}. No start or end time is needed for a listing.` : 'No start or end time is needed for a listing.'}
          error={errorFirst} value={firstDay || ''}
          onChange={(e) => onChange({ firstDay: e.target.value, ...(!multi ? { lastDay: '' } : {}) })}
        />
        {multi && (
          <Field
            label="Last day" type="date" name="lastDay" required min={firstDay || today}
            error={errorLast} value={lastDay || ''}
            onChange={(e) => onChange({ lastDay: e.target.value })}
          />
        )}
      </div>
      <label className="es-check">
        <input
          type="checkbox" className="es-check__box" checked={multi}
          onChange={(e) => { setMulti(e.target.checked); if (!e.target.checked) onChange({ lastDay: '' }); }}
        />
        <span className="text-sm text-ink">It runs over more than one day</span>
      </label>
    </div>
  );
}
