'use client';

import SegmentError from '../components/SegmentError';

/**
 * A failure inside the admin console stays inside it.
 *
 * Same shape and same reason as the organizer boundary: this renders inside
 * `admin/layout.jsx`, so the console's navigation survives a page that threw.
 * An admin mid-review can move to another screen instead of being returned to
 * the public storefront.
 */
export default function AdminError({ error, reset }) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      area="This part of the console"
      home={{ href: '/admin', label: 'Back to overview' }}
    />
  );
}
