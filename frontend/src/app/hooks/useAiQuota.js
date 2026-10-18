'use client';

import { useCallback, useEffect, useState } from 'react';
import { get } from '../utils/apiClient';

/**
 * Where this organizer stands on today's AI drafts: `{ enabled, limit, used,
 * remaining, nextAvailableAt }`, or null while it loads.
 *
 * A failure reads as DISABLED, not as an error. The AI card is an offer; if
 * the offer cannot be confirmed it is simply not made, and the manual wizard —
 * which needs none of this — is the whole page.
 *
 * `refresh` bumps a version rather than fetching itself, so the only setState
 * is in the request's callback (react-hooks/set-state-in-effect).
 */
const OFF = Object.freeze({ enabled: false, limit: 2, used: 0, remaining: 0, nextAvailableAt: null, reason: 'UNREACHABLE' });

export function useAiQuota() {
  const [quota, setQuota] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    get('/ai/quota', { noRedirect: true }).then(
      (value) => { if (live) setQuota(value); },
      () => { if (live) setQuota(OFF); },
    );
    return () => { live = false; };
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { quota, setQuota, refresh, loading: quota === null };
}
