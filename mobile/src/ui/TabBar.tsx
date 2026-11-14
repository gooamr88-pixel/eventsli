import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dialog } from './Dialog';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, space } from './theme';

export type Tab = 'events' | 'scan' | 'logs' | 'profile';

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'events', label: 'Events', icon: 'home' },
  { key: 'scan', label: 'Scan', icon: 'scan' },
  { key: 'logs', label: 'Logs', icon: 'logs' },
  { key: 'profile', label: 'Profile', icon: 'user' },
];

/**
 * The mockup's bottom bar. Drawn by each top-level screen rather than being a
 * navigator of its own: where the phone may go is still decided by the
 * session (src/app/_layout.tsx), and the bar only moves within the group it
 * is in.
 *
 *   working a door   Events → the event's dashboard, Scan, Logs, Profile
 *   choosing one     Events → the list, Profile; Scan and Logs need an event
 */
export function TabBar({ active, mode }: { active: Tab; mode: 'door' | 'account' }) {
  const insets = useSafeAreaInsets();

  function go(tab: Tab) {
    if (tab === active) return;
    if (mode === 'account') {
      if (tab === 'events') router.navigate('/events');
      else if (tab === 'profile') router.navigate('/account');
      else {
        dialog.alert('Choose an event first', 'Open an event from My Events to scan tickets and see its check-in logs.', {
          icon: tab === 'scan' ? 'scan' : 'logs',
          button: 'Got it',
        });
      }
      return;
    }
    if (tab === 'events') router.navigate('/dashboard');
    else if (tab === 'scan') router.push('/scan');
    else if (tab === 'logs') router.navigate('/logs');
    else router.navigate('/settings');
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]} accessibilityRole="tablist">
      {TABS.map((t) => {
        const on = t.key === active;
        const color = on ? colors.accent : colors.muted;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
            onPress={() => go(t.key)}
            style={styles.tab}
          >
            <Icon name={t.icon} size={24} color={color} strokeWidth={on ? 2.2 : 1.8} />
            <Text variant="caption" weight={on ? 'semibold' : 'regular'} color={color}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.sm,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3, minHeight: 48, justifyContent: 'center' },
});
