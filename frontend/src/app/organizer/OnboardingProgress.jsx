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
  const step = ONBOARDING_STEPS[index];
  return (
    <div className="es-wizard__progress">
      <p className="es-wizard__count">
        <span>Step {index + 1} of {ONBOARDING_STEPS.length}</span>
        <span className="text-ink">{step.label}</span>
      </p>
      <div
        className="es-wizard__bar"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={ONBOARDING_STEPS.length}
        aria-valuenow={index + 1}
        aria-label={`Setup step ${index + 1} of ${ONBOARDING_STEPS.length}: ${step.label}`}
      >
        {ONBOARDING_STEPS.map((s, i) => (
          <span
            key={s.key}
            className="es-wizard__seg"
            data-state={i < index ? 'done' : i === index ? 'current' : 'upcoming'}
          />
        ))}
      </div>
    </div>
  );
}
