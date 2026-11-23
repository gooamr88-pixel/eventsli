import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { categories, eventsNear, listEvents } from '@/api/endpoints';
import type { EventCard } from '@/api/types';
import { useSession, useToken } from '@/auth/session';
import { useSaved } from '@/hooks/useSaved';
import { approximatePosition } from '@/lib/location';
import { Chip, Empty, Failed, Loading } from '@/ui/bits';
import { Cover } from '@/ui/Cover';
import { EventRow } from '@/ui/EventCard';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, fonts, radius, space } from '@/ui/theme';

const PAGE = 20;

/**
 * Explore (the mockup's fourth frame): the chips across the top, the category
 * tiles when nothing is chosen, and the matching events once something is —
 * a category, a search, or Near me.
 *
 * Search waits for a pause in typing (350 ms) so a word is one request, not
 * one per letter against a public endpoint.
 */
export default function Explore() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ category?: string; focus?: string }>();
  const token = useToken();
  const city = useSession((s) => s.city);
  const { isSaved, flip } = useSaved();
  const input = useRef<TextInputInstance>(null);

  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [nearNote, setNearNote] = useState<string | null>(null);

  // Home's category tiles open this tab with ?category=. Followed when it
  // CHANGES (adjusted during render, React's pattern for a prop-driven reset),
  // so choosing another chip here is not undone by a stale param.
  const [seenParam, setSeenParam] = useState(params.category);
  if (params.category !== seenParam) {
    setSeenParam(params.category);
    if (params.category) { setCategory(params.category); setNear(null); }
  }
  useEffect(() => { if (params.focus) input.current?.focus(); }, [params.focus]);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

  const cats = useQuery({ queryKey: ['categories'], queryFn: categories, staleTime: 3_600_000 });
  const browsing = Boolean(category || q);

  const list = useInfiniteQuery({
    queryKey: ['events', 'explore', category, q, city?.city ?? null],
    enabled: browsing && !near,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => listEvents({ category: category ?? undefined, q: q || undefined, city: city?.city, page: pageParam, limit: PAGE }, token),
    getNextPageParam: (last) => (last.pagination && last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
  });

  const nearby = useQuery({
    queryKey: ['events', 'near', near?.lat, near?.lng],
    enabled: Boolean(near),
    queryFn: () => eventsNear(near!.lat, near!.lng),
  });

  async function findNear() {
    setNearNote(null);
    const pos = await approximatePosition();
    if (pos === 'denied') setNearNote('Location is off for Eventsli. Turn it on in Settings, or choose a city on Home.');
    else if (!pos) setNearNote('We could not find where you are just now. Try again outside, or choose a city.');
    else { setCategory(null); setText(''); setNear(pos); }
  }

  const events: EventCard[] = useMemo(() => {
    if (near) return nearby.data?.events ?? [];
    return (list.data?.pages ?? []).flatMap((p) => p.data);
  }, [near, nearby.data, list.data]);

  const chips = [{ slug: null as string | null, label: 'All' }, ...(cats.data ?? []).map((c) => ({ slug: c.slug, label: c.label }))];
  const active = near ? nearby : list;

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <View style={styles.head}>
        <Text variant="screenTitle" accessibilityRole="header">Explore</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Events near me" onPress={() => { void findNear(); }} style={[styles.near, near && styles.nearOn]}>
          <Icon name="locate" size={18} color={near ? colors.onAccent : colors.accent} />
          <Text variant="small" weight="semibold" color={near ? colors.onAccent : colors.accent}>Near me</Text>
        </Pressable>
      </View>

      <View style={styles.search}>
        <Icon name="search" size={20} color={colors.muted} />
        <TextInput
          ref={input}
          value={text}
          onChangeText={(v) => { setText(v); setNear(null); }}
          placeholder="Search events, venues, artists"
          placeholderTextColor={colors.placeholder}
          style={styles.input}
          returnKeyType="search"
          accessibilityLabel="Search events"
          autoCorrect={false}
        />
        {text ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setText('')} hitSlop={8}>
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ flexGrow: 0 }}>
        {chips.map((c) => (
          <Chip key={c.slug ?? 'all'} label={c.label} active={!near && category === c.slug} onPress={() => { setNear(null); setCategory(c.slug); }} />
        ))}
      </ScrollView>

      {nearNote ? <Text variant="small" color={colors.warning} style={styles.note}>{nearNote}</Text> : null}

      {!browsing && !near ? (
        <ScrollView contentContainerStyle={styles.grid}>
          {cats.isLoading ? <Loading /> : (cats.data ?? []).map((c) => (
            <Pressable key={c.slug} accessibilityRole="button" accessibilityLabel={c.label} onPress={() => setCategory(c.slug)} style={styles.gridCell}>
              <Cover uri={c.imageUrl} title={c.label} scrim style={styles.gridTile}>
                <Text variant="label" weight="bold" color={colors.white} style={styles.gridLabel}>{c.label}</Text>
              </Cover>
            </Pressable>
          ))}
        </ScrollView>
      ) : active.isLoading ? <Loading /> : active.isError ? (
        <Failed message={messageFor(active.error)} onRetry={() => { void active.refetch(); }} />
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
          renderItem={({ item }) => (
            <View>
              <EventRow event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} />
              {near && item.distanceKm !== undefined ? (
                <Text variant="caption" color={colors.muted} style={styles.distance}>{item.distanceKm} km away</Text>
              ) : null}
            </View>
          )}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (!near && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
          ListFooterComponent={list.isFetchingNextPage ? <Loading style={{ minHeight: 80 }} /> : undefined}
          ListEmptyComponent={
            <Empty
              icon="search"
              title={near ? 'Nothing near you yet' : 'No events found'}
              body={near ? 'Nothing within reach right now. Try a city instead.' : city ? `Nothing matches in ${city.city}. Try another word or city.` : 'Try another word or category.'}
              action={near ? 'Choose a city' : undefined}
              onAction={near ? () => router.push('/city') : undefined}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, marginBottom: space.md },
  near: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent },
  nearOn: { backgroundColor: colors.accent },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, marginHorizontal: space.lg,
    paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.field, borderWidth: 1, borderColor: colors.fieldBorder,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text, paddingVertical: space.sm },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  note: { paddingHorizontal: space.lg, marginBottom: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.lg - space.xs, paddingBottom: space.xxl },
  gridCell: { width: '50%', padding: space.xs },
  gridTile: { height: 120, borderRadius: radius.lg },
  gridLabel: { position: 'absolute', left: space.md, right: space.md, bottom: space.md },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  distance: { marginTop: 4, marginLeft: space.sm },
});
