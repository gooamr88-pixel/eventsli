import { router } from 'expo-router';
import { Children, Fragment, isValidElement, useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Container } from './layout';
import { haptic, Pressy } from './motion';
import { Text } from './Text';
import { colors, radius, space } from './theme';

/**
 * The small pieces every screen shares, drawn as the app mockup draws them:
 * flat and white — no boxes around lists, no borders around cards, soft grey
 * only for the quiet controls (an unchosen chip, the stepper, the search).
 */

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

// ─── Headers ────────────────────────────────────────────────────────────────

type HeaderProps = {
  title?: string;
  subtitle?: string;
  back?: boolean;
  backIcon?: 'back' | 'close';
  right?: ReactNode;
  /** Draw on whatever is behind (a cover photo) instead of white. */
  transparent?: boolean;
  border?: boolean;
};

/**
 * The mockup's "‹  Seating Map  ⎙": a bare chevron, the title centred in
 * bold, one action on the right. Over a photo the chevron is white.
 */
export function Header({ title, subtitle, back = true, backIcon = 'back', right, transparent = false, border = false }: HeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.xs }, transparent ? styles.headerClear : styles.headerSolid, border && styles.headerBorder]}>
      <Container style={styles.headerRow}>
        <View style={styles.side}>
          {back ? (
            <IconButton
              icon={backIcon === 'close' ? 'close' : 'chevronLeft'}
              label={backIcon === 'close' ? 'Close' : 'Back'}
              onPress={goBack}
              size={26}
              variant={transparent ? 'glass' : 'plain'}
            />
          ) : null}
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

/** A tab's big left-aligned title — "Explore" — with its action. */
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
  /** plain: bare; soft: a grey disc; glass: a dark disc over a photo; outline: a white disc. */
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
      hitSlop={8}
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

/** "Explore Categories          See all →" */
export function Section({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: ViewStyle }) {
  return (
    <View style={[styles.section, style]}>
      <Text variant="title" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>{title}</Text>
      {action && onAction ? (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={10} style={styles.sectionAction}>
          <Text variant="small" weight="bold">{action}</Text>
          <Icon name="arrow" size={16} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Chip ───────────────────────────────────────────────────────────────────

/** The mockup's filter chips: coral when chosen, soft grey when not — no outline. */
export function Chip({ label, active, onPress, icon, dot }: {
  label: string; active: boolean; onPress: () => void; icon?: IconName; dot?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => { haptic.select(); onPress(); }}
      style={({ pressed }) => [styles.chip, active ? styles.chipOn : styles.chipOff, pressed && !active && { opacity: 0.7 }]}
    >
      {dot ? <View style={[styles.chipDot, { backgroundColor: dot }]} /> : null}
      {icon ? <Icon name={icon} size={15} color={active ? colors.onAccent : colors.text} /> : null}
      <Text variant="small" weight="semibold" color={active ? colors.onAccent : colors.text}>{label}</Text>
    </Pressable>
  );
}

// ─── Heart ──────────────────────────────────────────────────────────────────

/** A white disc with the heart, red when saved — the mockup's event page. It pops when saved. */
export function Heart({ saved, onPress, onDark = false, size = 40 }: { saved: boolean; onPress: () => void; onDark?: boolean; size?: number }) {
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
      <HeartIcon saved={saved} size={size * 0.5} idle={onDark ? colors.white : colors.text} />
    </Pressy>
  );
}

/** The heart glyph, which springs up and settles the moment it turns red. */
export function HeartIcon({ saved, size, idle = colors.text }: { saved: boolean; size: number; idle?: string }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  const was = useRef(saved);
  useEffect(() => {
    if (saved && !was.current && !reduce) {
      s.set(withSequence(withSpring(1.35, { damping: 6, stiffness: 400 }), withSpring(1, { damping: 10, stiffness: 300 })));
    }
    was.current = saved;
  }, [saved, reduce, s]);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: s.get() }] }));
  return (
    <Animated.View style={pop}>
      <Icon name="heart" size={size} color={saved ? colors.accent : idle} fill={saved ? colors.accent : undefined} />
    </Animated.View>
  );
}

// ─── Stepper ────────────────────────────────────────────────────────────────

/** The mockup's "−  1  +" on a soft grey pill. */
export function Stepper({ value, min = 0, max, onChange, label }: {
  value: number; min?: number; max: number; onChange: (n: number) => void; label: string;
}) {
  const change = (n: number) => { haptic.select(); onChange(n); };
  return (
    <View style={styles.stepper} accessible accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: String(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment' && value < max) onChange(value + 1);
        if (e.nativeEvent.actionName === 'decrement' && value > min) onChange(value - 1);
      }}
    >
      <Pressable accessibilityElementsHidden importantForAccessibility="no" disabled={value <= min} onPress={() => change(value - 1)} hitSlop={10}
        style={[styles.stepButton, value <= min && styles.off]}>
        <Icon name="minus" size={18} strokeWidth={2.4} />
      </Pressable>
      <Text variant="label" weight="bold" style={styles.stepValue} align="center">{value}</Text>
      <Pressable accessibilityElementsHidden importantForAccessibility="no" disabled={value >= max} onPress={() => change(value + 1)} hitSlop={10}
        style={[styles.stepButton, value >= max && styles.off]}>
        <Icon name="plus" size={18} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

// ─── Segmented switch ───────────────────────────────────────────────────────

/** The mockup's "Upcoming (1)   Past": two pills, the chosen one coral. */
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
            style={[styles.segmentItem, on ? styles.segmentOn : styles.segmentOff]}>
            <Text variant="small" weight="bold" color={on ? colors.onAccent : colors.text}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Lists of rows (Settings, Profile) ──────────────────────────────────────

/** Rows separated by hairlines, on white — no box around them. */
export function ListGroup({ children, title, style }: { children: ReactNode; title?: string; style?: ViewStyle }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={style}>
      {title ? <Text variant="overline" color={colors.muted} style={styles.groupTitle}>{title.toUpperCase()}</Text> : null}
      {rows.map((row, i) => (
        <Fragment key={row.key ?? i}>
          {i > 0 ? <View style={styles.rule} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** "◯  Account Information          Yousef Amr  ›" — an outline icon, the label, a detail, a chevron. */
export function ListRow({ icon, label, detail, sub, onPress, right, danger = false, chevron = true }: {
  icon: IconName; label: string; detail?: string; sub?: string; onPress?: () => void; right?: ReactNode; danger?: boolean; chevron?: boolean;
}) {
  const ink = danger ? colors.accent : colors.text;
  const body = (
    <>
      <Icon name={icon} size={22} color={ink} />
      <View style={{ flex: 1 }}>
        <Text variant="label" weight="medium" color={ink} numberOfLines={1}>{label}</Text>
        {sub ? <Text variant="caption" color={colors.muted} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {detail ? <Text variant="small" color={colors.muted} numberOfLines={1} style={styles.rowDetail}>{detail}</Text> : null}
      {right}
      {onPress && chevron && !right ? <Icon name="chevronRight" size={18} color={colors.subtle} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row} accessible accessibilityLabel={detail ? `${label}, ${detail}` : label}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={detail ? `${label}, ${detail}` : label} onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
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

/** The mockup's "Trending": a small pill of colour. */
export function Badge({ label, tone = 'accent', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = TONE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <Icon name={icon} size={12} color={t.fg} strokeWidth={2.2} /> : null}
      <Text variant="caption" weight="bold" color={t.fg}>{label}</Text>
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
      <Icon name="alert" size={36} color={colors.muted} />
      <Text variant="title" align="center">Something went wrong</Text>
      <Text variant="small" color={colors.muted} align="center" style={styles.stateBody}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} style={styles.stateButton} /> : null}
    </Animated.View>
  );
}

export function Empty({ icon, title, body, action, onAction, secondary, onSecondary }: {
  icon: IconName; title: string; body?: string; action?: string; onAction?: () => void;
  secondary?: string; onSecondary?: () => void;
}) {
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.state}>
      <View style={styles.emptyIcon}><Icon name={icon} size={34} color={colors.accent} /></View>
      <Text variant="title" align="center">{title}</Text>
      {body ? <Text variant="small" color={colors.muted} align="center" style={styles.stateBody}>{body}</Text> : null}
      {action && onAction ? <Button label={action} onPress={onAction} style={styles.stateButton} /> : null}
      {secondary && onSecondary ? <Button label={secondary} variant="ghost" onPress={onSecondary} /> : null}
    </Animated.View>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

/** A soft grey panel, used sparingly (the checkout's summary). */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A hairline between blocks. */
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
  side: { width: 72, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end', gap: 2 },
  screenTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52 },

  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconSoft: { backgroundColor: colors.bgSunken },
  iconGlass: { backgroundColor: 'rgba(17,16,24,0.35)' },
  iconOutline: { backgroundColor: colors.white, shadowColor: '#111018', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  iconPressed: { backgroundColor: colors.bgSunken },
  iconGlassPressed: { backgroundColor: 'rgba(17,16,24,0.6)' },

  section: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },

  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, minHeight: 36, borderRadius: radius.pill },
  chipOn: { backgroundColor: colors.accent },
  chipOff: { backgroundColor: colors.bgSunken },
  chipDot: { width: 10, height: 10, borderRadius: 5 },

  heart: { alignItems: 'center', justifyContent: 'center' },
  heartOnLight: { backgroundColor: colors.white, shadowColor: '#111018', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  heartOnDark: { backgroundColor: 'rgba(17,16,24,0.35)' },

  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, backgroundColor: colors.bgSunken, paddingHorizontal: 4 },
  stepButton: { width: 36, height: 38, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 28 },
  off: { opacity: 0.3 },

  segment: { flexDirection: 'row', gap: space.md },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.accent },
  segmentOff: { backgroundColor: colors.bgSunken },

  groupTitle: { marginTop: space.lg, marginBottom: space.xs },
  rule: { height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.border, marginLeft: 38 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg, minHeight: 58, paddingVertical: space.sm },
  rowDetail: { maxWidth: 170 },

  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },

  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md, minHeight: 260 },
  stateBody: { maxWidth: 320 },
  stateButton: { alignSelf: 'stretch', maxWidth: 360, width: '100%', marginTop: space.sm },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.coral50, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },

  card: { backgroundColor: colors.bgSunken, borderRadius: radius.lg, padding: space.lg },
});
