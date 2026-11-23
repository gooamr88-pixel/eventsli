import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, fonts, radius, space } from './theme';

type Props = TextInputProps & {
  label: string;
  icon?: IconName;
  error?: string | null;
  /** A password: masked, with a show/hide button. */
  secret?: boolean;
};

/** A labelled input. The label is real text above the box, not a placeholder that vanishes on typing. */
export const Field = forwardRef<TextInputInstance, Props>(function Field({ label, icon, error, secret = false, style, ...rest }, ref) {
  const [shown, setShown] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text variant="small" weight="semibold">{label}</Text>
      <View style={[styles.box, error ? styles.boxError : null]}>
        {icon ? <Icon name={icon} size={20} color={colors.muted} /> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.placeholder}
          secureTextEntry={secret && !shown}
          style={[styles.input, style]}
          maxFontSizeMultiplier={1.6}
          {...rest}
        />
        {secret ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
            onPress={() => setShown((v) => !v)}
            hitSlop={8}
          >
            <Icon name={shown ? 'eyeOff' : 'eye'} size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.field,
  },
  boxError: { borderColor: colors.danger },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text, paddingVertical: space.md },
});
