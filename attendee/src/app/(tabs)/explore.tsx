import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { categories, eventsNear, listEvents } from '@/api/endpoints';
import type { EventCard } from '@/api/types';
import { useSession, useToken } from '@/auth/session';
import { useCategoryCovers } from '@/hooks/useCategoryCovers';
import { useSaved } from '@/hooks/useSaved';
import { approximatePosition, distanceText, positionIfAllowed } from '@/lib/location';
import { Chip, Empty, Failed, IconButton, ScreenTitle } from '@/ui/bits';
import { CategoryTile } from '@/ui/CategoryTile';
import { EventPoster, EventRow } from '@/ui/EventCard';
import { Icon } from '@/ui/Icon';
import { Container, useLayout } from '@/ui/layout';
import { RowSkeleton, Skeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, fonts, space } from '@/ui/theme';

const PAGE = 20;

/**
 * Explore — the mockup's fourth frame: "Explore" with a search icon, the
 * chips (All, then the categories), and big photo tiles, two across. Choosing
 * a chip or a tile, searching, or Near me shows the matching events as rows.
 *
 * Search waits for a pause in typing (350 ms), so a word is one request.
 */
export default function Explore() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ category?: string; focus?: string; near?: string }>();
  const token = useToken();
  const city = useSession((s) => s.city);
  const { isSaved, flip } = useSaved();
  const { columns, columnWidth, gutter, tablet } = useLayout();
  const input = useRef<TextInputInstance>(null);

  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [searching, setSearching] = useState(Boolean(params.focus));
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [nearNote, setNearNote] = useState<string | null>(null);

  // Home opens this tab with ?category=, ?focus= or ?near=; followed when they CHANGE.
  const [seen, setSeen] = useState<{ category?: string; focus?: string; near?: string }>({ category: params.category, focus: params.focus });
  if (params.category !== seen.category || params.focus !== seen.focus || params.near !== seen.near) {
    setSeen({ category: params.category, focus: params.focus, near: params.near });
    if (params.category && params.category !== seen.category) { setCategory(params.category); setNear(null); }
    if (params.focus && params.focus !== seen.focus) setSearching(true);
  }
  // "See all" on Home's Near You: the nearby list straight away (location is
  // already allowed there, so this asks nothing).
  useEffect(() => {
    if (!params.near) return;
    void positionIfAllowed().then((p) => { if (p) { setCategory(null); setText(''); setNear(p); } });
  }, [params.near]);
  useEffect(() => { if (searching) setTimeout(() => input.current?.focus(), 50); }, [searching, params.focus]);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

  const cats = useQuery({ queryKey: ['categories'], queryFn: categories, staleTime: 3_600_000 });
  const covers = useCategoryCovers();
  const browsing = Boolean(category || q);

  const list = useInfiniteQuery({
    queryKey: ['events', 'explore', category, q, city?.city ?? null],
    enabled: browsing && !near,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => listEvents({ category: category ?? undefined, q: q || undefined, city: city?.city, page: pageParam, limit: PAGE }, token),
    getNextPageParam: (last) => (last.pagination && last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
  });
  const nearby = useQuery({ queryKey: ['events', 'near', near?.lat, near?.lng], enabled: Boolean(near), queryFn: () => eventsNear(near!.lat, near!.lng) });

  async function findNear() {
    if (near) { setNear(null); return; }
    setNearNote(null);
    const pos = await approximatePosition();
    if (pos === 'denied') setNearNote('Location is off for Eventsli. Turn it on in Settings, or choose a city on Home.');
    else if (!pos) setNearNote('We could not find where you are just now. Try again, or choose a city.');
    else { setCategory(null); setText(''); setNear(pos); }
  }

  const events: EventCard[] = useMemo(() => (near ? nearby.data?.events ?? [] : (list.data?.pages ?? []).flatMap((p) => p.data)), [near, nearby.data, list.data]);
  const active = near ? nearby : list;
  const n = tablet ? Math.max(2, columns(240, space.lg)) : 1;
  const cellW = columnWidth(n, space.lg);
  const tileCols = Math.max(2, columns(170, space.md));
  const tileW = columnWidth(tileCols, space.md);
  const clear = () => { setCategory(null); setText(''); setNear(null); };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Container>
        <ScreenTitle
          title="Explore"
          right={<IconButton icon={searching ? 'close' : 'search'} size={24} label={searching ? 'Close search' : 'Search'} onPress={() => { if (searching) { setText(''); setSearching(false); } else setSearching(true); }} />}
        />
        {searching ? (
          <Animated.View entering={FadeIn.duration(160)} style={styles.search}>
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
              maxFontSizeMultiplier={1.4}
            />
          </Animated.View>
        ) : null}
      </Container>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { paddingHorizontal: gutter }]} style={{ flexGrow: 0 }}>
        {/* As drawn: All, then the categories; Near me follows them. */}
        <Chip label="All" active={!near && !category} onPress={() => { setNear(null); setCategory(null); }} />
        {(cats.data ?? []).map((c) => (
          <Chip key={c.slug} label={c.label} active={!near && category === c.slug} onPress={() => { setNear(null); setCategory(c.slug); }} />
        ))}
        <Chip label="Near me" icon="locate" active={Boolean(near)} onPress={() => { void findNear(); }} />
      </ScrollView>
      {nearNote ? <Container><Text variant="small" color={colors.warning} style={{ marginBottom: space.sm }}>{nearNote}</Text></Container> : null}

      {!browsing && !near ? (
        <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }} showsVerticalScrollIndicator={false}>
          <Container style={styles.tiles}>
            {cats.isLoading ? [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} width={tileW} height={Math.round(tileW * 0.94)} round={16} />)
              : (cats.data ?? []).map((c, i) => (
                <CategoryTile key={c.slug} category={c} index={i} size="large" width={tileW} photo={covers.get(c.slug)} onPress={() => setCategory(c.slug)} />
              ))}
          </Container>
        </ScrollView>
      ) : active.isLoading ? (
        <Container>{[0, 1, 2, 3].map((i) => <RowSkeleton key={i} />)}</Container>
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
          ItemSeparatorComponent={n > 1 ? () => <View style={{ height: space.lg }} /> : undefined}
          renderItem={({ item }) => (n > 1 ? (
            <View style={{ width: cellW }}><EventPoster event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} /></View>
          ) : (
            <EventRow event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} distance={near ? distanceText(item.distanceKm) || undefined : undefined} />
          ))}
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (!near && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
          ListFooterComponent={list.isFetchingNextPage ? <RowSkeleton /> : undefined}
          ListEmptyComponent={
            <Empty
              icon="search"
              title={near ? 'Nothing near you yet' : 'No events found'}
              body={near ? 'Try choosing a city instead.' : city ? `Nothing matches in ${city.city}.` : 'Try another word or category.'}
              action={near ? 'Choose a city' : 'Show all'}
              onAction={near ? () => router.push('/city') : clear}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, marginBottom: space.xs, paddingHorizontal: space.lg, borderRadius: 12, backgroundColor: colors.bgSunken },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.text, paddingVertical: space.sm },
  chips: { gap: space.sm, paddingVertical: space.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingTop: space.xs },
  list: { paddingBottom: space.xxl, flexGrow: 1 },
});
