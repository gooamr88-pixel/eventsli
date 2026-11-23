import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import { Button } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { Logo } from '@/ui/Logo';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/**
 * Profile (the mockup's last frame): who is signed in, and the way to
 * everything that is theirs. Signed out, the same list minus the personal
 * rows, and a Sign In.
 *
 * The mockup's "Premium Member" badge is left out: Eventsli has no membership
 * tier, and a badge for one would be a promise the product does not keep.
 */
export default function Profile() {
  const insets = useSafeAreaInsets();
  const account = useSession((s) => s.account);
  const user = account?.user;
  const initials = (user?.fullName || user?.email || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + space.lg }]}>
      {user ? (
        <View style={styles.who}>
          <View style={styles.avatar}><Text variant="heading" color={colors.onHighlight}>{initials}</Text></View>
          <Text variant="heading" align="center">{user.fullName || 'Your account'}</Text>
          <Text variant="small" color={colors.muted} align="center">{user.email}</Text>
        </View>
      ) : (
        <View style={styles.who}>
          <Logo height={30} />
          <Text variant="body" color={colors.muted} align="center">Sign in to keep your tickets, saved events and reminders on every phone.</Text>
          <Button label="Sign In" onPress={() => router.push('/sign-in')} style={{ alignSelf: 'stretch' }} />
          <Button label="Create an account" variant="ghost" onPress={() => router.push('/sign-up')} />
        </View>
      )}

      <View style={styles.list}>
        {user ? (
          <>
            <Row icon="ticket" label="My Tickets" onPress={() => router.push('/(tabs)/tickets')} />
            <Row icon="heart" label="Saved Events" onPress={() => router.push('/(tabs)/saved')} />
            <Row icon="bell" label="Notifications" onPress={() => router.push('/notifications')} />
          </>
        ) : null}
        <Row icon="settings" label="Preferences" onPress={() => router.push('/settings')} />
        <Row icon="help" label="Help & Support" onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/contact`); }} />
        <Row icon="info" label="About Eventsli" onPress={() => { void WebBrowser.openBrowserAsync(SITE); }} />
      </View>
    </ScrollView>
  );
}

function Row({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgSunken }]}>
      <Icon name={icon} size={22} color={colors.text} />
      <Text variant="label" style={{ flex: 1 }}>{label}</Text>
      <Icon name="chevronRight" size={18} color={colors.subtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  who: { alignItems: 'center', gap: space.sm },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
});
