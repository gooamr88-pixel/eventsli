'use client';

import { useEffect, useRef } from 'react';
import { API_URL } from '../../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The one thing that makes the "visits" statistic true.
 *
 * The storefront brief asked for real numbers and named visits as one. Events,
 * organizers, tickets and cities were all already countable; visits were the
 * only figure nothing in the database could answer. So rather than type one
 * into a component, the page counts.
 *
 * WHAT LEAVES THE BROWSER: a path, and nothing else. No id, no referrer, no
 * query string, no timing. The API hashes the address and user-agent with a
 * daily salt before storing anything — see the migration for why that hash
 * cannot be assembled into a history of one person.
 *
 * `keepalive` rather than `navigator.sendBeacon`. sendBeacon cannot set a
 * Content-Type of application/json without sending a Blob, and it gives no way
 * to know the request was refused. `fetch(..., { keepalive: true })` survives
 * the page being closed for the same reason sendBeacon does.
 *
 * Fires ONCE per mount, and the ref is what guarantees it. React 19 runs
 * effects twice in development Strict Mode, so without it every developer's
 * page load counts as two.
 *
 * Every failure is swallowed. A page view that was not counted is a missing
 * row; a page view that throws is a console error on the homepage.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VisitBeacon({ path }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    // Not awaited and deliberately not held: the page has already rendered and
    // nothing on it depends on the answer.
    fetch(`${API_URL}/public/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
      keepalive: true,
    }).catch(() => {});
  }, [path]);

  return null;
}
