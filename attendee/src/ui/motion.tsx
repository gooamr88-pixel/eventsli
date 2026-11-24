import * as Haptics from 'expo-haptics';
import { useEffect, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSpring, withTiming,
} from 'react-native-reanimated';

import { colors, motion, radius } from './theme';

/**
 * How the app moves and answers a touch. Small and consistent: a pressed card
 * sinks a little, a saved heart or a chosen seat ticks under the thumb, and
 * a loading list shows the shape of what is coming instead of a spinner.
 * Every one of these respects Reduce Motion.
 */

// ─── Haptics ────────────────────────────────────────────────────────────────

/** A light tick for choosing (a seat, a chip); a firmer one for committing;
 *  success and error for outcomes. Silent on the web, and never throws. */
export const haptic = {
  select: () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => undefined); },
  tap: () => { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); },
  commit: () => { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined); },
  success: () => { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); },
  error: () => { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined); },
};

// ─── A pressable that sinks ─────────────────────────────────────────────────

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressyProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** How far it sinks; cards 0.97, small buttons 0.92. */
  scale?: number;
  children?: ReactNode;
};

/** Every tappable card: it scales down under the finger and springs back. */
export function Pressy({ style, scale = motion.press, children, onPressIn, onPressOut, ...rest }: PressyProps) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => { if (!reduce) s.set(withSpring(scale, { damping: 18, stiffness: 400 })); onPressIn?.(e); }}
      onPressOut={(e) => { s.set(withSpring(1, { damping: 14, stiffness: 300 })); onPressOut?.(e); }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

// ─── Skeletons ──────────────────────────────────────────────────────────────

/** A grey block that breathes while its content loads. */
export function Skeleton({ width, height, round = radius.md, style }: {
  width?: number | `${number}%`; height: number; round?: number; style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const o = useSharedValue(0.55);
  useEffect(() => {
    if (reduce) return;
    o.value = withRepeat(withTiming(1, { duration: 750, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [o, reduce]);
  const animated = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: width ?? '100%', height, borderRadius: round, backgroundColor: colors.bgSunken }, animated, style]} />;
}

/** The shape of an event card: a cover, two lines. */
export function CardSkeleton({ height = 180 }: { height?: number }) {
  return (
    <View style={styles.card} accessibilityLabel="Loading">
      <Skeleton height={height} round={radius.lg} />
      <Skeleton height={16} width="70%" />
      <Skeleton height={12} width="45%" />
    </View>
  );
}

/** The shape of a list row: a square, three lines. */
export function RowSkeleton() {
  return (
    <View style={styles.row} accessibilityLabel="Loading">
      <Skeleton width={84} height={84} round={radius.md} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton height={16} width="80%" />
        <Skeleton height={12} width="50%" />
        <Skeleton height={12} width="35%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
});
