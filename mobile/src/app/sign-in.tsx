import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, messageFor } from '@/api/client';
import { passwordLogin } from '@/api/endpoints';
import { deviceLabel, signInWithEventsli, SignInCancelled, siteUrl } from '@/auth/pkce';
import { useSession } from '@/auth/session';
import { Backdrop } from '@/ui/Backdrop';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { ScannerLockup } from '@/ui/ScannerMark';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/**
 * Sign in, as the mockup draws it: the lockup, "Sign in to Eventsli Scanner",
 * email and password, and "Forgot password?" (the website's reset page).
 *
 * Two ways in that the mockup does not draw are kept as quiet links under it:
 * "Sign in with Eventsli" (the website, so Google and every other way the site
 * offers works), and a shared door tablet's PIN.
 */
export default function SignIn() {
  const setAccount = useSession((s) => s.setAccount);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'password' | 'eventsli' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  async function withPassword() {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy('password');
    setError(null);
    try {
      const session = await passwordLogin(email.trim(), password, deviceLabel());
      // The session moves the phone to its events (see src/app/_layout.tsx).
      await setAccount(session);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED'
        ? 'Confirm your email first — we sent you a code. Then sign in here.'
        : messageFor(err));
    } finally {
      setBusy(null);
    }
  }

  async function withEventsli() {
    setBusy('eventsli');
    setError(null);
    try {
      const session = await signInWithEventsli();
      await setAccount(session);
    } catch (err) {
      if (!(err instanceof SignInCancelled)) setError(err instanceof Error ? err.message : messageFor(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.screen}>
      <Backdrop />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.brand}>
              <ScannerLockup size={30} />
            </View>

            <View style={styles.intro}>
              <Text style={styles.title} accessibilityRole="header">{'Sign in to\nEventsli Scanner'}</Text>
              <Text color={colors.muted}>Secure access for event staff and organizers.</Text>
            </View>

            <View style={styles.form}>
              <Field
                label="Email"
                icon="mail"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="username"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <Field
                ref={passwordRef}
                label="Password"
                icon="lock"
                secret
                value={password}
                onChangeText={setPassword}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={withPassword}
              />
              {error && (
                <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text>
              )}
              <Button label="Sign In" onPress={withPassword} busy={busy === 'password'} disabled={busy === 'eventsli'} style={styles.submit} />

              <Pressable
                accessibilityRole="link"
                onPress={() => WebBrowser.openBrowserAsync(`${siteUrl()}/forgot-password`).catch(() => undefined)}
                hitSlop={8}
                style={styles.link}
              >
                <Text variant="small" weight="semibold" color={colors.accent} align="center">Forgot password?</Text>
              </Pressable>
            </View>
          </ScrollView>

          <View style={styles.other}>
            <Pressable accessibilityRole="button" onPress={busy ? undefined : withEventsli} hitSlop={8}>
              <Text variant="caption" weight="semibold" color={colors.accent}>
                {busy === 'eventsli' ? 'Opening Eventsli…' : 'Sign in with Eventsli'}
              </Text>
            </Pressable>
            <Text variant="caption" color={colors.subtle}>·</Text>
            <Pressable accessibilityRole="link" onPress={() => router.push('/device-pin')} hitSlop={8}>
              <Text variant="caption" weight="semibold" color={colors.accent}>Shared door device</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.xl, paddingTop: space.xxl, paddingBottom: space.xl, gap: space.xl },
  brand: { alignItems: 'center', marginTop: space.lg, marginBottom: space.lg },
  intro: { gap: space.sm },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 28, lineHeight: 34, color: colors.text },
  form: { gap: space.md },
  submit: { marginTop: space.sm },
  link: { paddingVertical: space.sm },
  other: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.sm, paddingBottom: space.lg },
});
