import { StyleSheet, View } from 'react-native';

import type { Category } from '../api/types';
import { categoryLook } from './categoryLook';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Pressy } from './motion';
import { Text } from './Text';
import { colors, space } from './theme';

/**
 * A category to tap. With a photo (an admin can set one) it is the mockup's
 * photo tile with the name on it; without one — every category today — it is
 * the category's icon on its own soft colour, the name beside or under it.
 *
 *   small  Home's row: a square, the name under it.
 *   large  Explore's grid: a wide tile, the icon top-left, the name bottom-left.
 */
export function CategoryTile({ category, index, size, width, onPress }: {
  category: Category; index: number; size: 'small' | 'large'; width?: number; onPress: () => void;
}) {
  const look = categoryLook(category.slug, index);

  if (size === 'small') {
    return (
      <Pressy accessibilityRole="button" accessibilityLabel={category.label} onPress={onPress} scale={0.94} style={styles.small}>
        {category.imageUrl ? (
          <Cover uri={category.imageUrl} style={styles.smallBox} size={80} />
        ) : (
          <View style={[styles.smallBox, { backgroundColor: look.bg }]}>
            <Icon name={look.icon} size={30} color={look.ink} strokeWidth={2} />
          </View>
        )}
        <Text variant="caption" weight="semibold" align="center" numberOfLines={2} style={styles.smallLabel}>{category.label}</Text>
      </Pressy>
    );
  }

  return (
    <Pressy accessibilityRole="button" accessibilityLabel={category.label} onPress={onPress} scale={0.97} style={{ width }}>
      {category.imageUrl ? (
        <Cover uri={category.imageUrl} scrim style={styles.large} size={width}>
          <Text variant="title" color={colors.white} style={styles.largeLabel} numberOfLines={2}>{category.label}</Text>
        </Cover>
      ) : (
        <View style={[styles.large, { backgroundColor: look.bg }]}>
          <View style={styles.largeIcon}><Icon name={look.icon} size={24} color={look.ink} strokeWidth={2} /></View>
          <Text variant="label" weight="bold" color={look.ink} style={styles.largeLabel} numberOfLines={2}>{category.label}</Text>
        </View>
      )}
    </Pressy>
  );
}

const styles = StyleSheet.create({
  small: { width: 80, alignItems: 'center', gap: 6 },
  smallBox: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  smallLabel: { lineHeight: 15 },
  large: { height: 112, borderRadius: 16, overflow: 'hidden', padding: space.md },
  largeIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  largeLabel: { position: 'absolute', left: space.md, right: space.md, bottom: space.md },
});
