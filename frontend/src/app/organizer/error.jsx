'use client';

import SegmentError from '../components/SegmentError';

/**
 * A failure inside the organizer console stays inside it.
 *
 * This renders in `organizer/layout.jsx`'s children slot, so the shell, the
 * sidebar and the account footer are all still there — an organizer whose
 * orders table threw can still reach their other events, which the root
 * boundary (a full-document replacement offering "Back to events") took away.
 *
 * A throw from the LAYOUT itself still unwinds past this to the root boundary,
 * which is correct: there is no shell left to render inside.
 */
export default function OrganizerError({ error, reset }) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      area="This part of your console"
      home={{ href: '/organizer', label: 'Back to dashboard' }}
    />
  );
}
