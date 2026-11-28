import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import type { Category } from '../api/types';
import { categoryLook } from './categoryLook';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Pressy } from './motion';
import { Text } from './Text';
import { colors, fonts, space } from './theme';

/**
 * A category to tap — the mockup's PHOTO TILE: a rounded picture with the
 * name in white across its foot (Home's row of four, Explore's grid of two).
 *
 * The picture is the category's own (an admin can set one), else the cover of
 * a real upcoming event in it (hooks/useCategoryCovers.ts). With neither, the
 * same tile in the brand's night-to-coral with the category's icon, so a row
 * never mixes two styles.
 *
 *   small  Home: a near-square tile, about a quarter of the row.
 *   large  Explore: half the width, a little taller than wide.
 */
export function CategoryTile({ category, index, size, width, photo, onPress }: {
  category: Category; index: number; size: 'small' | 'large'; width: number; photo?: string | null; onPress: () => void;
}) {
  const look = categoryLook(category.slug, index);
  const uri = category.imageUrl || photo || null;
  const small = size === 'small';
  const height = Math.round(width * (small ? 1.1 : 0.94));
  const label = (
    <Text
      color={colors.white}
      style={[styles.label, small ? styles.labelSmall : styles.labelLarge]}
      numberOfLines={2}
      maxFontSizeMultiplier={1.3}
    >
      {category.label}
    </Text>
  );

  return (
    <Pressy accessibilityRole="button" accessibilityLabel={category.label} onPress={onPress} scale={small ? 0.94 : 0.97} style={{ width }}>
      {uri ? (
        <Cover uri={uri} scrim style={{ ...styles.tile, height, borderRadius: small ? 14 : 16 }} size={width}>
          {label}
        </Cover>
      ) : (
        <View style={[styles.tile, { height, borderRadius: small ? 14 : 16 }]}>
          <LinearGradient colors={[colors.night800, '#4a0d1c', colors.coral700]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={[styles.icon, small && styles.iconSmall]}>
            <Icon name={look.icon} size={small ? 22 : 30} color={colors.white} strokeWidth={1.8} />
          </View>
          {label}
        </View>
      )}
    </Pressy>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden', backgroundColor: colors.night },
  label: { position: 'absolute', fontFamily: fonts.bold },
  labelSmall: { left: 6, right: 6, bottom: 8, fontSize: 14, lineHeight: 17, textAlign: 'center' },
  labelLarge: { left: space.md, right: space.md, bottom: space.md, fontSize: 18, lineHeight: 22 },
  icon: { position: 'absolute', top: space.md, left: space.md, opacity: 0.9 },
  iconSmall: { top: 0, left: 0, right: 0, bottom: 22, alignItems: 'center', justifyContent: 'center' },
});
