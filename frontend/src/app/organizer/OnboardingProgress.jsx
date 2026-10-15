/**
 * Where a new organizer is on the road to their first event:
 * organization → payments → first event.
 *
 * Shown at the top of each of those screens, so every one of them answers
 * "what am I doing, and how much is left?" before anything else.
 */
export const ONBOARDING_STEPS = [
  { key: 'organization', label: 'Organization' },
  { key: 'payments', label: 'Payments' },
  { key: 'event', label: 'First event' },
];

export function OnboardingProgress({ current }) {
  const index = Math.max(0, ONBOARDING_STEPS.findIndex((s) => s.key === current));
  return (
    <div className="es-wizard__progress">
      <p className="es-wizard__count">
        <span>Step {index + 1} of {ONBOARDING_STEPS.length}</span>
        <span className="text-ink">Getting set up</span>
      </p>
      {/* The same named stepper the create-event wizard uses, so the road to a
          first event reads as one sequence rather than three unrelated pages.
          No buttons: the earlier steps are on other routes and are finished. */}
      <ol className="es-wizard__steps" aria-label="Getting set up — steps">
        {ONBOARDING_STEPS.map((s, i) => {
          const state = i < index ? 'done' : i === index ? 'current' : 'upcoming';
          return (
            <li key={s.key} className="es-wizard__step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="es-wizard__steplink">
                <span aria-hidden className="es-wizard__seg" data-state={state} />
                <span className="es-wizard__steplabel">
                  {s.label}
                  <span className="sr-only">
                    {state === 'done' ? ' — done' : state === 'current' ? ' — this step' : ' — still to come'}
                  </span>
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
