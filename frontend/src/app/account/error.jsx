'use client';

import SegmentError from '../components/SegmentError';

/**
 * A failure in the account area keeps the account navigation.
 *
 * `/account` has its own layout with the tabs between tickets and security, so
 * somebody whose ticket list failed to render can still reach the other tab —
 * which matters most in the one case that brings people here in a hurry, a
 * ticket that will not open.
 */
export default function AccountError({ error, reset }) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      area="This page"
      home={{ href: '/account/tickets', label: 'My tickets' }}
    />
  );
}
