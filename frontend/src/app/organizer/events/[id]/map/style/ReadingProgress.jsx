'use client';

import { useEffect, useState } from 'react';
import NavIcon from '../../../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The wait while a seating map is read from a picture (owner, 2026-11-19: "I
 * need a professional / amazing loading bar"). A reading takes 20 s to two
 * minutes, and a spinner with a sentence gave no sense of progress at all.
 *
 * HONEST ABOUT WHAT IT KNOWS. The server does not report a percentage — the
 * model answers in one piece — so the bar is a curve over time that rises
 * quickly and slows as it nears the end (95 % at most), and never claims to
 * be done until the map is actually back. The steps are the order the work
 * really happens in, timed to typical readings, each ticked off as its time
 * passes.
 *
 * Its own clock, every 200 ms, so the bar moves smoothly between the 3 s polls.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const READING_STEPS = Object.freeze([
  { at: 0, label: 'Uploading your picture' },
  { at: 3, label: 'Finding every table and its name' },
  { at: 14, label: 'Measuring where each table sits' },
  { at: 32, label: 'Reading the seats at each table' },
  { at: 55, label: 'Placing the stage, bar, walls and doors' },
  { at: 80, label: 'Drawing your map' },
]);

/** The bar's fill, 0–95, after `t` seconds. */
export function readingPercent(t) {
  return Math.min(95, 95 * (1 - Math.exp(-Math.max(0, t) / 38)));
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function ReadingProgress({ startedAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const t = Math.max(0, (now - startedAt) / 1000);
  const pct = readingPercent(t);
  const current = READING_STEPS.reduce((at, step, i) => (t >= step.at ? i : at), 0);

  return (
    <div className="es-readprog" role="status" aria-live="polite" aria-label={`Reading the map: ${READING_STEPS[current].label}`}>
      <div className="es-readprog__head">
        <span className="es-readprog__orb" aria-hidden="true"><NavIcon name="sparkle" size={18} /></span>
        <div className="fx-min0">
          <b>Reading your seating map</b>
          <small>{READING_STEPS[current].label}…</small>
        </div>
      </div>

      <div className="es-readprog__bar" aria-hidden="true">
        <span className="es-readprog__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="es-readprog__meta es-nums" aria-hidden="true">
        <span>{clock(t)}</span>
        <span>{Math.round(pct)}%</span>
      </div>

      <ol className="es-readprog__steps">
        {READING_STEPS.map((step, i) => (
          <li key={step.label} data-state={i < current ? 'done' : i === current ? 'now' : 'next'}>
            <span className="es-readprog__dot" aria-hidden="true">
              {i < current ? (
                <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.3l2.3 2.2L9.5 3.6" />
                </svg>
              ) : null}
            </span>
            {step.label}
          </li>
        ))}
      </ol>

      <p className="es-readprog__note">Large rooms can take up to two minutes. Keep this window open.</p>
    </div>
  );
}
