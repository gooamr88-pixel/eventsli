import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { useLayout } from './layout';
import { Logo } from './Logo';
import { haptic } from './motion';
import { Text } from './Text';
import { colors, radius, space } from './theme';

/** Home, Explore, Saved, Tickets, Profile — the mockup's tab bar. */
export const TAB_ICONS: Record<string, IconName> = {
  index: 'home',
  explore: 'compass',
  saved: 'heart',
  tickets: 'ticket',
  profile: 'user',
};

/**
 * THE TAB BAR, two ways.
 *
 * A phone gets the mockup's bar: five icons with their names, the current one
 * in coral on a soft coral pill so it reads at a glance and not by colour
 * alone (the label turns bold too). A wide screen — a tablet held sideways, a
 * browser — gets the same five as a rail down the left with the logo on top,
 * because a bar stretched across 1,300 points puts Home and Profile a hand's
 * width apart.
 *
 * A press emits `tabPress` before navigating, exactly as the stock bar does,
 * so anything listening (scroll-to-top on a second tap) still works.
 */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { wide } = useLayout();

  const items = state.routes.map((route, index) => {
    const focused = index === state.index;
    const { options } = descriptors[route.key];
    const label = typeof options.title === 'string' ? options.title : route.name;
    const icon = TAB_ICONS[route.name] ?? 'home';
    const onPress = () => {
      const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) {
        haptic.select();
        navigateToTab(route.key);
      }
    };
    return { key: route.key, focused, label, icon, onPress, badge: options.tabBarBadge };
  });

  if (wide) {
    return (
      <View style={[styles.rail, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg }]} accessibilityRole="tablist">
        <View style={styles.railLogo}><Logo height={28} /></View>
        {items.map((it) => (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: it.focused }}
            accessibilityLabel={it.label}
            onPress={it.onPress}
            style={({ pressed }) => [styles.railItem, it.focused && styles.railItemOn, pressed && !it.focused && styles.railPressed]}
          >
            <Icon name={it.icon} size={22} color={it.focused ? colors.accent : colors.muted} />
            <Text variant="label" weight={it.focused ? 'bold' : 'medium'} color={it.focused ? colors.accent : colors.text}>{it.label}</Text>
            {it.badge ? <View style={styles.railBadge}><Text variant="caption" weight="bold" color={colors.white}>{String(it.badge)}</Text></View> : null}
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]} accessibilityRole="tablist">
      {items.map((it) => (
        <Pressable
          key={it.key}
          accessibilityRole="tab"
          accessibilityState={{ selected: it.focused }}
          accessibilityLabel={it.label}
          onPress={it.onPress}
          style={styles.item}
          hitSlop={4}
        >
          <View style={styles.pill}>
            <Icon name={it.icon} size={25} color={it.focused ? colors.accent : colors.text} strokeWidth={it.focused ? 2.1 : 1.7} />
            {it.badge ? <View style={styles.dot} /> : null}
          </View>
          <Text variant="caption" weight={it.focused ? 'bold' : 'medium'} color={it.focused ? colors.accent : colors.text} style={styles.label} numberOfLines={1}>
            {it.label}
          </Text>
          {/* The owner's design (2026-11-28): a red underline under the current tab. */}
          <View style={[styles.under, it.focused && styles.underOn]} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Flat and white with a hairline on top, as the mockup's bar.
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingTop: space.sm,
    paddingHorizontal: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: colors.border,
  },
  item: { flex: 1, alignItems: 'center', gap: 2, minHeight: 48 },
  pill: { width: 48, height: 28, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 4, right: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.coral500, borderWidth: 1.5, borderColor: colors.surface },
  label: { fontSize: 12 },
  under: { width: 44, height: 3, borderRadius: 2, marginTop: 3 },
  underOn: { backgroundColor: colors.accent },
  rail: {
    width: 220,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: space.md,
    gap: space.xs,
  },
  railLogo: { paddingHorizontal: space.md, marginBottom: space.xl },
  railItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.md },
  railItemOn: { backgroundColor: colors.coral50 },
  railPressed: { backgroundColor: colors.bgSunken },
  railBadge: { marginLeft: 'auto', minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
