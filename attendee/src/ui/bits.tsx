import { router } from 'expo-router';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Container } from './layout';
import { haptic, Pressy } from './motion';
import { Text } from './Text';
import { colors, radius, space } from './theme';

/**
 * The small pieces every screen shares: the headers, the section title, a
 * chip, the heart, the stepper, the segmented switch, the settings-style list,
 * a badge, and the three states a list can be in (loading, failed, empty).
 */

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

// ─── Headers ────────────────────────────────────────────────────────────────

type HeaderProps = {
  title?: string;
  /** A second line under the title: the event a seat map is for. */
  subtitle?: string;
  back?: boolean;
  /** "close" for a modal (the city picker, sign-in). */
  backIcon?: 'back' | 'close';
  right?: ReactNode;
  /** Draw on whatever is behind (a cover photo) instead of white. */
  transparent?: boolean;
  border?: boolean;
};

/**
 * The pushed screen's bar: back on the left, the title centred, actions on
 * the right — the mockup's "‹ Seating Map ⎙". The title stays centred however
 * many actions there are, because both sides are the same width.
 */
export function Header({ title, subtitle, back = true, backIcon = 'back', right, transparent = false, border = false }: HeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.xs }, transparent ? styles.headerClear : styles.headerSolid, border && styles.headerBorder]}>
      <Container style={styles.headerRow}>
        <View style={styles.side}>
          {back ? <IconButton icon={backIcon === 'close' ? 'close' : 'chevronLeft'} label={backIcon === 'close' ? 'Close' : 'Back'} onPress={goBack} variant={transparent ? 'glass' : 'plain'} /> : null}
        </View>
        <View style={styles.headerTitle}>
          {title ? <Text variant="title" accessibilityRole="header" numberOfLines={1} align="center">{title}</Text> : null}
          {subtitle ? <Text variant="caption" color={colors.muted} numberOfLines={1} align="center">{subtitle}</Text> : null}
        </View>
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </Container>
    </View>
  );
}

/** A tab's big left-aligned title — Explore, My Tickets, Saved Events — with its actions. */
export function ScreenTitle({ title, right, style }: { title: string; right?: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.screenTitle, style]}>
      <Text variant="screenTitle" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>{title}</Text>
      {right}
    </View>
  );
}

type IconButtonProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  filled?: string;
  /** plain: bare; soft: a grey disc; glass: a dark disc for use over a photo. */
  variant?: 'plain' | 'soft' | 'glass' | 'outline';
  size?: number;
  disabled?: boolean;
};

export function IconButton({ icon, label, onPress, color, filled, variant = 'plain', size = 22, disabled = false }: IconButtonProps) {
  const ink = color ?? (variant === 'glass' ? colors.white : colors.text);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        variant === 'soft' && styles.iconSoft,
        variant === 'glass' && styles.iconGlass,
        variant === 'outline' && styles.iconOutline,
        pressed && (variant === 'glass' ? styles.iconGlassPressed : styles.iconPressed),
        disabled && styles.off,
      ]}
    >
      <Icon name={icon} size={size} color={ink} fill={filled} />
    </Pressable>
  );
}

// ─── Section title ──────────────────────────────────────────────────────────

export function Section({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: ViewStyle }) {
  return (
    <View style={[styles.section, style]}>
      <Text variant="title" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>{title}</Text>
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

export function Chip({ label, active, onPress, icon, dot }: {
  label: string; active: boolean; onPress: () => void; icon?: IconName;
  /** A colour swatch before the label: a ticket type on the seat map. */
  dot?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => { haptic.select(); onPress(); }}
      style={({ pressed }) => [styles.chip, active ? styles.chipOn : styles.chipOff, pressed && !active && styles.chipPressed]}
    >
      {dot ? <View style={[styles.chipDot, { backgroundColor: dot }]} /> : null}
      {icon ? <Icon name={icon} size={16} color={active ? colors.onAccent : colors.text} /> : null}
      <Text variant="small" weight="semibold" color={active ? colors.onAccent : colors.text}>{label}</Text>
    </Pressable>
  );
}

// ─── Heart ──────────────────────────────────────────────────────────────────

export function Heart({ saved, onPress, onDark = false, size = 38 }: { saved: boolean; onPress: () => void; onDark?: boolean; size?: number }) {
  return (
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Remove from saved' : 'Save event'}
      accessibilityState={{ selected: saved }}
      onPress={() => { haptic.tap(); onPress(); }}
      hitSlop={8}
      scale={0.85}
      style={[styles.heart, { width: size, height: size, borderRadius: size / 2 }, onDark ? styles.heartOnDark : styles.heartOnLight]}
    >
      <Icon name="heart" size={size * 0.47} color={saved ? colors.coral500 : onDark ? colors.white : colors.text} fill={saved ? colors.coral500 : undefined} />
    </Pressy>
  );
}

// ─── Stepper ────────────────────────────────────────────────────────────────

/** The mockup's "− 1 +": round buttons, the plus in coral while more can be added. */
export function Stepper({ value, min = 0, max, onChange, label }: {
  value: number; min?: number; max: number; onChange: (n: number) => void; label: string;
}) {
  const change = (n: number) => { haptic.select(); onChange(n); };
  const canAdd = value < max;
  return (
    <View style={styles.stepper} accessible accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: String(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment' && value < max) onChange(value + 1);
        if (e.nativeEvent.actionName === 'decrement' && value > min) onChange(value - 1);
      }}
    >
      <Pressable accessibilityElementsHidden importantForAccessibility="no" disabled={value <= min} onPress={() => change(value - 1)} hitSlop={8}
        style={({ pressed }) => [styles.stepButton, pressed && styles.iconPressed, value <= min && styles.off]}>
        <Icon name="minus" size={18} />
      </Pressable>
      <Text variant="label" weight="bold" style={styles.stepValue} align="center">{value}</Text>
      <Pressable accessibilityElementsHidden importantForAccessibility="no" disabled={!canAdd} onPress={() => change(value + 1)} hitSlop={8}
        style={({ pressed }) => [styles.stepButton, canAdd && styles.stepAdd, pressed && canAdd && { backgroundColor: colors.accentPressed }, !canAdd && styles.off]}>
        <Icon name="plus" size={18} color={canAdd ? colors.onAccent : colors.text} />
      </Pressable>
    </View>
  );
}

// ─── Segmented switch ───────────────────────────────────────────────────────

/** The mockup's "Upcoming (1) | Past". */
export function Segmented<T extends string>({ options, value, onChange, style }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; style?: ViewStyle;
}) {
  return (
    <View style={[styles.segment, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }}
            onPress={() => { if (!on) { haptic.select(); onChange(o.value); } }}
            style={[styles.segmentItem, on && styles.segmentOn]}>
            <Text variant="small" weight={on ? 'bold' : 'semibold'} color={on ? colors.onAccent : colors.muted}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Lists of rows (Settings, Profile) ──────────────────────────────────────

export function ListGroup({ children, title, style }: { children: ReactNode; title?: string; style?: ViewStyle }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[{ gap: space.sm }, style]}>
      {title ? <Text variant="overline" color={colors.muted} style={styles.groupTitle}>{title.toUpperCase()}</Text> : null}
      <View style={styles.group}>
        {rows.map((row, i) => (
          <Fragment key={row.key ?? i}>
            {i > 0 ? <View style={styles.rule} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

export function ListRow({ icon, label, detail, onPress, right, danger = false, chevron = true }: {
  icon: IconName; label: string; detail?: string; onPress?: () => void; right?: ReactNode; danger?: boolean; chevron?: boolean;
}) {
  const ink = danger ? colors.danger : colors.text;
  const body = (
    <>
      <View style={[styles.rowIcon, danger && { backgroundColor: colors.dangerSoft }]}>
        <Icon name={icon} size={19} color={danger ? colors.danger : colors.accent} />
      </View>
      <Text variant="label" weight="medium" color={ink} style={{ flex: 1 }} numberOfLines={1}>{label}</Text>
      {detail ? <Text variant="small" color={colors.muted} numberOfLines={1} style={styles.rowDetail}>{detail}</Text> : null}
      {right}
      {onPress && chevron && !right ? <Icon name="chevronRight" size={18} color={colors.subtle} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row} accessible accessibilityLabel={detail ? `${label}, ${detail}` : label}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={detail ? `${label}, ${detail}` : label} onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgSunken }]}>
      {body}
    </Pressable>
  );
}

// ─── Badge ──────────────────────────────────────────────────────────────────

export type Tone = 'accent' | 'dark' | 'highlight' | 'success' | 'muted' | 'glass';
const TONE: Record<Tone, { bg: string; fg: string }> = {
  accent: { bg: colors.accent, fg: colors.white },
  dark: { bg: colors.night, fg: colors.white },
  highlight: { bg: colors.highlight, fg: colors.onHighlight },
  success: { bg: colors.successSoft, fg: colors.success },
  muted: { bg: colors.bgSunken, fg: colors.muted },
  glass: { bg: 'rgba(17,16,24,0.55)', fg: colors.white },
};

export function Badge({ label, tone = 'accent', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = TONE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <Icon name={icon} size={12} color={t.fg} strokeWidth={2.2} /> : null}
      <Text variant="caption" weight="bold" color={t.fg} style={styles.badgeText}>{label}</Text>
    </View>
  );
}

// ─── States ─────────────────────────────────────────────────────────────────

export function Loading({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.state, style]} accessibilityLabel="Loading">
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

export function Failed({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.state}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.bgSunken }]}><Icon name="alert" size={30} color={colors.muted} /></View>
      <Text variant="title" align="center">Something went wrong</Text>
      <Text variant="body" color={colors.muted} align="center" style={styles.stateBody}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" icon="refresh" onPress={onRetry} /> : null}
    </Animated.View>
  );
}

export function Empty({ icon, title, body, action, onAction, secondary, onSecondary }: {
  icon: IconName; title: string; body?: string; action?: string; onAction?: () => void;
  secondary?: string; onSecondary?: () => void;
}) {
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.state}>
      <View style={styles.emptyRing}>
        <View style={styles.emptyIcon}><Icon name={icon} size={30} color={colors.accent} /></View>
      </View>
      <Text variant="title" align="center">{title}</Text>
      {body ? <Text variant="body" color={colors.muted} align="center" style={styles.stateBody}>{body}</Text> : null}
      {action && onAction ? <Button label={action} onPress={onAction} style={styles.stateButton} /> : null}
      {secondary && onSecondary ? <Button label={secondary} variant="ghost" onPress={onSecondary} /> : null}
    </Animated.View>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A thin rule between blocks of a card. */
export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[styles.rule, { marginLeft: 0 }, style]} />;
}

const styles = StyleSheet.create({
  header: { paddingBottom: space.xs, zIndex: 2 },
  headerSolid: { backgroundColor: colors.surface },
  headerClear: { position: 'absolute', left: 0, right: 0, top: 0 },
  headerBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  headerTitle: { flex: 1, alignItems: 'center', paddingHorizontal: space.xs },
  side: { width: 88, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end', gap: 2 },
  screenTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 },

  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  iconSoft: { backgroundColor: colors.bgSunken },
  iconGlass: { backgroundColor: 'rgba(17,16,24,0.45)' },
  iconOutline: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  iconPressed: { backgroundColor: colors.bgSunken },
  iconGlassPressed: { backgroundColor: 'rgba(17,16,24,0.7)' },

  section: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },

  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, minHeight: 38, borderRadius: radius.pill, borderWidth: 1 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipOff: { backgroundColor: colors.surface, borderColor: colors.border },
  chipPressed: { backgroundColor: colors.bgSunken },
  chipDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: colors.white },

  heart: { alignItems: 'center', justifyContent: 'center' },
  heartOnLight: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  heartOnDark: { backgroundColor: 'rgba(17,16,24,0.45)' },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepButton: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  stepAdd: { backgroundColor: colors.accent, borderColor: colors.accent },
  stepValue: { minWidth: 26 },
  off: { opacity: 0.35 },

  segment: { flexDirection: 'row', padding: 4, borderRadius: radius.pill, backgroundColor: colors.bgSunken },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.accent },

  groupTitle: { marginLeft: space.xs },
  group: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.surface },
  rule: { height: 1, backgroundColor: colors.border, marginLeft: 64 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 58, backgroundColor: colors.surface },
  rowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.coral50, alignItems: 'center', justifyContent: 'center' },
  rowDetail: { maxWidth: 170 },

  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontSize: 11, lineHeight: 14 },

  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md, minHeight: 260 },
  stateBody: { maxWidth: 360 },
  stateButton: { alignSelf: 'stretch', maxWidth: 360, width: '100%', marginTop: space.sm },
  emptyRing: { padding: 10, borderRadius: 60, backgroundColor: colors.coral50, marginBottom: space.xs },
  emptyIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.coral100, alignItems: 'center', justifyContent: 'center' },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg },
});
