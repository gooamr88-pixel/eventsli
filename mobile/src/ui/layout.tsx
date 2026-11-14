import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { eventPhase, initials, type EventPhase } from '../lib/format';

import { Backdrop } from './Backdrop';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, radius, shadow, space, tones, type Tone } from './theme';

/**
 * A screen in the mockup's style: the near-white background with mint waves
 * in the corner, the safe area, optional scroll, an optional footer (the
 * primary button) and an optional bottom bar (the tab bar).
 */
export function Screen({
  children, scroll = false, style, edges = ['top', 'bottom'], footer, bar, waves = 'top',
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  footer?: ReactNode;
  /** A tab bar: drawn under the footer, reaching the bottom edge itself. */
  bar?: ReactNode;
  waves?: 'top' | 'both' | 'none';
}) {
  const safe = bar ? edges.filter((e) => e !== 'bottom') : edges;
  return (
    <View style={styles.screen}>
      {waves !== 'none' && <Backdrop bottom={waves === 'both'} />}
      <SafeAreaView style={styles.flex} edges={safe}>
        {scroll ? (
          <ScrollView contentContainerStyle={[styles.pad, style]} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.pad, styles.flex, style]}>{children}</View>
        )}
        {footer && <View style={styles.footer}>{footer}</View>}
      </SafeAreaView>
      {bar}
    </View>
  );
}

/** The mockup's top row: a back chevron on the left, an optional centred title, one action on the right. */
export function Header({
  title = '', onBack, right, inverse = false,
}: {
  title?: string;
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
            <Icon name="chevronLeft" size={26} color={fg} strokeWidth={2.2} />
          </Pressable>
        )}
      </View>
      <Text variant="title" weight="semibold" color={fg} numberOfLines={1} style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

/** The big left-aligned title of a tab: My Events, Check-in Logs, Settings. */
export function ScreenTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={styles.screenTitle}>
      <Text variant="screenTitle" accessibilityRole="header" style={styles.flex}>{children}</Text>
      {right}
    </View>
  );
}

export function IconButton({
  icon, label, onPress, color = colors.text, background, size = 22,
}: { icon: IconName; label: string; onPress: () => void; color?: string; background?: string; size?: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={[styles.iconButton, background ? { backgroundColor: background, borderRadius: radius.pill } : null]}
    >
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A coloured status pill: "Offline Mode", "Ready". */
export function Pill({ label, tone = 'admit', dot = true }: { label: string; tone?: Tone; dot?: boolean }) {
  const t = tones[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.soft }]}>
      {dot && <View style={[styles.dot, { backgroundColor: t.strong }]} />}
      <Text variant="small" weight="semibold" color={t.fg}>{label}</Text>
    </View>
  );
}

/** A labelled row of facts inside a card: icon, then text (the answer screens). */
export function FactRow({ icon, children, iconColor = colors.muted }: { icon: IconName; children: ReactNode; iconColor?: string }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={22} color={iconColor} />
      <View style={styles.flex}>{children}</View>
    </View>
  );
}

/** A settings-style row: icon, label, an optional value, and a chevron. */
export function ListRow({
  icon, label, value, onPress, danger = false, last = false, hint,
}: {
  icon: IconName; label: string; value?: string; onPress: () => void; danger?: boolean; last?: boolean; hint?: string;
}) {
  const fg = danger ? colors.dangerGlyph : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowRule, pressed && styles.pressed]}
    >
      <Icon name={icon} size={22} color={danger ? colors.dangerGlyph : colors.muted} />
      <Text variant="body" weight="medium" color={fg} style={styles.flex}>{label}</Text>
      {value ? <Text variant="small" color={colors.muted}>{value}</Text> : null}
      {!danger && <Icon name="chevronRight" size={20} color={colors.muted} />}
    </Pressable>
  );
}

/** A row with a switch: the whole row is the control for a screen reader. */
export function ToggleRow({
  icon, label, hint, value, onChange, disabled = false, last = false,
}: {
  icon?: IconName; label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityHint={hint}
      onPress={disabled ? undefined : () => onChange(!value)}
      style={[styles.row, !last && styles.rowRule, disabled && styles.disabled]}
    >
      {icon && <Icon name={icon} size={22} color={colors.muted} />}
      <View style={[styles.flex, { gap: 2 }]}>
        <Text variant="body" weight="medium">{label}</Text>
        {hint ? <Text variant="caption" color={colors.muted}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.borderStrong }}
        thumbColor={colors.white}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

type Badge = 'success' | 'warning' | 'danger' | 'hold' | 'info';

const BADGES: Record<Badge, { icon: IconName; glyph: string; halo: string; disc?: string; ring?: boolean }> = {
  success: { icon: 'tick', glyph: colors.white, halo: colors.successHalo, disc: colors.successStrong },
  warning: { icon: 'history', glyph: colors.warningGlyph, halo: colors.warningHalo },
  danger: { icon: 'close', glyph: colors.dangerGlyph, halo: colors.dangerHalo, ring: true },
  hold: { icon: 'clock', glyph: colors.hold, halo: colors.holdSoft },
  info: { icon: 'offline', glyph: colors.accent, halo: colors.mint },
};

/**
 * The big round answer icon from the mockup: a white tick on a green disc for
 * an admission (with a little confetti), a strong glyph on a soft halo for
 * everything else.
 */
export function StatusIcon({ kind, icon }: { kind: Badge; icon?: IconName }) {
  const b = BADGES[kind];
  return (
    <View style={styles.badgeWrap} accessible={false}>
      {kind === 'success' && <Confetti />}
      <View style={[styles.halo, { backgroundColor: b.halo }]}>
        {b.disc ? (
          <View style={[styles.disc, { backgroundColor: b.disc }]}>
            <Icon name={icon ?? b.icon} size={40} color={b.glyph} strokeWidth={3.2} />
          </View>
        ) : b.ring ? (
          <View style={[styles.ring, { borderColor: b.glyph }]}>
            <Icon name={icon ?? b.icon} size={36} color={b.glyph} strokeWidth={2.8} />
          </View>
        ) : (
          <Icon name={icon ?? b.icon} size={60} color={b.glyph} strokeWidth={2.2} />
        )}
      </View>
    </View>
  );
}

function Confetti() {
  const bits: [number, number, string, number][] = [
    [-74, -30, '#f5b83d', 20], [70, -40, '#e5484d', -30], [-80, 22, '#3f9599', 0], [82, 14, '#3f9599', 45],
    [-44, -60, '#3f9599', 60], [46, -62, '#f5b83d', -20], [-58, 52, '#e5484d', 30], [60, 50, '#f5b83d', 10],
  ];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {bits.map(([x, y, c, r]) => (
        <View
          key={`${x}${y}`}
          style={[styles.bit, { backgroundColor: c, transform: [{ translateX: x }, { translateY: y }, { rotate: `${r}deg` }] }]}
        />
      ))}
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

/** A heading over a block of content, with an optional link on the right: "Recent Check-ins   View All". */
export function Section({
  title, action, children, style,
}: { title: string; action?: { label: string; onPress: () => void }; children?: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.sectionHead}>
        <Text variant="label" weight="bold" accessibilityRole="header" style={styles.flex}>{title}</Text>
        {action && (
          <Pressable accessibilityRole="link" onPress={action.onPress} hitSlop={10}>
            <Text variant="small" weight="semibold" color={colors.accent}>{action.label}</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

/** A round avatar: the person's initials on a soft teal, or a person glyph when there is no name. */
export function Avatar({ name, size = 40, tone = 'soft' }: { name?: string | null; size?: number; tone?: 'soft' | 'solid' }) {
  const letters = initials(name);
  const solid = tone === 'solid';
  return (
    <View
      accessible={false}
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: solid ? colors.accent : colors.mint,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {letters ? (
        <Text weight="bold" color={solid ? colors.white : colors.accent} style={{ fontSize: size * 0.38, lineHeight: size * 0.48 }}>
          {letters}
        </Text>
      ) : (
        <Icon name="user" size={size * 0.5} color={solid ? colors.white : colors.accent} strokeWidth={2} />
      )}
    </View>
  );
}

/** A label on the left and its value on the right, inside a card or a sheet. */
export function InfoRow({
  icon, label, value, last = false, valueColor = colors.text,
}: { icon?: IconName; label: string; value: ReactNode; last?: boolean; valueColor?: string }) {
  return (
    <View style={[styles.info, !last && styles.rowRule]}>
      {icon && <Icon name={icon} size={20} color={colors.muted} />}
      <Text variant="small" color={colors.muted} style={styles.infoLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text variant="body" weight="medium" color={valueColor} style={styles.infoValue}>{value}</Text>
      ) : (
        <View style={styles.infoValueBox}>{value}</View>
      )}
    </View>
  );
}

const PHASE: Record<EventPhase, { bg: string; fg: string; dot: string }> = {
  live: { bg: colors.successHalo, fg: colors.success, dot: colors.successStrong },
  soon: { bg: colors.warningHalo, fg: colors.warning, dot: colors.warningStrong },
  upcoming: { bg: colors.mint, fg: colors.accent, dot: colors.accent },
  ended: { bg: colors.bgSunken, fg: colors.muted, dot: colors.subtle },
};

/** "● Live now", "● Starts in 2 h", "● In 3 days", "● Finished". */
export function PhaseChip({ startsAt, endsAt, now }: { startsAt: string; endsAt?: string | null; now?: number }) {
  const { phase, label } = eventPhase(startsAt, endsAt, now);
  if (!label) return null;
  const p = PHASE[phase];
  return (
    <View style={[styles.chip, { backgroundColor: p.bg }]} accessibilityLabel={label}>
      <View style={[styles.chipDot, { backgroundColor: p.dot }]} />
      <Text variant="caption" weight="semibold" color={p.fg}>{label}</Text>
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
  pad: { paddingHorizontal: space.lg + 4, paddingBottom: space.lg, gap: space.lg },
  footer: { paddingHorizontal: space.lg + 4, paddingBottom: space.md, paddingTop: space.sm, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  side: { minWidth: 52, justifyContent: 'center' },
  sideRight: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center' },
  screenTitle: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingTop: space.md },
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
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.sm + 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm },
  rowRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  badgeWrap: { width: 200, height: 140, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  halo: { width: 116, height: 116, borderRadius: 58, alignItems: 'center', justifyContent: 'center' },
  disc: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 80, height: 80, borderRadius: 40, borderWidth: 3.5, alignItems: 'center', justifyContent: 'center' },
  bit: { position: 'absolute', left: 97, top: 67, width: 7, height: 3.5, borderRadius: 2 },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.mint,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.xs,
  },
  section: { gap: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  info: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 50, paddingVertical: space.sm },
  infoLabel: { flexShrink: 0, minWidth: 92 },
  infoValue: { flex: 1, textAlign: 'right' },
  infoValueBox: { flex: 1, alignItems: 'flex-end' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
});
