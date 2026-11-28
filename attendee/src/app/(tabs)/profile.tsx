import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import { useTickets } from '@/hooks/useTickets';
import { IconButton, ListGroup, ListRow } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/layout';
import { Logo } from '@/ui/Logo';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/**
 * Profile — the mockup's last frame: the settings button, the picture, the
 * name and email, then My Tickets, Saved Events, Notifications, Preferences,
 * Help & Support, About Eventsli.
 *
 * The mockup's yellow "Premium Member" pill is kept, with true words in it:
 * Eventsli has no membership tier (2026-11-28, owner's choice), so it says
 * how many tickets this account has booked, or "Eventsli Member" before the
 * first one.
 */
export default function Profile() {
  const insets = useSafeAreaInsets();
  const user = useSession((s) => s.account?.user);
  const tickets = useTickets();
  const booked = (tickets.data ?? []).reduce((n, o) => n + o.tickets.filter((t) => !t.transferredAway).length, 0);
  const badge = booked ? `${booked} ${booked === 1 ? 'ticket' : 'tickets'} booked` : 'Eventsli Member';
  const initials = (user?.fullName || user?.email || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: space.xxl }} showsVerticalScrollIndicator={false}>
      <Container>
        <View style={styles.top}>
          <IconButton icon="settings" size={24} label="Settings" onPress={() => router.push('/settings')} />
        </View>

        {user ? (
          <View style={styles.who}>
            <View style={styles.avatar}><Text style={styles.initials} color={colors.onHighlight}>{initials}</Text></View>
            <Text variant="heading" align="center">{user.fullName || 'Your account'}</Text>
            <Text variant="body" color={colors.muted} align="center">{user.email}</Text>
            <View style={styles.badge}>
              <Icon name="star" size={15} color={colors.onHighlight} strokeWidth={2.2} />
              <Text variant="small" weight="bold" color={colors.onHighlight}>{badge}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.who}>
            <Logo height={30} />
            <Text variant="body" color={colors.muted} align="center" style={{ marginTop: space.md }}>Sign in to keep your tickets and saved events on every phone.</Text>
            <Button label="Sign In" onPress={() => router.push('/sign-in')} style={styles.cta} />
            <Button label="Create an account" variant="ghost" onPress={() => router.push('/sign-up')} />
          </View>
        )}

        <ListGroup style={{ marginTop: space.lg }}>
          {user ? <ListRow icon="calendar" label="My Tickets" onPress={() => router.push('/(tabs)/tickets')} /> : null}
          {user ? <ListRow icon="heart" label="Saved Events" onPress={() => router.push('/(tabs)/saved')} /> : null}
          {user ? <ListRow icon="bell" label="Notifications" onPress={() => router.push('/notifications')} /> : null}
          <ListRow icon="settings" label="Preferences" onPress={() => router.push('/settings')} />
          <ListRow icon="help" label="Help & Support" onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/contact`); }} />
          <ListRow icon="info" label="About Eventsli" onPress={() => { void WebBrowser.openBrowserAsync(SITE); }} />
        </ListGroup>
      </Container>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: space.sm },
  who: { alignItems: 'center', gap: 4 },
  avatar: { width: 108, height: 108, borderRadius: 54, backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
  initials: { fontFamily: 'DMSans_700Bold', fontSize: 38, lineHeight: 44 },
  cta: { alignSelf: 'stretch', marginTop: space.lg },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm, paddingHorizontal: space.lg, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.highlight },
});
