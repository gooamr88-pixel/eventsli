'use client';

/**
 * What to do when a gesture went to the page instead of the map (usePanZoom's
 * `hint`): a bare wheel scrolls the page, a one-finger swipe scrolls the page.
 * Shown for a moment over the map, the way an embedded Google map says
 * "Use ctrl + scroll to zoom the map", so the map never feels stuck.
 */
export default function MapGestureHint({ hint }) {
  if (!hint) return null;
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent || '');
  const text = hint === 'touch'
    ? 'Use two fingers to move the map'
    : `Use ${mac ? '⌘' : 'Ctrl'} + scroll to zoom the map`;
  return (
    <div className="es-gesturehint" role="status" aria-live="polite">
      <span>{text}</span>
    </div>
  );
}
