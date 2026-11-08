import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { messageFor } from '@/api/client';
import { attendees } from '@/api/endpoints';
import type { Attendee } from '@/api/types';
import { useSession } from '@/auth/session';
import { useDoorExit } from '@/gate/useDoor';
import { doorTime } from '@/lib/format';
import { Icon } from '@/ui/Icon';
import { Empty, Header, Screen } from '@/ui/layout';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { colors, fonts, radius, space } from '@/ui/theme';

type Filter = 'all' | 'out' | 'in';

/**
 * The guest list — for the organizer, and for the door team only when the
 * organizer shares it. Search by name, email or the start of a ticket number;
 * tap a guest to see their ticket and check them in by hand. Screenshots are
 * blocked here: this is the one screen that is a list of people.
 */
export default function Attendees() {
  usePreventScreenCapture();
  const door = useSession((s) => s.door);
  const exit = useDoorExit();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>('out');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = useInfiniteQuery({
    queryKey: ['attendees', door?.token, debounced, filter],
    queryFn: ({ pageParam }) => attendees(door!.token, { q: debounced, status: filter, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.page?.hasMore ? last.page.offset + last.rows.length : undefined),
    enabled: Boolean(door),
  });

  useEffect(() => {
    if (list.error) exit(list.error);
  }, [list.error, exit]);

  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = list.data?.pages[0]?.page?.total ?? 0;

  return (
    <Screen>
      <Header title="Attendees" />
      <View style={styles.search}>
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Name, email or ticket number"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="Search guests"
          returnKeyType="search"
        />
      </View>
      <Segmented
        options={[
          { value: 'out', label: 'Not yet' },
          { value: 'in', label: 'Checked in' },
          { value: 'all', label: 'Everyone' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <Text variant="small" color={colors.muted}>{list.isLoading ? 'Searching…' : `${total.toLocaleString()} guest${total === 1 ? '' : 's'}`}</Text>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.ticketId}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={list.isLoading ? undefined : (
          <Empty
            icon="users"
            title={list.error ? 'Could not load the guest list' : 'Nobody matches'}
            body={list.error ? messageFor(list.error) : 'Try part of a name, or switch to Everyone.'}
          />
        )}
        renderItem={({ item }) => <Row a={item} />}
      />
    </Screen>
  );
}

function Row({ a }: { a: Attendee }) {
  const inside = a.status === 'scanned';
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/ticket/[ticketId]', params: { ticketId: a.ticketId } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgSunken }]}
      accessibilityRole="button"
    >
      <View style={[styles.state, { backgroundColor: inside ? colors.successStrong : colors.teal100 }]}>
        {inside && <Icon name="tick" size={14} color={colors.white} strokeWidth={3} />}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" numberOfLines={1}>{a.holder || 'Name not given'}</Text>
        <Text variant="small" color={colors.muted} numberOfLines={1}>
          {[a.tier, a.seat, a.table].filter(Boolean).join(' · ') || `Ticket ${a.ticketId.slice(0, 8)}`}
        </Text>
      </View>
      <Text variant="small" color={inside ? colors.success : colors.subtle}>
        {inside ? doorTime(a.scannedAt) : 'Not yet'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md,
    minHeight: 48, borderRadius: radius.md, backgroundColor: colors.bgSunken,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  state: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
