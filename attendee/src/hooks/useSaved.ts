import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { saveEvent, savedEventIds, unsaveEvent } from '../api/endpoints';
import { useToken } from '../auth/session';

const IDS = ['saved', 'ids'] as const;

/**
 * The heart on every card. The set of saved ids is one small query shared by
 * every card on screen; a tap flips the heart at once (optimistic) and puts it
 * back if the server refused. Signed out, a tap goes to sign-in rather than
 * pretending to save something only this phone would remember.
 */
export function useSaved() {
  const token = useToken();
  const qc = useQueryClient();

  const ids = useQuery({
    queryKey: IDS,
    queryFn: () => savedEventIds(token as string),
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  const toggle = useMutation({
    mutationFn: ({ eventId, save }: { eventId: string; save: boolean }) =>
      (save ? saveEvent : unsaveEvent)(token as string, eventId),
    onMutate: async ({ eventId, save }) => {
      await qc.cancelQueries({ queryKey: IDS });
      const before = qc.getQueryData<string[]>(IDS) ?? [];
      qc.setQueryData<string[]>(IDS, save ? [eventId, ...before.filter((id) => id !== eventId)] : before.filter((id) => id !== eventId));
      return { before };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) qc.setQueryData(IDS, ctx.before);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['saved'] });
    },
  });

  const set = useMemo(() => new Set(ids.data ?? []), [ids.data]);
  const isSaved = useCallback((eventId: string) => set.has(eventId), [set]);

  const flip = useCallback((eventId: string) => {
    if (!token) {
      router.push('/sign-in');
      return;
    }
    toggle.mutate({ eventId, save: !set.has(eventId) });
  }, [token, set, toggle]);

  return { isSaved, flip };
}
