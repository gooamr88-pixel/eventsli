'use client';

import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "DID YOU MEAN PM?" (2026-11-24). The client's first Adel event went on sale
 * starting at 8:30 AM and ending at 1:00 AM the next day — a 16-hour banquet
 * that was meant to start at 8:30 PM. A start in the morning that runs past
 * midnight is almost always an AM/PM slip in the time picker, so it is said
 * under the fields, with the fix one tap away. It never blocks saving: a
 * morning-to-night festival is real.
 *
 * `start` and `end` are the fields' own values ("2026-12-11T08:30").
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function amPmSlip(start, end) {
  const s = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(start || ''));
  const e = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(end || ''));
  if (!s || !e) return null;
  const startHour = Number(s[2]);
  const endHour = Number(e[2]);
  const nextDay = e[1] > s[1];
  const hours = (Date.parse(`${e[1]}T${e[2]}:${e[3]}:00Z`) - Date.parse(`${s[1]}T${s[2]}:${s[3]}:00Z`)) / 3600e3;
  if (!(startHour >= 5 && startHour < 12 && nextDay && endHour <= 6 && hours > 12)) return null;
  const pm = startHour + 12;
  const label = `${pm - 12}:${s[3]} PM`;
  return { value: `${s[1]}T${String(pm).padStart(2, '0')}:${s[3]}`, label, from: `${startHour}:${s[3]} AM`, hours };
}

export default function AmPmCheck({ start, end, onFix }) {
  const slip = amPmSlip(start, end);
  if (!slip) return null;
  return (
    <div className="es-ampm" role="status">
      <span className="es-ampm__icon" aria-hidden="true"><NavIcon name="clock" size={18} /></span>
      <p className="es-ampm__text">
        <b>Starts at {slip.from}?</b> It then runs {Math.round(slip.hours)} hours, past midnight. Most evening events mean <b>{slip.label}</b>.
      </p>
      <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => onFix(slip.value)}>
        Change to {slip.label}
      </button>
    </div>
  );
}
