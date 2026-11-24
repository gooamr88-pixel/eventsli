import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { savedEventIds } from '@/api/endpoints';
import { useSession, useToken } from '@/auth/session';
import { isUpcoming, useTickets } from '@/hooks/useTickets';
import { IconButton, ListGroup, ListRow } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Container } from '@/ui/layout';
import { Logo } from '@/ui/Logo';
import { Text } from '@/ui/Text';
import { colors, radius, shadow, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/**
 * Profile (the mockup's last frame): who is signed in, what they have — the
 * tickets coming up, the events saved, the ones attended — and the way to
 * everything that is theirs. Signed out, the same list minus the personal
 * rows, and a Sign In.
 *
 * The mockup's "Premium Member" badge is left out: Eventsli has no membership
 * tier, and a badge for one would be a promise the product does not keep.
 */
export default function Profile() {
  const insets = useSafeAreaInsets();
  const account = useSession((s) => s.account);
  const token = useToken();
  const user = account?.user;
  const initials = (user?.fullName || user?.email || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const tickets = useTickets();
  const saved = useQuery({ queryKey: ['saved', 'ids'], queryFn: () => savedEventIds(token as string), enabled: Boolean(token), staleTime: 60_000 });

  const orders = tickets.data ?? [];
  const upcoming = orders.filter((o) => isUpcoming(o)).length;
  const attended = orders.filter((o) => !isUpcoming(o) && o.tickets.some((t) => t.scannedAt)).length;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: space.xxl }}>
      <Container style={{ gap: space.xl }}>
        <View style={styles.top}>
          <Text variant="screenTitle" accessibilityRole="header" style={{ flex: 1 }}>Profile</Text>
          <IconButton icon="settings" label="Settings" variant="outline" onPress={() => router.push('/settings')} />
        </View>

        {user ? (
          <Animated.View entering={FadeInDown.duration(260)} style={[styles.who, shadow.card]}>
            <View style={styles.avatarRing}>
              <View style={styles.avatar}><Text variant="display" color={colors.onHighlight}>{initials}</Text></View>
            </View>
            <Text variant="heading" align="center">{user.fullName || 'Your account'}</Text>
            <Text variant="small" color={colors.muted} align="center">{user.email}</Text>
            <View style={styles.stats}>
              <Stat n={upcoming} label="Upcoming" onPress={() => router.push('/(tabs)/tickets')} />
              <View style={styles.statRule} />
              <Stat n={saved.data?.length ?? 0} label="Saved" onPress={() => router.push('/(tabs)/saved')} />
              <View style={styles.statRule} />
              <Stat n={attended} label="Attended" />
            </View>
          </Animated.View>
        ) : (
          <View style={[styles.who, shadow.card]}>
            <Logo height={30} />
            <Text variant="title" align="center" style={{ marginTop: space.sm }}>Your events, in one place</Text>
            <Text variant="body" color={colors.muted} align="center">Sign in to keep your tickets, saved events and reminders on every phone.</Text>
            <Button label="Sign In" onPress={() => router.push('/sign-in')} style={styles.cta} />
            <Button label="Create an account" variant="ghost" onPress={() => router.push('/sign-up')} />
          </View>
        )}

        {user ? (
          <ListGroup title="Your stuff">
            <ListRow icon="ticket" label="My Tickets" detail={upcoming ? `${upcoming} upcoming` : undefined} onPress={() => router.push('/(tabs)/tickets')} />
            <ListRow icon="heart" label="Saved Events" onPress={() => router.push('/(tabs)/saved')} />
            <ListRow icon="bell" label="Notifications" onPress={() => router.push('/notifications')} />
          </ListGroup>
        ) : null}

        <ListGroup title="App">
          <ListRow icon="settings" label="Preferences" onPress={() => router.push('/settings')} />
          <ListRow icon="help" label="Help & Support" onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/contact`); }} />
          <ListRow icon="info" label="About Eventsli" onPress={() => { void WebBrowser.openBrowserAsync(SITE); }} />
        </ListGroup>

        <Text variant="caption" color={colors.subtle} align="center">Discover. Experience. Be There.</Text>
      </Container>
    </ScrollView>
  );
}

function Stat({ n, label, onPress }: { n: number; label: string; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={`${n} ${label}`} disabled={!onPress} onPress={onPress} style={styles.stat}>
      <Text variant="heading">{n}</Text>
      <Text variant="caption" color={colors.muted}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center' },
  who: { alignItems: 'center', gap: space.xs, padding: space.xl, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  avatarRing: { padding: 5, borderRadius: 60, borderWidth: 2, borderColor: colors.coral200, marginBottom: space.sm },
  avatar: { width: 92, height: 92, borderRadius: 46, backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', alignSelf: 'stretch', marginTop: space.lg, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.border },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statRule: { width: 1, backgroundColor: colors.border },
  cta: { alignSelf: 'stretch', marginTop: space.md },
});
