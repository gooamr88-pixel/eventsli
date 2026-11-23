import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { messageFor } from '@/api/client';
import { cities } from '@/api/endpoints';
import { useSession } from '@/auth/session';
import { Failed, Header, Loading } from '@/ui/bits';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/**
 * The city picker behind Home's "Cairo ▾". Only cities that have something on
 * (/public/cities) — a list of every city in the world would mostly lead to
 * empty pages.
 */
export default function CityPicker() {
  const current = useSession((s) => s.city);
  const list = useQuery({ queryKey: ['cities'], queryFn: cities, staleTime: 600_000 });

  const choose = (c: { city: string; country: string } | null) => {
    void useSession.getState().setCity(c);
    router.back();
  };

  return (
    <View style={styles.root}>
      <Header title="Choose a city" back />
      {list.isLoading ? <Loading /> : list.isError ? (
        <Failed message={messageFor(list.error)} onRetry={() => { void list.refetch(); }} />
      ) : (
        <FlatList
          data={[null, ...(list.data ?? [])]}
          keyExtractor={(c) => (c ? `${c.city}|${c.country}` : 'everywhere')}
          contentContainerStyle={{ paddingBottom: space.xxl }}
          renderItem={({ item }) => {
            const selected = item ? current?.city === item.city && current?.country === item.country : !current;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => choose(item ? { city: item.city, country: item.country } : null)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgSunken }]}
              >
                <Icon name={item ? 'pin' : 'globe'} size={20} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text variant="label">{item ? item.city : 'Everywhere'}</Text>
                  <Text variant="caption" color={colors.muted}>
                    {item ? `${item.country} · ${item.events} event${item.events === 1 ? '' : 's'}` : 'Every city on Eventsli'}
                  </Text>
                </View>
                {selected ? <Icon name="check" size={20} color={colors.accent} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
});
