// One import per weight: the package index pulls in all eighteen weights.
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import * as Application from 'expo-application';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { appConfig } from '@/api/endpoints';
import { useSession } from '@/auth/session';
import { reportError, startMonitoring } from '@/lib/monitoring';
import { queryClient } from '@/lib/queryClient';
import { useSettings } from '@/lib/settings';
import { needsUpdate } from '@/lib/version';
import { Button } from '@/ui/Button';
import { DialogHost } from '@/ui/Dialog';
import { ScannerLockup } from '@/ui/ScannerMark';
import { Splash } from '@/ui/Splash';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);
const MIN_SPLASH_MS = process.env.NODE_ENV === 'test' ? 0 : 900;
// Crash reports, scrubbed of guest data; off unless a DSN is built in (lib/monitoring.ts).
startMonitoring();

/**
 * The app's frame: fonts, the stored session, the minimum-version check, and
 * the three states a phone can be in —
 *
 *   signed out          sign in, or pair a shared tablet
 *   signed in, no door  choose an event
 *   working a door      dashboard, scanner, guest list, analytics
 *
 * Each group is a guarded set of routes, so signing in, opening a door,
 * leaving it, signing out or being removed from a door team sends the phone to
 * the right place on its own: the guard drops the old group and `index` sends
 * the phone into the new one.
 *
 * So screens change the session and nothing else; they never navigate between
 * groups. A screen that also called router.replace after changing the session
 * built the next screen twice, once from the guard and once from its own call,
 * and the first copy's ROUTE_NAMES_CHANGED was left with no navigator to land
 * on (seen on Android when a door was opened). test/navigation.test.tsx holds
 * the rule, and it is why Settings is mounted inside each group rather than
 * beside them.
 */
export default function RootLayout() {
  // A font that fails to load falls back to the system font; it must never
  // keep the door shut behind the splash screen.
  const [fontsReady, fontError] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold });
  const fontsLoaded = fontsReady || Boolean(fontError);
  const hydrated = useSession((s) => s.hydrated);
  const account = useSession((s) => s.account);
  const door = useSession((s) => s.door);

  useEffect(() => {
    useSession.getState().hydrate();
    useSettings.getState().load();
  }, []);

  // The native splash stays until the fonts are in; then the mockup's opening
  // screen shows while the stored sign-in is read, long enough not to flash.
  const [shownLongEnough, setShownLongEnough] = useState(MIN_SPLASH_MS === 0);
  useEffect(() => {
    if (MIN_SPLASH_MS === 0) return undefined;
    const t = setTimeout(() => setShownLongEnough(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;
  if (!hydrated || !shownLongEnough) return <Splash />;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <VersionGate>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="index" />
            <Stack.Protected guard={!account && !door}>
              <Stack.Screen name="sign-in" />
              <Stack.Screen name="device-pin" />
            </Stack.Protected>
            <Stack.Protected guard={Boolean(account) && !door}>
              <Stack.Screen name="(account)" />
            </Stack.Protected>
            <Stack.Protected guard={Boolean(door)}>
              <Stack.Screen name="(door)" />
            </Stack.Protected>
            <Stack.Screen name="pair" />
            <Stack.Screen name="auth/callback" />
          </Stack>
        </VersionGate>
        {/* The app's own pop-ups (src/ui/Dialog.tsx), above every screen. */}
        <DialogHost />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/**
 * The last line of defence: a screen that throws while drawing. Without this,
 * the phone shows a blank screen at the door. Scans already taken are safe in
 * the phone's database, so "Try again" loses nothing. The error goes to crash
 * reporting (scrubbed), never on screen: it can carry guest data.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportError(error);
  }, [error]);
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: space.xl, gap: space.lg }}
      accessibilityRole="alert"
    >
      <Text variant="heading" align="center">Something went wrong</Text>
      <Text color={colors.muted} align="center">
        The app hit a problem showing this screen. Check-ins already scanned are saved on this phone.
      </Text>
      <Button label="Try again" onPress={() => { void retry(); }} />
    </View>
  );
}

/**
 * "Update required" — the server's lever for a change old builds cannot follow.
 * Offline, or when the config cannot be read, the app is NOT blocked: a door
 * without signal must still open.
 */
function VersionGate({ children }: { children: ReactNode }) {
  const { data } = useQuery({ queryKey: ['app-config'], queryFn: appConfig, staleTime: 3600_000, retry: 0 });
  const installed = Application.nativeApplicationVersion;
  const minimum = Platform.OS === 'ios' ? data?.minSupportedVersion.ios : data?.minSupportedVersion.android;
  if (!needsUpdate(installed, minimum)) return <>{children}</>;

  const store = Platform.OS === 'ios' ? data?.storeUrls.ios : data?.storeUrls.android;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: space.xl, gap: space.lg }}>
      <View style={{ alignItems: 'center' }}><ScannerLockup size={34} /></View>
      <Text variant="heading" align="center">Update required</Text>
      <Text color={colors.muted} align="center">
        This version of Eventsli Check-in ({installed}) can no longer scan. Update to {minimum} or later to keep working.
      </Text>
      {store && <Button label="Update now" onPress={() => Linking.openURL(store)} />}
    </View>
  );
}
