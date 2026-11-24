import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { messageFor } from '@/api/client';
import { resendTickets } from '@/api/endpoints';
import { useSession } from '@/auth/session';
import { registerForPush } from '@/lib/push';
import { Header, ListGroup, ListRow } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/layout';
import { haptic } from '@/ui/motion';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/**
 * Settings (the mockup's Settings frame): the account, notifications, the
 * city, privacy and help, and Log Out.
 *
 * The notifications switch reflects the PHONE's permission, because that is
 * the switch that actually decides it. Once the system has been asked and
 * said no, only the system's settings can turn it back on — so that is where
 * the switch sends you, rather than pretending to flip something it cannot.
 *
 * The mockup's Language and Appearance rows: the app is English and light
 * only (the owner's decision for 1.0), so Language says so and is not a
 * picker, and Appearance is left out rather than offering one choice.
 */
export default function Settings() {
  const account = useSession((s) => s.account);
  const city = useSession((s) => s.city);
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [resendOpen, setResendOpen] = useState(false);

  useEffect(() => {
    Notifications.getPermissionsAsync().then((p) => setPushOn(p.granted)).catch(() => setPushOn(false));
  }, []);

  async function togglePush() {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted || !p.canAskAgain) {
      void Linking.openSettings();
      return;
    }
    if (account) await registerForPush(account.token);
    setPushOn((await Notifications.getPermissionsAsync()).granted);
  }

  const logOut = () => {
    Alert.alert('Log out?', 'Your tickets stay safe in your account. Sign in again to see them on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => { void useSession.getState().signOut(); router.back(); } },
    ]);
  };

  return (
    <View style={styles.root}>
      <Header title="Settings" />
      <ScrollView contentContainerStyle={{ paddingVertical: space.lg }}>
        <Container style={{ gap: space.xl }}>
          {account ? (
            <ListGroup title="Account">
              <ListRow icon="user" label="Account Information" detail={account.user.email} onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/account`); }} />
              <ListRow icon="key" label="Change password" onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/forgot-password`); }} />
            </ListGroup>
          ) : null}

          <ListGroup title="Preferences">
            <ListRow
              icon="bell"
              label="Notifications"
              right={(
                <Switch
                  value={Boolean(pushOn)}
                  onValueChange={() => { haptic.select(); void togglePush(); }}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  thumbColor={colors.white}
                  accessibilityLabel="Push notifications"
                />
              )}
            />
            <ListRow icon="pin" label="Location" detail={city ? `${city.city}, ${city.country}` : 'Everywhere'} onPress={() => router.push('/city')} />
            <ListRow icon="globe" label="Language" detail="English" />
          </ListGroup>

          <ListGroup title="Support">
            <ListRow icon="mail" label="Resend my tickets" onPress={() => setResendOpen(true)} />
            <ListRow icon="shield" label="Privacy & Security" onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/privacy`); }} />
            <ListRow icon="fileText" label="Terms of Service" onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/terms`); }} />
            <ListRow icon="help" label="Help & Support" onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/contact`); }} />
            <ListRow icon="info" label="About Eventsli" detail={`Version ${Application.nativeApplicationVersion ?? '1.0.0'}`} onPress={() => { void WebBrowser.openBrowserAsync(SITE); }} />
          </ListGroup>

          {account ? (
            <ListGroup>
              <ListRow icon="signOut" label="Log Out" danger chevron={false} onPress={logOut} />
            </ListGroup>
          ) : (
            <Button label="Sign In" onPress={() => router.push('/sign-in')} />
          )}
        </Container>
      </ScrollView>
      <ResendSheet visible={resendOpen} onClose={() => setResendOpen(false)} defaultEmail={account?.user.email ?? ''} />
    </View>
  );
}

/**
 * "I lost the email." The API sends to the address ON THE ORDER, never to one
 * typed here, and answers the same either way — so the reply cannot be used
 * to learn who bought what.
 */
function ResendSheet({ visible, onClose, defaultEmail }: { visible: boolean; onClose: () => void; defaultEmail: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const close = () => { onClose(); setSent(false); setError(null); };

  async function send() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter the email you bought with.'); return; }
    setBusy(true);
    setError(null);
    try {
      await resendTickets(email.trim());
      haptic.success();
      setSent(true);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={sent ? 'Check your inbox' : 'Resend my tickets'}
      footer={sent ? <Button label="Done" onPress={close} /> : <Button label="Send" icon="send" busy={busy} onPress={() => { void send(); }} />}
    >
      {sent ? (
        <View style={styles.sent}>
          <Icon name="mail" size={28} color={colors.accent} />
          <Text variant="body" color={colors.muted} align="center">If there are tickets bought with {email.trim()}, they are on their way. It can take a minute.</Text>
        </View>
      ) : (
        <>
          <Text variant="body" color={colors.muted}>We will email every ticket bought with this address — handy if you booked as a guest.</Text>
          <Field label="Email you bought with" icon="mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={error} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  sent: { alignItems: 'center', gap: space.md, paddingVertical: space.md },
});
