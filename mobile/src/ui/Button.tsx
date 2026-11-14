import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, radius, space } from './theme';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid';
  icon?: IconName;
  iconRight?: IconName;
  busy?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  style?: ViewStyle;
  accessibilityHint?: string;
};

/**
 * 52pt tall by default — a door is a moving queue, a dark room and often a
 * gloved thumb. The busy state keeps the label's width so nothing jumps.
 */
export function Button({
  label, onPress, variant = 'primary', icon, iconRight, busy = false, disabled = false,
  size = 'md', style, accessibilityHint,
}: Props) {
  const off = disabled || busy;
  const palette = PALETTE[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' && styles.lg,
        { backgroundColor: pressed && !off ? palette.pressed : palette.bg, borderColor: palette.border },
        off && styles.off,
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? (
          <ActivityIndicator color={palette.fg} />
        ) : (
          icon && <Icon name={icon} size={20} color={palette.fg} />
        )}
        <Text variant="label" color={palette.fg}>{label}</Text>
        {iconRight && !busy && <Icon name={iconRight} size={20} color={palette.fg} />}
      </View>
    </Pressable>
  );
}

const PALETTE = {
  primary: { bg: colors.accent, pressed: colors.accentPressed, fg: colors.onAccent, border: colors.accent },
  // The mockup's outline button: View Details, Cancel.
  secondary: { bg: colors.surface, pressed: colors.teal50, fg: colors.accent, border: colors.accent },
  ghost: { bg: 'transparent', pressed: colors.bgSunken, fg: colors.accent, border: 'transparent' },
  danger: { bg: colors.surface, pressed: colors.dangerSoft, fg: colors.danger, border: colors.border },
  // The confirming button of a destructive dialog: Sign out, Leave.
  dangerSolid: { bg: colors.danger, pressed: '#991b1b', fg: colors.white, border: colors.danger },
} as const;

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lg: { minHeight: 58 },
  off: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
