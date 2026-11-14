import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { isAuthError } from '../api/client';
import * as endpoints from '../api/endpoints';
import { useSession } from '../auth/session';
import { dialog } from '../ui/Dialog';
import { DoorAuthError } from './errors';

/**
 * The door's shared reads. One `me` (who this device is, the event, what it
 * may do) and one live `status` (gate state and counts), polled every 10 s
 * while the app is in front — the dashboard's "Live Check-in".
 */
export function useMe() {
  const door = useSession((s) => s.door);
  return useQuery({
    queryKey: ['me', door?.token],
    queryFn: () => endpoints.me(door!.token),
    enabled: Boolean(door),
    staleTime: 30_000,
  });
}

export function useGateStatus() {
  const door = useSession((s) => s.door);
  return useQuery({
    queryKey: ['status', door?.token],
    queryFn: () => endpoints.status(door!.token),
    enabled: Boolean(door),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useRecent(kind: 'admitted' | 'all', limit = 20) {
  const door = useSession((s) => s.door);
  return useQuery({
    queryKey: ['recent', door?.token, kind, limit],
    queryFn: () => endpoints.recent(door!.token, { kind, limit }),
    enabled: Boolean(door),
    refetchInterval: 10_000,
  });
}

/**
 * A door token the server no longer accepts — the device was switched off, the
 * person was removed from the door team, the 16-hour shift ran out. The phone
 * leaves the door and says why; queued scans stay in the log to upload after
 * signing in again.
 */
export function useDoorExit() {
  const leaveDoor = useSession((s) => s.leaveDoor);
  const client = useQueryClient();
  return useCallback(async (err: unknown) => {
    if (!(err instanceof DoorAuthError) && !isAuthError(err)) return false;
    await leaveDoor();
    client.clear();
    dialog.alert(
      'Signed out of this door',
      `${err instanceof Error && err.message ? `${err.message} ` : ''}Scans not yet uploaded are kept on this phone and upload when you sign back in to this event.`,
      { tone: 'warning', icon: 'lock' },
    );
    return true;
  }, [leaveDoor, client]);
}
