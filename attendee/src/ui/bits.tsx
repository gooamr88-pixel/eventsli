import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, radius, space } from './theme';

/**
 * The small pieces every screen shares: the header, the section title, a chip,
 * the heart, the stepper, and the three states a list can be in (loading,
 * failed, empty).
 */

// ─── Header ─────────────────────────────────────────────────────────────────

type HeaderProps = {
  title?: string;
  back?: boolean;
  right?: ReactNode;
  /** Large left-aligned title (Explore, My Tickets) instead of a centred one. */
  large?: boolean;
};

export function Header({ title, back = false, right, large = false }: HeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      {back ? (
        <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      ) : large ? null : <View style={styles.side} />}
      {title ? (
        <Text
          variant={large ? 'screenTitle' : 'title'}
          accessibilityRole="header"
          numberOfLines={1}
          style={large && !back ? styles.titleLarge : styles.titleCentre}
          align={large && !back ? 'left' : 'center'}
        >
          {title}
        </Text>
      ) : <View style={{ flex: 1 }} />}
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

export function IconButton({ icon, label, onPress, color = colors.text, filled }: {
  icon: IconName; label: string; onPress: () => void; color?: string; filled?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.bgSunken }]}
    >
      <Icon name={icon} size={22} color={color} fill={filled} />
    </Pressable>
  );
}

// ─── Section title ──────────────────────────────────────────────────────────

export function Section({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.section}>
      <Text variant="title" accessibilityRole="header">{title}</Text>
      {action && onAction ? (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={8} style={styles.sectionAction}>
          <Text variant="small" weight="semibold" color={colors.accent}>{action}</Text>
          <Icon name="arrow" size={16} color={colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Chip ───────────────────────────────────────────────────────────────────

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active ? styles.chipOn : styles.chipOff]}
    >
      <Text variant="small" weight="semibold" color={active ? colors.onAccent : colors.text}>{label}</Text>
    </Pressable>
  );
}

// ─── Heart ──────────────────────────────────────────────────────────────────

export function Heart({ saved, onPress, onDark = false }: { saved: boolean; onPress: () => void; onDark?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Remove from saved' : 'Save event'}
      accessibilityState={{ selected: saved }}
      onPress={onPress}
      hitSlop={10}
      style={[styles.heart, onDark ? styles.heartOnDark : styles.heartOnLight]}
    >
      <Icon name="heart" size={18} color={saved ? colors.coral500 : onDark ? colors.white : colors.text} fill={saved ? colors.coral500 : undefined} />
    </Pressable>
  );
}

// ─── Stepper ────────────────────────────────────────────────────────────────

export function Stepper({ value, min = 0, max, onChange, label }: {
  value: number; min?: number; max: number; onChange: (n: number) => void; label: string;
}) {
  return (
    <View style={styles.stepper} accessible accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment' && value < max) onChange(value + 1);
        if (e.nativeEvent.actionName === 'decrement' && value > min) onChange(value - 1);
      }}
    >
      <Pressable accessibilityElementsHidden importantForAccessibility="no" disabled={value <= min} onPress={() => onChange(value - 1)} hitSlop={8} style={[styles.stepButton, value <= min && styles.off]}>
        <Icon name="minus" size={18} />
      </Pressable>
      <Text variant="label" style={styles.stepValue} align="center">{value}</Text>
      <Pressable accessibilityElementsHidden importantForAccessibility="no" disabled={value >= max} onPress={() => onChange(value + 1)} hitSlop={8} style={[styles.stepButton, value >= max && styles.off]}>
        <Icon name="plus" size={18} />
      </Pressable>
    </View>
  );
}

// ─── States ─────────────────────────────────────────────────────────────────

export function Loading({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.state, style]} accessibilityLabel="Loading">
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function Failed({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.state}>
      <Icon name="alert" size={28} color={colors.muted} />
      <Text variant="body" color={colors.muted} align="center">{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function Empty({ icon, title, body, action, onAction }: {
  icon: IconName; title: string; body?: string; action?: string; onAction?: () => void;
}) {
  return (
    <View style={styles.state}>
      <View style={styles.emptyIcon}><Icon name={icon} size={28} color={colors.accent} /></View>
      <Text variant="title" align="center">{title}</Text>
      {body ? <Text variant="body" color={colors.muted} align="center">{body}</Text> : null}
      {action && onAction ? <Button label={action} onPress={onAction} style={{ alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    backgroundColor: colors.surface,
    gap: space.sm,
  },
  side: { minWidth: 40, alignItems: 'flex-start' },
  right: { alignItems: 'flex-end' },
  titleCentre: { flex: 1 },
  titleLarge: { flex: 1 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  chip: { paddingHorizontal: space.lg, minHeight: 36, borderRadius: radius.pill, justifyContent: 'center', borderWidth: 1 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipOff: { backgroundColor: colors.surface, borderColor: colors.border },
  heart: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  heartOnLight: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  heartOnDark: { backgroundColor: 'rgba(17,16,24,0.45)' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepButton: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  stepValue: { minWidth: 24 },
  off: { opacity: 0.35 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md, minHeight: 240 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.wash, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
});
