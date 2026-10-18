'use client';

import { useEffect, useState } from 'react';
import NavIcon from '../../../../components/shell/NavIcon';
import { AiStepper, QuotaDots } from './AiParts';

/**
 * The wait, and what happens when it fails.
 *
 * The answer does not stream (Groq's structured output cannot), so the
 * progress list is paced by the clock rather than by the server — it says
 * what the request is doing, in the order it does it, and never claims a step
 * finished early. The skeleton underneath is the shape of the page the draft
 * is about to fill, so the screen that follows does not jump.
 *
 * `aria-live` on the list only: the skeleton is decoration and is hidden.
 */
const STAGES = [
  ['Reading your description', 0],
  ['Filling in the details, tickets and schedule', 2500],
  ['Checking dates and prices against your text', 7000],
];

export function GeneratingStep({ onCancel }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 500);
    return () => clearInterval(timer);
  }, []);
  const current = STAGES.reduce((at, [, ms], i) => (elapsed >= ms ? i : at), 0);

  return (
    <div className="es-ai es-ai--narrow">
      <AiStepper index={0} />
      <div className="es-ai-gen">
        <span className="es-ai-gen__orb" aria-hidden="true"><NavIcon name="sparkle" size={26} /></span>
        <h1 className="es-ai-gen__title">Drafting your event</h1>
        <ol className="es-ai-gen__list" aria-live="polite">
          {STAGES.map(([label], i) => {
            const state = i < current ? 'done' : i === current ? 'now' : 'todo';
            return (
              <li key={label} data-state={state}>
                {state === 'done' ? <NavIcon name="check" size={18} /> : <span className={state === 'now' ? 'es-ai-spin' : 'es-ai-ring'} aria-hidden="true" />}
                <span>{label}{state === 'done' && <span className="sr-only"> — done</span>}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="es-ai-page es-ai-page--ghost" aria-hidden="true">
        <div className="es-ai-cover es-ai-cover--ghost" />
        <div className="es-ai-pad es-ai-ghost">
          <span className="es-skeleton es-skeleton--line w-1/4" />
          <span className="es-skeleton es-skeleton--text w-3/4" />
          <span className="es-skeleton es-skeleton--line w-1/2" />
          <span className="es-skeleton es-skeleton--line w-2/5" />
          <span className="es-skeleton es-skeleton--line w-full" />
          <span className="es-skeleton es-skeleton--line w-4/5" />
        </div>
      </div>

      <p className="es-ai-foot">
        Usually under 15 seconds ·{' '}
        <button type="button" className="es-ai-link" onClick={onCancel}>Stop waiting</button>
      </p>
    </div>
  );
}

/**
 * Every provider failed. Nothing was counted (D-010), and that is the first
 * thing somebody on a two-a-day limit wonders, so it is the sentence in bold.
 */
export function GenerationFailed({ quota, onRetry, onEdit, onManual }) {
  return (
    <div className="es-ai es-ai--narrow">
      <AiStepper index={0} />
      <div className="es-ai-state" role="alert">
        <span className="es-ai-state__icon" aria-hidden="true"><NavIcon name="alert" size={28} /></span>
        <h1 className="es-ai-title">We couldn&rsquo;t write a draft</h1>
        <p className="es-ai-lede">
          Our AI services didn&rsquo;t answer in time. <strong>This didn&rsquo;t use any of your AI drafts.</strong>{' '}
          Your description is kept.
        </p>
        <div className="es-ai-state__actions">
          <button type="button" className="es-btn es-btn--primary es-btn--lg" onClick={onRetry}>
            <NavIcon name="undo" size={18} /> Try again
          </button>
          <button type="button" className="es-btn es-btn--secondary" onClick={onEdit}>Change the description</button>
          <button type="button" className="es-btn es-btn--ghost" onClick={onManual}>Set it up myself</button>
        </div>
        <QuotaDots quota={quota} />
      </div>
    </div>
  );
}
