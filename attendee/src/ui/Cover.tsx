import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

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
  children?: ReactNode;
};

/**
 * An event's artwork. An event may publish without one, and then the cover is
 * a typographic tile from the title on the brand's night-to-coral gradient —
 * never a stock photo of a crowd that is not this crowd (discoveryController).
 */
export function Cover({ uri, title, blurred = false, scrim = false, style, children }: Props) {
  return (
    <View style={[styles.box, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          blurRadius={blurred ? 24 : 0}
          cachePolicy="memory-disk"
          accessible={false}
        />
      ) : (
        <LinearGradient colors={[colors.night, '#3a0f2a', colors.coral600]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
          {title ? (
            <View style={styles.placeholder}>
              <Text numberOfLines={3} style={styles.placeholderText} color={colors.sun200}>{title}</Text>
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
  placeholderText: { fontFamily: fonts.display, fontSize: 22, lineHeight: 26, opacity: 0.9 },
});
