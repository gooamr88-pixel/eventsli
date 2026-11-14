import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, fonts, radius, space } from './theme';

type Props = TextInputProps & {
  label: string;
  icon?: IconName;
  error?: string | null;
  /** A password field gets the show/hide eye from the mockup. */
  secret?: boolean;
};

export const Field = forwardRef<TextInputInstance, Props>(function Field(
  { label, icon, error, secret = false, style, ...rest },
  ref,
) {
  const [hidden, setHidden] = useState(secret);
  return (
    <View style={styles.wrap}>
      <View style={[styles.box, error ? styles.boxError : null]}>
        {icon && <Icon name={icon} size={20} color={colors.muted} />}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholder={label}
          placeholderTextColor={colors.placeholder}
          secureTextEntry={hidden}
          style={[styles.input, style]}
          maxFontSizeMultiplier={1.4}
          {...rest}
        />
        {secret && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={12}
            onPress={() => setHidden((h) => !h)}
          >
            <Icon name={hidden ? 'eye' : 'eyeOff'} size={20} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {error ? <Text variant="small" color={colors.danger}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  box: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  boxError: { borderColor: colors.danger },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text, paddingVertical: space.md },
});
