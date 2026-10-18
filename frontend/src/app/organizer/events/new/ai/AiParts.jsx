'use client';

import NavIcon from '../../../../components/shell/NavIcon';

/**
 * The small pieces every Smart Event Creator screen shares: where the
 * organizer is in the three steps, how many AI drafts they have left, and the
 * action bar that sits at the thumb on a phone.
 */

export const AI_STEPS = ['Describe', 'Review', 'Save'];

/** Three named steps. Stateless: the creator decides which is current. */
export function AiStepper({ index }) {
  return (
    <ol className="es-ai-steps" aria-label="Create with AI — steps">
      {AI_STEPS.map((name, i) => {
        const state = i < index ? 'done' : i === index ? 'current' : 'todo';
        return (
          <li key={name} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="es-ai-steps__n" aria-hidden="true">
              {state === 'done' ? <NavIcon name="tick" size={13} /> : i + 1}
            </span>
            <span>{name}<span className="sr-only">{state === 'done' ? ' — done' : state === 'todo' ? ' — still to come' : ''}</span></span>
          </li>
        );
      })}
    </ol>
  );
}

/** "●● 2 of 2 left today". The dots are decoration; the words are the answer. */
export function QuotaDots({ quota, tone = 'default' }) {
  if (!quota) return null;
  const { limit = 2, remaining = 0 } = quota;
  return (
    <span className={`es-ai-quota${tone === 'light' ? ' es-ai-quota--light' : ''}`}>
      <span className="es-ai-quota__dots" aria-hidden="true">
        {Array.from({ length: limit }, (_, i) => (
          <span key={i} className={`es-ai-quota__dot${i < remaining ? '' : ' is-used'}`} />
        ))}
      </span>
      {remaining} of {limit} AI drafts left today
    </span>
  );
}

/** When the next draft can be written, in the organizer's own clock. */
export function nextDraftTime(iso) {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(at);
}

/**
 * The bar with the step's main action. Pinned to the bottom of the screen on a
 * phone, in the flow on a desktop (see `.es-ai-bar`). `children` on the left is
 * the status ("2 things need you"), the buttons on the right.
 */
export function ActionBar({ children, actions }) {
  return (
    <div className="es-ai-bar">
      <div className="es-ai-bar__status">{children}</div>
      <div className="es-ai-bar__actions">{actions}</div>
    </div>
  );
}
