import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { messageFor } from '@/api/client';
import { register } from '@/api/endpoints';
import { usePendingSignUp } from '@/auth/pending';
import { Header } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/**
 * Create an attendee account (POST /auth/register). The API emails a 6-digit
 * code; the next screen takes it and then signs in with the password still in
 * memory. The password rules are the API's — its message is shown as sent,
 * rather than a second copy of the rules here that drifts.
 */
export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (name.trim().length < 2) return setError('Enter your name.');
    if (!email.trim()) return setError('Enter your email.');
    if (!password) return setError('Choose a password.');
    setBusy(true);
    setError(null);
    try {
      await register(name.trim(), email.trim(), password);
      usePendingSignUp.getState().set(email.trim(), password);
      router.replace('/verify');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header back />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.xs }}>
          <Text variant="display" accessibilityRole="header">Create account</Text>
          <Text variant="body" color={colors.muted}>Save events, get reminders, and keep every ticket in one place.</Text>
        </View>
        <Field label="Full name" icon="user" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
        <Field
          label="Email"
          icon="mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Field
          label="Password"
          icon="lock"
          secret
          value={password}
          onChangeText={setPassword}
          autoComplete="new-password"
          textContentType="newPassword"
          error={error}
        />
        <Button label="Create Account" onPress={() => { void submit(); }} busy={busy} />
        <Text variant="caption" color={colors.muted} align="center">
          By creating an account you agree to the{' '}
          <Text variant="caption" color={colors.accent} onPress={() => { void WebBrowser.openBrowserAsync('https://eventsli.com/terms'); }}>Terms</Text>
          {' '}and{' '}
          <Text variant="caption" color={colors.accent} onPress={() => { void WebBrowser.openBrowserAsync('https://eventsli.com/privacy'); }}>Privacy Policy</Text>.
        </Text>
        <Button label="I already have an account" variant="ghost" onPress={() => router.replace('/sign-in')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: space.xl, gap: space.lg },
});
