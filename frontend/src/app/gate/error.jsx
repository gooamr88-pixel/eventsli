'use client';

import SegmentError from '../components/SegmentError';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A CRASH AT THE DOOR, WITH A QUEUE BEHIND IT.
 *
 * Without this boundary a throw anywhere under `/gate` unwound to
 * `app/error.jsx` — which is the storefront's, in the storefront's light
 * palette, offering "Back to events". Door staff mid-shift on a dark tablet
 * would get a white screen and a link to the public listing, and the way back
 * to the scanner was to know the URL.
 *
 * Here it renders inside `gate/layout.jsx`, so the `.fx-gate` wrapper is still
 * above it and the dark palette holds. The failure is the size of the screen
 * that failed rather than the size of the application.
 *
 * THE NOTE IS THE PART THAT MATTERS, and it is a claim this codebase can make
 * honestly. Every scan carries an id the DEVICE generated before anything was
 * sent, and a record leaves the IndexedDB queue only once the server has
 * answered it — so a render that throws loses no admission, and re-uploading
 * returns the original answers rather than a wall of duplicate refusals. See
 * `gate/queuePolicy.js`. Somebody holding up a line needs to know that before
 * they decide whether to start waving people through.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function GateError({ error, reset }) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      area="The scanner"
      note={(
        <p>
          No admission has been lost. Scans already taken are held on this device
          and upload themselves once the scanner is running again.
        </p>
      )}
      home={{ href: '/gate', label: 'Back to scanning' }}
    />
  );
}
