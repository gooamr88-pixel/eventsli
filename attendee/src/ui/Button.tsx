import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { haptic, Pressy } from './motion';
import { Text } from './Text';
import { colors, space } from './theme';

type Variant = 'primary' | 'secondary' | 'highlight' | 'ghost' | 'onDark' | 'dark' | 'soft';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: IconName;
  iconRight?: IconName;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

/**
 * The mockup's buttons: coral for the action that moves you forward
 * (Continue, Pay Now, Select Tickets), yellow with near-black words for Get
 * Started, an outline for the second choice (Back to Home). The coral is the
 * site's text-safe #D61F2C — white on the sheet's #FF414B is only 3.44:1.
 *
 * Every button sinks a little under the thumb and ticks once on press, so a
 * tap is felt before the next screen arrives.
 */
export function Button({
  label, onPress, variant = 'primary', size = 'md', icon, iconRight, busy = false, disabled = false, style, accessibilityHint,
}: Props) {
  const off = disabled || busy;
  const p = PALETTE[variant];
  return (
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy }}
      onPress={off ? undefined : () => { haptic.tap(); onPress?.(); }}
      disabled={off}
      scale={0.97}
      style={[
        styles.base,
        size === 'sm' && styles.small,
        { backgroundColor: p.bg, borderColor: p.border },
        off && styles.off,
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator color={p.fg} /> : icon ? <Icon name={icon} size={size === 'sm' ? 17 : 20} color={p.fg} /> : null}
        <Text variant={size === 'sm' ? 'small' : 'label'} weight="bold" color={p.fg} numberOfLines={1}>{label}</Text>
        {iconRight && !busy ? <Icon name={iconRight} size={size === 'sm' ? 17 : 20} color={p.fg} /> : null}
      </View>
    </Pressy>
  );
}

const PALETTE: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.accent, fg: colors.onAccent, border: colors.accent },
  // The mockup's "Back to Home": a coral outline with black words.
  secondary: { bg: colors.surface, fg: colors.text, border: colors.coral300 },
  highlight: { bg: colors.highlight, fg: colors.onHighlight, border: colors.highlight },
  ghost: { bg: 'transparent', fg: colors.accent, border: 'transparent' },
  onDark: { bg: 'transparent', fg: colors.white, border: 'transparent' },
  dark: { bg: colors.night, fg: colors.white, border: colors.night },
  // The mockup's "Add to Calendar" / "Share Ticket": a quiet grey bar.
  soft: { bg: colors.bgSunken, fg: colors.text, border: colors.bgSunken },
};

/** PILLS, as the owner's Home draws its buttons ("Get Tickets", 2026-11-28). */
const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: space.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  small: { minHeight: 42, borderRadius: 999, paddingHorizontal: space.lg },
  off: { opacity: 0.45 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
