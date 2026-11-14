import NetInfo from '@react-native-community/netinfo';
import { router, Stack, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/auth/session';
import { primeFeedback } from '@/gate/feedback';
import { useOfflineList } from '@/gate/offlineList';
import { useScanLog } from '@/gate/scanLog';
import { useDoorExit, useGateStatus, useMe } from '@/gate/useDoor';
import { useSettings } from '@/lib/settings';
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
  const pathname = usePathname();
  const where = useRef(pathname);
  useEffect(() => { where.current = pathname; }, [pathname]);

  // The mockup's You're Offline screen: once each time the signal drops, and
  // only on the dashboard or the camera, never over an answer.
  useEffect(() => {
    let wasOnline: boolean | null = null;
    return NetInfo.addEventListener((s) => {
      const online = s.isConnected !== false;
      if (wasOnline === true && !online && ['/dashboard', '/scan'].includes(where.current)) router.push('/offline');
      wasOnline = online;
    });
  }, []);

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
        if (alive && useSettings.getState().offlineMode) await useOfflineList.getState().pull(door.token);
      } catch (err) {
        exit(err);
      }
    };
    // The log and the list are read from disk before the first round.
    const ready = Promise.all([
      useScanLog.getState().load(door.eventId, door.deviceId).catch(() => undefined),
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
      {/*
        A full-screen card rather than a native modal: the app's own dialogs
        (src/ui/Dialog.tsx) are an RN Modal, which iOS cannot present over a
        native modal screen. No swipe back: an answer is dismissed on purpose.
      */}
      <Stack.Screen name="result" options={{ animation: 'fade', gestureEnabled: false }} />
      <Stack.Screen name="attendees" />
      <Stack.Screen name="ticket/[ticketId]" />
      <Stack.Screen name="analytics" />
      <Stack.Screen name="event" />
      {/* The tab bar's own screens switch without sliding. */}
      <Stack.Screen name="logs" options={{ animation: 'fade' }} />
      <Stack.Screen name="settings/index" options={{ animation: 'fade' }} />
      <Stack.Screen name="settings/profile" />
      <Stack.Screen name="settings/app-settings" />
      <Stack.Screen name="settings/data-sync" />
      <Stack.Screen name="settings/help" />
      <Stack.Screen name="offline" options={{ animation: 'fade' }} />
      <Stack.Screen name="sync" options={{ animation: 'fade' }} />
    </Stack>
  );
}
