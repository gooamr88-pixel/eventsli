import NetInfo from '@react-native-community/netinfo';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/auth/session';
import { primeFeedback } from '@/gate/feedback';
import { useOfflineList } from '@/gate/offlineList';
import { useScanLog } from '@/gate/scanLog';
import { useDoorExit, useGateStatus, useMe } from '@/gate/useDoor';
import { colors } from '@/ui/theme';

const SYNC_EVERY_MS = 15_000;

/**
 * Everything while working a door. Loads this event's scan log and ticket
 * list, and keeps both current: every 15 s, the moment the signal returns, and
 * when the app comes back to the front, it UPLOADS first (held scans and
 * offline admissions) and then pulls what changed in the list, so the list
 * already counts this phone's own uploads. Leaves the door if the server stops
 * accepting it.
 */
export default function DoorLayout() {
  const door = useSession((s) => s.door);
  const exit = useDoorExit();
  const me = useMe();
  const status = useGateStatus();

  useEffect(() => {
    primeFeedback();
  }, []);

  useEffect(() => {
    for (const err of [me.error, status.error]) if (err) exit(err);
  }, [me.error, status.error, exit]);

  useEffect(() => {
    if (!door) return undefined;
    let alive = true;
    const run = async () => {
      try {
        await useScanLog.getState().sync(door.token);
        if (alive) await useOfflineList.getState().pull(door.token);
      } catch (err) {
        exit(err);
      }
    };
    // The log and the list are read from disk before the first round.
    const ready = Promise.all([
      useScanLog.getState().load(door.eventId).catch(() => undefined),
      useOfflineList.getState().load(door.eventId).catch(() => undefined),
    ]);
    const go = () => { ready.then(() => (alive ? run() : undefined)); };
    const timer = setInterval(go, SYNC_EVERY_MS);
    const net = NetInfo.addEventListener((s) => { if (s.isConnected) go(); });
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') go(); });
    go();
    return () => {
      alive = false;
      clearInterval(timer);
      net();
      app.remove();
    };
  }, [door?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="scan" options={{ contentStyle: { backgroundColor: colors.camera }, animation: 'fade' }} />
      <Stack.Screen name="result" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="attendees" />
      <Stack.Screen name="ticket/[ticketId]" />
      <Stack.Screen name="analytics" />
      <Stack.Screen name="recent" />
      <Stack.Screen name="offline" />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
