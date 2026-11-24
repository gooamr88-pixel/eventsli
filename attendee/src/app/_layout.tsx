import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';
import { Urbanist_700Bold } from '@expo-google-fonts/urbanist/700Bold';
import { Urbanist_900Black } from '@expo-google-fonts/urbanist/900Black';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import { lockLeftToRight } from '@/lib/ltr';
import { listenForPush, registerForPush } from '@/lib/push';
import { queryClient } from '@/lib/queryClient';
import { Button } from '@/ui/Button';
import { Logo } from '@/ui/Logo';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);
// English, left to right, even on an Arabic phone (lib/ltr.ts).
lockLeftToRight();

/**
 * The app's frame: fonts, the stored session, push, and the routes each state
 * of the phone may see.
 *
 *   first launch   the welcome screen (Get Started / Sign In)
 *   signed out     everything public — browse, event pages, even checkout as a
 *                  guest — plus sign in / sign up / verify
 *   signed in      the same, plus what is yours: tickets, saved, the inbox
 *
 * SCREENS CHANGE THE SESSION; THE GUARDS NAVIGATE. Signing in drops the
 * sign-in screens, and the stack lands back on whatever was underneath — the
 * event somebody was about to book. A screen that also called router.replace
 * after changing the session built the next screen twice (the check-in app
 * met exactly this on Android; mobile/src/app/_layout.tsx).
 */
export default function RootLayout() {
  const [fontsReady, fontError] = useFonts({
    DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, Urbanist_700Bold, Urbanist_900Black,
  });
  const fontsLoaded = fontsReady || Boolean(fontError);
  const hydrated = useSession((s) => s.hydrated);
  const account = useSession((s) => s.account);
  const onboarded = useSession((s) => s.onboarded);

  useEffect(() => {
    void useSession.getState().hydrate();
    return listenForPush();
  }, []);

  useEffect(() => {
    if (fontsLoaded && hydrated) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded, hydrated]);

  // Ask for push once there is an account to send it to.
  const token = account?.token;
  useEffect(() => {
    if (token) void registerForPush(token);
  }, [token]);

  if (!fontsLoaded || !hydrated) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
            <Stack.Screen name="index" />
            <Stack.Protected guard={!onboarded && !account}>
              <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
            </Stack.Protected>
            <Stack.Protected guard={!account}>
              <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
              <Stack.Screen name="sign-up" options={{ presentation: 'modal' }} />
              <Stack.Screen name="verify" options={{ presentation: 'modal' }} />
            </Stack.Protected>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="event/[slug]/index" />
            <Stack.Screen name="event/[slug]/tickets" />
            <Stack.Screen name="event/[slug]/seats" />
            <Stack.Screen name="checkout/[reservationId]" />
            <Stack.Screen name="checkout/confirmed" options={{ gestureEnabled: false, animation: 'fade' }} />
            <Stack.Screen name="ticket/[orderId]" />
            <Stack.Screen name="organizer/[slug]" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="city" options={{ presentation: 'modal' }} />
          </Stack>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/** A screen that throws while drawing: a way back rather than a blank screen. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: space.xl, gap: space.lg }}>
      <Logo height={28} />
      <Text variant="heading">Something went wrong</Text>
      <Text variant="body" color={colors.muted}>
        This screen could not be shown. Your tickets are safe — try again, or reopen the app.
      </Text>
      <Button label="Try again" onPress={() => { void retry(); }} />
    </View>
  );
}
