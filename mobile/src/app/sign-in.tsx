import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, Text as RNText, ScrollView, StyleSheet, useWindowDimensions, View,
  type TextInputInstance,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, messageFor } from '@/api/client';
import { passwordLogin } from '@/api/endpoints';
import { deviceLabel, signInWithEventsli, SignInCancelled, siteUrl } from '@/auth/pkce';
import { useSession } from '@/auth/session';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { ScannerMark, Wordmark } from '@/ui/ScannerMark';
import { ConcertScene, FooterBand, SignInWaves, SparkleRule } from '@/ui/SignInScene';
import { Text } from '@/ui/Text';
import { colors, fonts, space } from '@/ui/theme';

/**
 * Sign in, as the owner's mockup draws it (2026-11-17), in soft colours: the
 * mark and wordmark over "SCANNER", "Sign in to Eventsli Scanner" in front of a
 * faded concert, pill fields, the Sign In button and "Forgot password?" (the
 * website's reset page), then a blush-and-linen band at the foot carrying the
 * two other ways in: "Sign in with Eventsli" (the website, so Google and every
 * other way the site offers works) and a shared door tablet's PIN.
 */
export default function SignIn() {
  const setAccount = useSession((s) => s.setAccount);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'password' | 'eventsli' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const mark = Math.min(68, width * 0.17);
  const titleSize = Math.min(36, width * 0.088);
  const rule = Math.min(56, width * 0.13);

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
      <SignInWaves width={width} />
      <SafeAreaView style={styles.flex} edges={['top']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.brand} accessible accessibilityRole="image" accessibilityLabel="Eventsli Scanner">
              <View style={styles.lockup}>
                <View style={[styles.markRing, { borderRadius: mark * 0.24 }]}>
                  <ScannerMark size={mark} />
                </View>
                <View style={[styles.vline, { height: mark * 0.85 }]} />
                <Wordmark height={mark * 0.6} />
              </View>
              <View style={styles.tagRow}>
                <View style={[styles.hline, { width: rule }]} />
                <Text style={styles.tag}>SCANNER</Text>
                <View style={[styles.hline, { width: rule }]} />
              </View>
            </View>

            <View style={styles.intro}>
              {/* The concert behind the title, bleeding off the right edge. */}
              <View pointerEvents="none" style={[styles.scene, { width: width * 0.62, top: -width * 0.2 }]}>
                <ConcertScene width={width * 0.62} />
              </View>
              <Text style={[styles.title, { fontSize: titleSize, lineHeight: titleSize * 1.2 }]} accessibilityRole="header">
                {'Sign in to\n'}
                <RNText style={styles.titleAccent}>Eventsli</RNText>
                {' Scanner'}
              </Text>
              <Text color={colors.muted}>Secure access for event staff and organizers.</Text>
              <View style={styles.underline} />
            </View>

            <View style={styles.form}>
              <Field
                pill
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
                pill
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
              <Button
                pill
                icon="signIn"
                label="Sign In"
                onPress={withPassword}
                busy={busy === 'password'}
                disabled={busy === 'eventsli'}
                style={styles.submit}
              />

              <Pressable
                accessibilityRole="link"
                onPress={() => WebBrowser.openBrowserAsync(`${siteUrl()}/forgot-password`).catch(() => undefined)}
                hitSlop={8}
                style={styles.link}
              >
                <Text weight="semibold" color={colors.accent} align="center">Forgot password?</Text>
              </Pressable>
            </View>

            {/* The other two ways in, on the band at the foot of the screen. It
                is part of the scroll, so the keyboard never pushes it over the
                fields. */}
            <View style={[styles.footer, { minHeight: width * 0.5 + insets.bottom, paddingBottom: insets.bottom + space.xl }]}>
              <FooterBand width={width} />
              <SparkleRule />
              <View style={styles.other}>
                <Pressable accessibilityRole="button" onPress={busy ? undefined : withEventsli} hitSlop={8}>
                  <Text variant="small" weight="medium" color={colors.text}>
                    {busy === 'eventsli' ? 'Opening Eventsli…' : 'Sign in with Eventsli'}
                  </Text>
                </Pressable>
                <View style={styles.dot} />
                <Pressable accessibilityRole="link" onPress={() => router.push('/device-pin')} hitSlop={8}>
                  <Text variant="small" weight="medium" color={colors.text}>Shared door device</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingTop: space.xl, gap: space.xl },
  brand: { alignItems: 'center', gap: space.lg, marginTop: space.lg, paddingHorizontal: space.xl },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  // A faint yellow edge around the mark, as the mockup's tile has.
  markRing: {
    borderWidth: 1.5, borderColor: colors.sun200, padding: 1,
    shadowColor: colors.highlight, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  vline: { width: 1.5, backgroundColor: colors.text, opacity: 0.6 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  hline: { height: 1.5, backgroundColor: colors.text, opacity: 0.6 },
  // letterSpacing also trails the last letter, so the left pad re-centres it.
  tag: { fontFamily: fonts.semibold, fontSize: 14, letterSpacing: 9, paddingLeft: 9, color: colors.text },
  intro: { gap: space.md, paddingHorizontal: space.xl, paddingTop: space.lg },
  scene: { position: 'absolute', right: 0 },
  title: { fontFamily: fonts.displayBold, color: colors.text },
  // The brand's own coral (the sheet's #FF414B), softer than the button's. At
  // this size it is large text, which needs 3:1; it is 3.4:1 on white.
  titleAccent: { color: colors.coral500 },
  underline: { width: 52, height: 3, borderRadius: 2, backgroundColor: colors.coral300, marginTop: space.xs },
  form: { gap: space.lg, paddingHorizontal: space.xl },
  submit: { marginTop: space.xs },
  link: { paddingVertical: space.xs },
  footer: { marginTop: 'auto', justifyContent: 'flex-end', alignItems: 'center', gap: space.lg },
  other: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.md, flexWrap: 'wrap', paddingHorizontal: space.lg },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.highlight },
});
