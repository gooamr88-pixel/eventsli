import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { registerPushDevice } from '../api/endpoints';
import { useSession } from '../auth/session';
import { queryClient } from './queryClient';

/**
 * Push, end to end on the phone:
 *
 *   1. After sign-in, ask once (the system prompt), get this install's Expo
 *      token, and register it against the account (POST /me/push-devices).
 *   2. A push arriving in the foreground shows as a banner and refreshes the
 *      inbox; a tap opens what it is about — the event, or My Tickets.
 *
 * Nothing here is required for the app to work. A simulator, a refused
 * permission or a build without an EAS project id simply means no pushes; the
 * inbox still fills, because the server writes it either way.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

export async function registerForPush(sessionToken: string): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    const id = projectId();
    if (!id) return null; // `eas init` has not been run for this app yet

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Tickets and events',
        importance: AndroidImportance.HIGH,
        lightColor: '#D61F2C',
      });
    }

    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return null;

    const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await registerPushDevice(sessionToken, pushToken, Platform.OS === 'ios' ? 'ios' : 'android');
    await useSession.getState().setPushToken(pushToken);
    return pushToken;
  } catch {
    return null;
  }
}

type PushData = { kind?: string; eventId?: string | null; orderId?: string | null };

/** Where a tapped notification goes. Events are opened by id through the inbox's slug. */
function open(data: PushData) {
  if (data.kind === 'tickets_issued' || data.kind === 'ticket_received' || data.kind === 'event_reminder') {
    router.push('/(tabs)/tickets');
    return;
  }
  router.push('/notifications');
}

/** Call once from the root layout. Returns the cleanup. */
export function listenForPush(): () => void {
  const received = Notifications.addNotificationReceivedListener(() => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
  });
  const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
    open((response.notification.request.content.data || {}) as PushData);
  });
  return () => {
    received.remove();
    tapped.remove();
  };
}
