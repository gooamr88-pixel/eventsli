import NetInfo from '@react-native-community/netinfo';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/auth/session';
import { primeFeedback } from '@/gate/feedback';
import { useScanLog } from '@/gate/scanLog';
import { useDoorExit, useGateStatus, useMe } from '@/gate/useDoor';
import { colors } from '@/ui/theme';

const SYNC_EVERY_MS = 20_000;

/**
 * Everything while working a door. Loads this event's scan log, keeps the
 * held scans uploading (every 20 s, and the moment the signal returns or the
 * app comes back to the front), and leaves the door if the server stops
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
    if (door) useScanLog.getState().load(door.eventId).catch(() => undefined);
  }, [door?.eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const err of [me.error, status.error]) if (err) exit(err);
  }, [me.error, status.error, exit]);

  useEffect(() => {
    if (!door) return undefined;
    const run = () => useScanLog.getState().sync(door.token).catch(exit);
    const timer = setInterval(run, SYNC_EVERY_MS);
    const net = NetInfo.addEventListener((s) => { if (s.isConnected) run(); });
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') run(); });
    run();
    return () => {
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
    </Stack>
  );
}
