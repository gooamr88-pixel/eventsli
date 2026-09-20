'use client';

import SegmentError from '../components/SegmentError';

/**
 * A failure in the account area keeps the account navigation.
 *
 * `/account` has its own shell — the sidebar, the phone tab bar and the
 * workspace switcher — so somebody whose ticket list failed to render can still
 * reach their orders, their security settings or the storefront. That matters
 * most in the one case that brings people here in a hurry: a ticket that will
 * not open.
 *
 * `home` is the DASHBOARD now, not the tickets tab. It used to be tickets
 * because tickets was the only other place to go; with a dashboard above it, the
 * recovery link should be the one page that summarises everything rather than
 * the sibling of whichever screen just broke — and if it was the ticket list
 * that broke, "My tickets" as the way out is the failing page again.
 */
export default function AccountError({ error, reset }) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      area="This page"
      home={{ href: '/account', label: 'Your dashboard' }}
    />
  );
}
