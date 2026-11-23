import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, radius, space } from './theme';

type Variant = 'primary' | 'secondary' | 'highlight' | 'ghost' | 'onDark';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  iconRight?: IconName;
  busy?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
};

/**
 * The mockup's buttons: coral for the action that moves you forward
 * (Continue, Pay Now, Select Tickets), yellow with near-black words for Get
 * Started, an outline for the second choice (Back to Home). The coral is the
 * site's text-safe #D61F2C — white on the sheet's #FF414B is only 3.44:1.
 */
export function Button({
  label, onPress, variant = 'primary', icon, iconRight, busy = false, disabled = false, style, accessibilityHint,
}: Props) {
  const off = disabled || busy;
  const p = PALETTE[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: pressed && !off ? p.pressed : p.bg, borderColor: p.border },
        variant === 'primary' && styles.glow,
        off && styles.off,
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator color={p.fg} /> : icon ? <Icon name={icon} size={20} color={p.fg} /> : null}
        <Text variant="label" weight="bold" color={p.fg}>{label}</Text>
        {iconRight && !busy ? <Icon name={iconRight} size={20} color={p.fg} /> : null}
      </View>
    </Pressable>
  );
}

const PALETTE: Record<Variant, { bg: string; pressed: string; fg: string; border: string }> = {
  primary: { bg: colors.accent, pressed: colors.accentPressed, fg: colors.onAccent, border: colors.accent },
  secondary: { bg: colors.surface, pressed: colors.coral50, fg: colors.accent, border: colors.accent },
  highlight: { bg: colors.highlight, pressed: colors.sun300, fg: colors.onHighlight, border: colors.highlight },
  ghost: { bg: 'transparent', pressed: colors.bgSunken, fg: colors.accent, border: 'transparent' },
  onDark: { bg: 'transparent', pressed: 'rgba(255,255,255,0.08)', fg: colors.white, border: 'transparent' },
};

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingHorizontal: space.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glow: { shadowColor: colors.accent, shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  off: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
