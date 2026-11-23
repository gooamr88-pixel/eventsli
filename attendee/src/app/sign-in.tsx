import * as Device from 'expo-device';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInputInstance } from 'react-native';

import { ApiError, messageFor } from '@/api/client';
import { login, resendVerification } from '@/api/endpoints';
import { usePendingSignUp } from '@/auth/pending';
import { useSession } from '@/auth/session';
import { Header } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Logo } from '@/ui/Logo';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

const FORGOT_URL = 'https://eventsli.com/forgot-password';

/**
 * Email and password (POST /auth/app/login with app: 'attendee'). Success
 * changes the session and nothing else: the guard closes this modal and the
 * person is back where they were — usually an event they were about to save
 * or book.
 *
 * An unconfirmed account (EMAIL_NOT_VERIFIED) goes to the code screen with the
 * password still in memory, so confirming finishes the sign-in.
 */
export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  async function submit() {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await login(email.trim(), password, Device.deviceName);
      await useSession.getState().signIn(session);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        usePendingSignUp.getState().set(email.trim(), password);
        resendVerification(email.trim()).catch(() => undefined);
        router.push('/verify');
      } else {
        setError(messageFor(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header back />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Logo height={30} />
        <View style={{ gap: space.xs }}>
          <Text variant="display" accessibilityRole="header">Welcome back</Text>
          <Text variant="body" color={colors.muted}>Sign in to see your tickets and saved events.</Text>
        </View>
        <Field
          label="Email"
          icon="mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
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
          onSubmitEditing={() => { void submit(); }}
          error={error}
        />
        <Button label="Sign In" onPress={() => { void submit(); }} busy={busy} />
        <Button label="Forgot password?" variant="ghost" onPress={() => { void WebBrowser.openBrowserAsync(FORGOT_URL); }} />
        <View style={styles.switch}>
          <Text variant="small" color={colors.muted}>New to Eventsli?</Text>
          <Button label="Create an account" variant="ghost" onPress={() => router.replace('/sign-up')} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: space.xl, gap: space.lg },
  switch: { alignItems: 'center' },
});
