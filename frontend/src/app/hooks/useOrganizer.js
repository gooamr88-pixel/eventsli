'use client';

import { useEffect, useState } from 'react';
import { get } from '../utils/apiClient';

/**
 * The organizer profile, or the absence of one.
 *
 * `GET /organizer/me` answers 404 when the signed-in account has no organizer
 * profile, and that 404 is a NORMAL state, not a failure — it is exactly what
 * every buyer account returns. So it resolves to `{ organizer: null }` rather
 * than throwing, and the dashboard renders the "become an organizer" path
 * instead of an error.
 *
 * Not shared through a module-level store like `useAuth`, deliberately: this is
 * read on the organizer pages only, it changes when the profile is created or
 * Stripe onboarding finishes, and every one of those moments wants a fresh
 * read rather than a cached one.
 */
export function useOrganizer() {
  const [state, setState] = useState({ loading: true, organizer: null, error: null });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const organizer = await get('/organizer/me', { cache: 'no-store', noRedirect: true });
        if (!cancelled) setState({ loading: false, organizer, error: null });
      } catch (err) {
        // 404 means "no profile yet", which is a state and not an error.
        if (!cancelled) {
          setState({
            loading: false,
            organizer: null,
            error: err?.status === 404 ? null : err,
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  return { ...state, refresh: () => setReload((n) => n + 1) };
}
