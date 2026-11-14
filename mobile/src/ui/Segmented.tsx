import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { colors, radius, space } from './theme';

type Option<T extends string> = { value: T; label: string };

/** The mockup's two-way switch: Assigned to me / All Events, Not yet / Checked in. */
export function Segmented<T extends string>({
  options, value, onChange,
}: { options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.item, on && styles.itemOn]}
          >
            <Text variant="small" weight={on ? 'semibold' : 'medium'} color={on ? colors.onAccent : colors.text}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', gap: space.xs, padding: 4, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  item: {
    flex: 1, minHeight: 38, paddingHorizontal: space.md, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  itemOn: { backgroundColor: colors.accent },
});
