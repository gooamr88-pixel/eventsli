import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, radius, shadow, space, tones, type Tone } from './theme';

/** A screen: safe area, the light background, optional scroll. */
export function Screen({
  children, scroll = false, style, edges = ['top', 'bottom'], footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.pad, style]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.pad, styles.flex, style]}>{children}</View>
      )}
      {footer && <View style={styles.footer}>{footer}</View>}
    </SafeAreaView>
  );
}

/** The header from the mockup: back arrow, centred title, one action on the right. */
export function Header({
  title, onBack, right, inverse = false,
}: {
  title: string;
  onBack?: (() => void) | null;
  right?: ReactNode;
  inverse?: boolean;
}) {
  const fg = inverse ? colors.white : colors.text;
  const back = onBack === undefined ? () => (router.canGoBack() ? router.back() : null) : onBack;
  return (
    <View style={styles.header}>
      <View style={styles.side}>
        {back && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            onPress={back}
            style={styles.iconButton}
          >
            <Icon name="back" size={24} color={fg} />
          </Pressable>
        )}
      </View>
      <Text variant="title" color={fg} numberOfLines={1} style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

export function IconButton({
  icon, label, onPress, color = colors.text, background,
}: { icon: IconName; label: string; onPress: () => void; color?: string; background?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={[styles.iconButton, background ? { backgroundColor: background, borderRadius: radius.pill } : null]}
    >
      <Icon name={icon} size={22} color={color} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A coloured status pill — "Live Check-in", "Offline", "Admitted". */
export function Pill({ label, tone = 'admit', dot = true }: { label: string; tone?: Tone; dot?: boolean }) {
  const t = tones[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.soft }]}>
      {dot && <View style={[styles.dot, { backgroundColor: t.strong }]} />}
      <Text variant="small" weight="semibold" color={t.fg}>{label}</Text>
    </View>
  );
}

/** A labelled row of facts: icon, then text. */
export function FactRow({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={20} color={colors.muted} />
      <View style={styles.flex}>{children}</View>
    </View>
  );
}

export function Empty({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Icon name={icon} size={28} color={colors.accent} /></View>
      <Text variant="title" align="center">{title}</Text>
      {body && <Text variant="small" color={colors.muted} align="center">{body}</Text>}
      {action}
    </View>
  );
}

export function Divider({ label }: { label?: string }) {
  return (
    <View style={styles.divider}>
      <View style={styles.rule} />
      {label && <Text variant="small" color={colors.subtle}>{label}</Text>}
      {label && <View style={styles.rule} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  pad: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.lg },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.md, paddingTop: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  side: { width: 48, justifyContent: 'center' },
  sideRight: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    ...shadow.card,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 6 },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.teal50,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.xs,
  },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
});
