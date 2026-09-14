'use client';

import { useCallback, useEffect, useState } from 'react';
import { get } from '../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One GET, with its loading and failure states and a way to ask again.
 *
 * Every dashboard component was writing the same twenty lines — state, effect,
 * cancelled flag, try/catch — and a few forgot the cancelled flag, so a slow
 * response for the previous event could land on the page for the next one.
 *
 *   const { data, error, loading, reload } = useApi(`/events/${id}/stats`);
 *
 * `raw: true` resolves the whole envelope, for lists that need `pagination`.
 * A null path fetches nothing, which is how a caller waits for an id.
 *
 * The previous data stays on screen while a reload is in flight, so a refresh
 * after an action does not flash a skeleton over the table that just changed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useApi(path, { raw = false } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const [version, setVersion] = useState(0);

  // A new path is a new question: say so during render, before paint, rather
  // than in an effect that would draw one frame of the previous answer.
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    setState({ data: null, error: null, loading: Boolean(path) });
  }

  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await get(path, { cache: 'no-store', raw });
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (error) {
        if (!cancelled) setState((s) => ({ data: s.data, error, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, [path, raw, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
