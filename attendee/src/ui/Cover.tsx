import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { imageUrl } from '../lib/images';
import { Text } from './Text';
import { colors, fonts } from './theme';

type Props = {
  uri: string | null | undefined;
  title?: string;
  /** A private event's cover is shown blurred until it is unlocked. */
  blurred?: boolean;
  /** Darken the bottom so white words on it read (cards, the event hero). */
  scrim?: boolean;
  style?: ViewStyle;
  /** How wide it is drawn, in points, so the right size is downloaded (lib/images.ts). */
  size?: number;
  children?: ReactNode;
};

/**
 * An event's artwork. An event may publish without one, and then the cover is
 * a typographic tile from the title on the brand's night-to-coral gradient —
 * never a stock photo of a crowd that is not this crowd (discoveryController).
 *
 * The picture is fetched at the size it is shown — a 88-point thumbnail is a
 * ~10 KB WebP, not the 400 KB original (lib/images.ts).
 */
export function Cover({ uri, title, blurred = false, scrim = false, style, size, children }: Props) {
  const points = size ?? (typeof style?.width === 'number' ? style.width : 360);
  const src = imageUrl(uri, points);
  return (
    <View style={[styles.box, style]}>
      {src ? (
        <Image
          source={{ uri: src }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          recyclingKey={src}
          blurRadius={blurred ? 24 : 0}
          cachePolicy="memory-disk"
          accessible={false}
        />
      ) : (
        <LinearGradient colors={[colors.night, '#3a0f2a', colors.coral600]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
          {/* The title, sized to the tile and only where there is room for it
              — squeezed into a thumbnail it wrapped mid-word into nonsense. */}
          {title && points >= 120 && !children ? (
            <View style={styles.placeholder}>
              <Text numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.6} color={colors.sun200}
                style={[styles.placeholderText, { fontSize: Math.min(22, points / 10), lineHeight: Math.min(26, points / 8.5) }]}>{title}</Text>
            </View>
          ) : null}
        </LinearGradient>
      )}
      {scrim ? (
        <LinearGradient
          colors={['transparent', 'rgba(17,16,24,0.85)']}
          locations={[0.35, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: colors.night },
  placeholder: { flex: 1, justifyContent: 'center', padding: 16 },
  placeholderText: { fontFamily: fonts.display, opacity: 0.9 },
});
