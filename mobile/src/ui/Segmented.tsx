import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { colors, radius, space } from './theme';

type Option<T extends string> = { value: T; label: string };

/** The Upcoming / Ongoing / Past switch from the mockup. */
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
  wrap: { flexDirection: 'row', gap: space.sm },
  item: {
    minHeight: 40, paddingHorizontal: space.lg, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  itemOn: { backgroundColor: colors.accent },
});
