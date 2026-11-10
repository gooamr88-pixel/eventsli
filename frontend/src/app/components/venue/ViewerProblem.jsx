'use client';

/**
 * What a 3D or 360° view shows instead of itself when it cannot draw — never a
 * dark empty box. Both viewers sit on a near-black background, so a view that
 * failed quietly looked exactly like a broken site, most of all on a phone.
 *
 *   nogl   the browser has WebGL turned off; trying again will not help
 *   load   the 3D code or the photo did not arrive (a weak connection)
 *   lost   the device stopped drawing (iOS drops a page's GPU work when
 *          memory runs low)
 *   photo  the 360° photo itself could not be loaded
 *
 * `onFallback` is the buyer's way back to the 2D map, which needs none of
 * this; it is offered whenever the caller can switch to it.
 */
const SAY = {
  nogl: (what) => `The ${what} needs WebGL, which is turned off in this browser.`,
  load: (what) => `The ${what} didn’t load. Check your connection and try again.`,
  lost: (what) => `Your device stopped drawing the ${what}. This can happen on phones when memory runs low.`,
  photo: () => 'This 360° photo could not be loaded.',
};

export function problemMessage(kind, what = '3D view') {
  return (SAY[kind] || SAY.load)(what);
}

export default function ViewerProblem({ kind, what = '3D view', onRetry, onFallback, className = '' }) {
  const canRetry = kind !== 'nogl' && typeof onRetry === 'function';
  return (
    <div
      role="alert"
      className={`grid place-items-center rounded-(--es-radius-lg) border border-border-base bg-bg-sunken p-6 text-center ${className}`}
    >
      <div className="fx-stack items-center gap-3">
        <p className="max-w-sm text-sm text-muted">
          {problemMessage(kind, what)}
          {onFallback ? ' The 2D map shows every seat.' : ''}
        </p>
        {(canRetry || onFallback) && (
          <div className="fx-row fx-row--center gap-2">
            {canRetry && (
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={onRetry}>Try again</button>
            )}
            {onFallback && (
              <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={onFallback}>Use the 2D map</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
