import { Pressable, StyleSheet, View } from 'react-native';

import type { SeatMap } from '@/api/types';
import { money } from '@/lib/format';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

import { OPEN_SEAT, type MapModel, type MapSeat } from './model';

/**
 * The same seats as a list — section, row, seat — for a screen reader, or for
 * anyone who would rather read than pan. The drawn map cannot be read aloud;
 * this can, seat by seat, with its price.
 */
export function SeatList({ data, model, picked, onSeat }: {
  data: SeatMap; model: MapModel; picked: Set<string>; onSeat: (s: MapSeat) => void;
}) {
  const groups = group(data, model);
  return (
    <View style={{ gap: space.lg }}>
      {groups.map(({ title, seats }) => (
        <View key={title} style={{ gap: space.sm }}>
          <Text variant="label" weight="bold" accessibilityRole="header">{title}</Text>
          <View style={styles.wrap}>
            {seats.map((s) => {
              const on = picked.has(s.id);
              const tint = (model.byTier && s.tierId ? model.palette.get(s.tierId) : null) || OPEN_SEAT;
              return (
                <Pressable
                  key={s.id}
                  disabled={!s.available && !on}
                  onPress={() => onSeat(s)}
                  accessibilityRole="button"
                  accessibilityLabel={`${model.nameOf(s)}${s.priceCents !== null ? `, ${money(s.priceCents, data.event.currency)}` : ''}${s.available ? '' : ', taken'}`}
                  accessibilityState={{ selected: on, disabled: !s.available && !on }}
                  style={[
                    styles.seat,
                    on ? styles.on : s.available ? { borderColor: tint, backgroundColor: `${tint}1f` } : styles.taken,
                  ]}
                >
                  <Text variant="caption" weight="bold" color={on ? colors.white : s.available ? colors.text : colors.subtle}>{s.number}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

/** By the name a ticket prints, without the seat: "Section A · Row 3", "Table T4". */
function group(data: SeatMap, model: MapModel) {
  const out = new Map<string, MapSeat[]>();
  for (const s of data.seats) {
    const name = model.nameOf(s).replace(/ · Seat .*$/, '');
    out.set(name, [...(out.get(name) ?? []), s]);
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
  return [...out.entries()].sort(([a], [b]) => cmp(a, b)).map(([title, seats]) => ({
    title,
    seats: seats.sort((a, b) => cmp(String(a.number), String(b.number))),
  }));
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  seat: { minWidth: 40, height: 40, paddingHorizontal: 6, borderRadius: radius.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  taken: { backgroundColor: colors.bgSunken, borderColor: colors.border },
});
