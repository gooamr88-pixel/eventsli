import { Text as RNText, type TextProps } from 'react-native';

import { colors, fonts, type as typeScale } from './theme';

type Variant = keyof typeof typeScale;
type Weight = keyof typeof fonts;

type Props = TextProps & {
  variant?: Variant;
  weight?: Weight;
  color?: string;
  align?: 'left' | 'center' | 'right';
};

/** Every piece of text in the app: DM Sans, the site's scale, dynamic type on. */
export function Text({ variant = 'body', weight, color = colors.text, align, style, ...rest }: Props) {
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[
        typeScale[variant],
        weight ? { fontFamily: fonts[weight] } : null,
        { color },
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
