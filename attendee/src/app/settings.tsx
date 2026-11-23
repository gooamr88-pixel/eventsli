import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { useSession } from '@/auth/session';
import { registerForPush } from '@/lib/push';
import { Header } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/**
 * Settings (the mockup's Settings frame): the account, notifications, the
 * city, privacy and help, and Log Out.
 *
 * The notifications switch reflects the PHONE's permission, because that is
 * the switch that actually decides it. Once the system has been asked and
 * said no, only the system's settings can turn it back on — so that is where
 * the switch sends you, rather than pretending to flip something it cannot.
 */
export default function Settings() {
  const account = useSession((s) => s.account);
  const city = useSession((s) => s.city);
  const [pushOn, setPushOn] = useState<boolean | null>(null);

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

  return (
    <View style={styles.root}>
      <Header title="Settings" back />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.group}>
          {account ? <Row icon="user" label="Account Information" detail={account.user.email} onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/account`); }} /> : null}
          <View style={styles.row}>
            <Icon name="bell" size={22} />
            <Text variant="label" style={{ flex: 1 }}>Notifications</Text>
            <Switch
              value={Boolean(pushOn)}
              onValueChange={() => { void togglePush(); }}
              trackColor={{ true: colors.accent, false: colors.border }}
              accessibilityLabel="Push notifications"
            />
          </View>
          <Row icon="pin" label="Location" detail={city ? `${city.city}, ${city.country}` : 'Everywhere'} onPress={() => router.push('/city')} />
          <Row icon="shield" label="Privacy & Security" onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/privacy`); }} />
          <Row icon="help" label="Help & Support" onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/contact`); }} />
          <Row icon="info" label="About Eventsli" detail={`Version ${Application.nativeApplicationVersion ?? '1.0.0'}`} onPress={() => { void WebBrowser.openBrowserAsync(SITE); }} />
        </View>

        {account ? (
          <Button label="Log Out" variant="ghost" icon="signOut" onPress={() => { void useSession.getState().signOut(); router.back(); }} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ icon, label, detail, onPress }: { icon: IconName; label: string; detail?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgSunken }]}>
      <Icon name={icon} size={22} />
      <Text variant="label" style={{ flex: 1 }}>{label}</Text>
      {detail ? <Text variant="caption" color={colors.muted} numberOfLines={1} style={{ maxWidth: 160 }}>{detail}</Text> : null}
      <Icon name="chevronRight" size={18} color={colors.subtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg, gap: space.xl },
  group: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.border },
});
