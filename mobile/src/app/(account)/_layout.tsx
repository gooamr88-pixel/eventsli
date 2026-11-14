import { Stack } from 'expo-router';

import { colors } from '@/ui/theme';

/**
 * Signed in, not working a door: the events to choose from, and Settings over
 * them. A stack of its own, like (door), so Settings (a modal) always has the
 * events under it.
 *
 * When a guard closes a group (signing out), Expo Router removes the group's
 * routes under the focused one and lets the focused one redirect. With these
 * two screens directly in the root stack, that left Settings alone at the
 * bottom of it for a moment, and Expo Router warned that a modal there is
 * shown as a card. Inside this group the root only ever sees `(account)`.
 */
export default function AccountLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="events" />
      <Stack.Screen name="account/index" options={{ animation: 'fade' }} />
      <Stack.Screen name="account/profile" />
      <Stack.Screen name="account/app-settings" />
      <Stack.Screen name="account/help" />
    </Stack>
  );
}
