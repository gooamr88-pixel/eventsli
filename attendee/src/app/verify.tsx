import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { messageFor } from '@/api/client';
import { login, resendVerification, verifyEmail } from '@/api/endpoints';
import { usePendingSignUp } from '@/auth/pending';
import { useSession } from '@/auth/session';
import { Header } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/**
 * The 6-digit code from the email (POST /auth/verify-email), then the sign-in
 * it was standing in front of. The pending password is dropped either way
 * when this screen goes.
 */
export default function Verify() {
  const email = usePendingSignUp((s) => s.email);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => usePendingSignUp.getState().clear(), []);

  if (!email) {
    // Reached without a sign-up in progress (a restored route): nothing to confirm.
    return (
      <View style={styles.root}>
        <Header back />
        <View style={styles.body}>
          <Text variant="heading">Start again</Text>
          <Text variant="body" color={colors.muted}>Sign in, and we will send a new code if your email still needs confirming.</Text>
          <Button label="Sign In" onPress={() => router.replace('/sign-in')} />
        </View>
      </View>
    );
  }

  async function submit() {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) return setError('Enter the 6-digit code from the email.');
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(email as string, digits);
      const { password } = usePendingSignUp.getState();
      if (password) {
        const session = await login(email as string, password, Device.deviceName);
        await useSession.getState().signIn(session);
      } else {
        router.replace('/sign-in');
      }
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  async function resend() {
    setNote(null);
    try {
      await resendVerification(email as string);
      setNote('A new code is on its way.');
    } catch (err) {
      setError(messageFor(err));
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header back />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.icon}><Icon name="mail" size={30} color={colors.accent} /></View>
        <Text variant="display" accessibilityRole="header">Check your email</Text>
        <Text variant="body" color={colors.muted}>
          We sent a 6-digit code to <Text variant="body" weight="semibold">{email}</Text>.
        </Text>
        <Field
          label="Code"
          icon="key"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={9}
          returnKeyType="go"
          onSubmitEditing={() => { void submit(); }}
          error={error}
        />
        {note ? <Text variant="small" color={colors.success} accessibilityLiveRegion="polite">{note}</Text> : null}
        <Button label="Confirm" onPress={() => { void submit(); }} busy={busy} />
        <Button label="Send a new code" variant="ghost" onPress={() => { void resend(); }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: space.xl, gap: space.lg },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.wash, alignItems: 'center', justifyContent: 'center' },
});
