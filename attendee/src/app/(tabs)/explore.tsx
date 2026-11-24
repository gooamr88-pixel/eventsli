import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { categories, eventsNear, listEvents } from '@/api/endpoints';
import type { EventCard } from '@/api/types';
import { useSession, useToken } from '@/auth/session';
import { useSaved } from '@/hooks/useSaved';
import { approximatePosition } from '@/lib/location';
import { WHEN_OPTIONS, whenRange, type When } from '@/lib/when';
import { Chip, Empty, Failed, ScreenTitle } from '@/ui/bits';
import { Cover } from '@/ui/Cover';
import { EventPoster, EventRow } from '@/ui/EventCard';
import { Icon } from '@/ui/Icon';
import { Container, useLayout } from '@/ui/layout';
import { CardSkeleton, Pressy, RowSkeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, fonts, radius, space } from '@/ui/theme';

const PAGE = 20;

/**
 * Explore (the mockup's fourth frame): the chips across the top, the category
 * tiles when nothing is chosen, and the matching events once something is —
 * a category, a date, a search, or Near me.
 *
 * Search waits for a pause in typing (350 ms) so a word is one request, not
 * one per letter against a public endpoint. Results are a list on a phone
 * and a poster grid wherever there is room for two or more across.
 */
export default function Explore() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ category?: string; focus?: string }>();
  const token = useToken();
  const city = useSession((s) => s.city);
  const { isSaved, flip } = useSaved();
  const { columns, columnWidth, gutter, tablet } = useLayout();
  const input = useRef<TextInputInstance>(null);

  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [when, setWhen] = useState<When>('any');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [nearNote, setNearNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

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
  const browsing = Boolean(category || q || when !== 'any');

  const list = useInfiniteQuery({
    queryKey: ['events', 'explore', category, q, when, city?.city ?? null],
    enabled: browsing && !near,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => listEvents({
      category: category ?? undefined, q: q || undefined, city: city?.city, page: pageParam, limit: PAGE, ...whenRange(when),
    }, token),
    getNextPageParam: (last) => (last.pagination && last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
  });

  const nearby = useQuery({
    queryKey: ['events', 'near', near?.lat, near?.lng],
    enabled: Boolean(near),
    queryFn: () => eventsNear(near!.lat, near!.lng),
  });

  async function findNear() {
    if (near) { setNear(null); return; }
    setNearNote(null);
    setLocating(true);
    const pos = await approximatePosition();
    setLocating(false);
    if (pos === 'denied') setNearNote('Location is off for Eventsli. Turn it on in Settings, or choose a city on Home.');
    else if (!pos) setNearNote('We could not find where you are just now. Try again, or choose a city.');
    else { setCategory(null); setText(''); setWhen('any'); setNear(pos); }
  }

  const events: EventCard[] = useMemo(() => {
    if (near) return nearby.data?.events ?? [];
    return (list.data?.pages ?? []).flatMap((p) => p.data);
  }, [near, nearby.data, list.data]);
  const total = near ? events.length : list.data?.pages?.[0]?.pagination?.total ?? events.length;

  const chips = [{ slug: null as string | null, label: 'All' }, ...(cats.data ?? []).map((c) => ({ slug: c.slug, label: c.label }))];
  const active = near ? nearby : list;
  const n = tablet ? Math.max(2, columns(250, space.lg)) : 1;
  const cellW = columnWidth(n, space.lg);
  const tiles = Math.max(2, columns(160, space.md));

  const clearAll = () => { setCategory(null); setWhen('any'); setText(''); setNear(null); };

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.sm }]}>
      <Container>
        <ScreenTitle
          title="Explore"
          right={(
            <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(near), busy: locating }} accessibilityLabel="Events near me" onPress={() => { void findNear(); }} style={[styles.near, near && styles.nearOn]}>
              <Icon name="locate" size={18} color={near ? colors.onAccent : colors.accent} />
              <Text variant="small" weight="semibold" color={near ? colors.onAccent : colors.accent}>{locating ? 'Finding…' : 'Near me'}</Text>
            </Pressable>
          )}
        />
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
            maxFontSizeMultiplier={1.6}
          />
          {text ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setText('')} hitSlop={8} style={styles.clear}>
              <Icon name="close" size={16} color={colors.white} strokeWidth={2.4} />
            </Pressable>
          ) : null}
        </View>
      </Container>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { paddingHorizontal: gutter }]} style={styles.chipRow}>
        {chips.map((c) => (
          <Chip key={c.slug ?? 'all'} label={c.label} active={!near && category === c.slug} onPress={() => { setNear(null); setCategory(c.slug); }} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.whens, { paddingHorizontal: gutter }]} style={styles.chipRow}>
        <Icon name="calendar" size={16} color={colors.muted} />
        {WHEN_OPTIONS.map((w) => {
          const on = !near && when === w.value;
          return (
            <Pressable key={w.value} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { setNear(null); setWhen(w.value); }}
              style={[styles.when, on && styles.whenOn]} hitSlop={4}>
              <Text variant="caption" weight="semibold" color={on ? colors.onHighlight : colors.muted}>{w.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {nearNote ? <Container><Text variant="small" color={colors.warning} style={styles.note}>{nearNote}</Text></Container> : null}

      {!browsing && !near ? (
        <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
          <Container>
            <Text variant="title" style={styles.tilesTitle} accessibilityRole="header">Browse by category</Text>
            <View style={styles.tiles}>
              {cats.isLoading ? [0, 1, 2, 3].map((i) => <View key={i} style={{ width: columnWidth(tiles) }}><CardSkeleton height={120} /></View>)
                : (cats.data ?? []).map((c, i) => (
                  <Animated.View key={c.slug} entering={FadeInDown.delay(Math.min(i, 8) * 40).duration(260)} style={{ width: columnWidth(tiles) }}>
                    <Pressy accessibilityRole="button" accessibilityLabel={c.label} onPress={() => setCategory(c.slug)} style={styles.tileCell}>
                      <Cover uri={c.imageUrl} title={c.label} scrim style={styles.tile}>
                        <View style={styles.tileLabel}>
                          <Text variant="label" weight="bold" color={colors.white} numberOfLines={2}>{c.label}</Text>
                          {c.blurb ? <Text variant="caption" color={colors.onDarkMuted} numberOfLines={1}>{c.blurb}</Text> : null}
                        </View>
                      </Cover>
                    </Pressy>
                  </Animated.View>
                ))}
            </View>
          </Container>
        </ScrollView>
      ) : active.isLoading ? (
        <Container style={{ gap: space.md, paddingTop: space.md }}>
          {n > 1 ? <View style={styles.tiles}>{[0, 1, 2].map((i) => <View key={i} style={{ width: cellW }}><CardSkeleton /></View>)}</View>
            : [0, 1, 2, 3].map((i) => <RowSkeleton key={i} />)}
        </Container>
      ) : active.isError ? (
        <Failed message={messageFor(active.error)} onRetry={() => { void active.refetch(); }} />
      ) : (
        <FlatList
          key={`cols-${n}`}
          data={events}
          numColumns={n}
          keyExtractor={(e) => e.id}
          contentContainerStyle={[styles.list, { paddingHorizontal: gutter }]}
          columnWrapperStyle={n > 1 ? { gap: space.lg } : undefined}
          ItemSeparatorComponent={() => <View style={{ height: n > 1 ? space.lg : space.md }} />}
          ListHeaderComponent={events.length ? (
            <View style={styles.resultHead}>
              <Text variant="small" weight="semibold" color={colors.muted}>
                {near ? `${events.length} near you` : `${total} event${total === 1 ? '' : 's'}`}{city && !near ? ` in ${city.city}` : ''}
              </Text>
              <Pressable accessibilityRole="button" onPress={clearAll} hitSlop={8}>
                <Text variant="small" weight="semibold" color={colors.accent}>Clear filters</Text>
              </Pressable>
            </View>
          ) : undefined}
          renderItem={({ item }) => (n > 1 ? (
            <View style={{ width: cellW }}><EventPoster event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} /></View>
          ) : (
            <EventRow event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} distance={near && item.distanceKm !== undefined ? `${item.distanceKm} km` : undefined} />
          ))}
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (!near && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
          ListFooterComponent={list.isFetchingNextPage ? <View style={{ paddingTop: space.md }}><RowSkeleton /></View> : undefined}
          ListEmptyComponent={
            <Empty
              icon="search"
              title={near ? 'Nothing near you yet' : 'No events found'}
              body={near ? 'Nothing within reach right now. Try a city instead.' : city ? `Nothing matches in ${city.city}. Try another word, date or city.` : 'Try another word, date or category.'}
              action={near ? 'Choose a city' : 'Clear filters'}
              onAction={near ? () => router.push('/city') : clearAll}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  near: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface },
  nearOn: { backgroundColor: colors.accent },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, marginTop: space.sm,
    paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text, paddingVertical: space.sm },
  clear: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexGrow: 0 },
  chips: { gap: space.sm, paddingTop: space.md, paddingBottom: space.sm },
  whens: { gap: space.xs, alignItems: 'center', paddingBottom: space.sm },
  when: { paddingHorizontal: space.md, minHeight: 30, borderRadius: radius.pill, justifyContent: 'center' },
  whenOn: { backgroundColor: colors.highlight },
  note: { marginBottom: space.sm },
  tilesTitle: { marginTop: space.sm, marginBottom: space.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tileCell: { borderRadius: radius.lg, overflow: 'hidden' },
  tile: { height: 128, borderRadius: radius.lg },
  tileLabel: { position: 'absolute', left: space.md, right: space.md, bottom: space.md },
  list: { paddingBottom: space.xxl, paddingTop: space.xs, flexGrow: 1 },
  resultHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
});
