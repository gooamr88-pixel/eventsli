import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { describeScan } from '@/gate/outcomes';
import { useRecent } from '@/gate/useDoor';
import { doorTime } from '@/lib/format';
import { Empty, Header, Screen } from '@/ui/layout';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { colors, space, tones } from '@/ui/theme';

/** Every recent check-in at this event — or everything, refusals included. */
export default function Recent() {
  const [kind, setKind] = useState<'admitted' | 'all'>('admitted');
  const q = useRecent(kind, 100);
  return (
    <Screen>
      <Header title="Recent Check-ins" />
      <Segmented
        options={[{ value: 'admitted', label: 'Check-ins' }, { value: 'all', label: 'All activity' }]}
        value={kind}
        onChange={setKind}
      />
      <FlatList
        data={q.data ?? []}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { q.refetch(); }} tintColor={colors.accent} />}
        ListEmptyComponent={q.isLoading ? undefined : <Empty icon="clock" title="Nothing yet" body="Arrivals appear here as the door scans them." />}
        renderItem={({ item }) => {
          const o = describeScan(item.result);
          return (
            <Pressable
              onPress={() => item.ticketId && router.push({ pathname: '/ticket/[ticketId]', params: { ticketId: item.ticketId } })}
              style={styles.row}
            >
              <View style={[styles.dot, { backgroundColor: tones[o.tone].strong }]} />
              <View style={{ flex: 1 }}>
                <Text variant="label" numberOfLines={1}>{item.holder || item.tier || 'Guest'}</Text>
                <Text variant="small" color={colors.muted} numberOfLines={1}>
                  {[kind === 'all' ? o.title : null, item.staff || item.device, item.method === 'manual' ? 'by hand' : null]
                    .filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text variant="small" color={colors.muted}>{doorTime(item.at)}</Text>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
