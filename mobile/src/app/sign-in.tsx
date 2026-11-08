import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, messageFor } from '@/api/client';
import { passwordLogin } from '@/api/endpoints';
import { deviceLabel, signInWithEventsli, SignInCancelled } from '@/auth/pkce';
import { useSession } from '@/auth/session';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Divider } from '@/ui/layout';
import { Logo, Mark } from '@/ui/Logo';
import { Skyline } from '@/ui/Skyline';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/**
 * Sign in — the first screen of the mockup.
 *
 * Two ways in for a PERSON: a password, or "Sign in with Eventsli", which
 * opens eventsli.com in the system browser so Google and every other way the
 * site offers works too. A shared door tablet uses neither — it is paired with
 * a device code and a PIN, below.
 */
export default function SignIn() {
  const { width } = useWindowDimensions();
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
      await setAccount(session);
      router.replace('/events');
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
      router.replace('/events');
    } catch (err) {
      if (!(err instanceof SignInCancelled)) setError(err instanceof Error ? err.message : messageFor(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Logo height={34} tagline />
          </View>

          <View style={styles.intro}>
            <Text variant="heading" align="center" accessibilityRole="header">Event Check-in</Text>
            <Text color={colors.muted} align="center">
              Scan tickets, verify attendees, and manage entry in real time.
            </Text>
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
            <Button label="Sign In" onPress={withPassword} busy={busy === 'password'} disabled={busy === 'eventsli'} />

            <Divider label="or" />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in with Eventsli"
              onPress={busy ? undefined : withEventsli}
              style={({ pressed }) => [styles.eventsli, pressed && { backgroundColor: colors.teal50 }]}
            >
              <Mark size={22} />
              <Text variant="label">{busy === 'eventsli' ? 'Opening Eventsli…' : 'Sign in with Eventsli'}</Text>
            </Pressable>

            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/device-pin')}
              hitSlop={8}
              style={styles.link}
            >
              <Text variant="small" color={colors.accent} weight="semibold" align="center">
                Using a shared door device? Sign in with its PIN
              </Text>
            </Pressable>
          </View>
        </ScrollView>
        <View pointerEvents="none" style={styles.skyline}>
          <Skyline width={width} height={140} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.xl, paddingTop: space.xxl, paddingBottom: 150, gap: space.xl },
  brand: { alignItems: 'center', marginTop: space.lg },
  intro: { gap: space.sm, marginTop: space.md },
  form: { gap: space.md },
  eventsli: {
    minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  link: { paddingVertical: space.md },
  skyline: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
