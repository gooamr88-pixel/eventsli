import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { categories, listEvents, notifications, trending } from '@/api/endpoints';
import type { EventCard } from '@/api/types';
import { useSession, useToken } from '@/auth/session';
import { useSaved } from '@/hooks/useSaved';
import { Empty, Failed, IconButton, Section } from '@/ui/bits';
import { Cover } from '@/ui/Cover';
import { EventPoster, EventRow, EventTile } from '@/ui/EventCard';
import { Icon } from '@/ui/Icon';
import { Container, Grid, useLayout } from '@/ui/layout';
import { Logo } from '@/ui/Logo';
import { CardSkeleton, Pressy, RowSkeleton, Skeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/**
 * Home (the mockup's third frame): the logo and the inbox bell, the city
 * being browsed, a search box that opens Explore, the Trending banner, the
 * categories, and what is on next in that city.
 *
 * Trending is the admin's VIP list (/public/vip-events) — or, when there is
 * none, the soonest events with a cover — as a carousel you swipe through.
 * Upcoming is /public/events filtered to the chosen city, sellers first: the
 * first few as poster cards to swipe, the rest as a list (a grid on a
 * tablet, where there is room to see them side by side).
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const token = useToken();
  const city = useSession((s) => s.city);
  const user = useSession((s) => s.account?.user);
  const { isSaved, flip } = useSaved();
  const { tablet, inner, columnWidth, gutter } = useLayout();

  const hot = useQuery({ queryKey: ['trending'], queryFn: trending });
  const cats = useQuery({ queryKey: ['categories'], queryFn: categories, staleTime: 3_600_000 });
  const upcoming = useQuery({
    queryKey: ['events', 'upcoming', city?.city ?? null],
    queryFn: () => listEvents({ city: city?.city, ticketedFirst: true, limit: 20 }, token).then((r) => r.data),
  });
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notifications(token as string, 1).then((r) => Number(r.meta?.unread ?? 0)),
    enabled: Boolean(token),
  });

  const leads: EventCard[] = (hot.data?.events ?? []).slice(0, 6);
  const leadIds = new Set(leads.map((e) => e.id));
  const rest = (upcoming.data ?? []).filter((e) => !leadIds.has(e.id));
  const carousel = tablet ? [] : rest.slice(0, 6);
  const list = tablet ? rest : rest.slice(6);
  const refreshing = hot.isRefetching || upcoming.isRefetching;
  const firstName = user?.fullName?.split(/\s+/)[0];

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: space.xxl }}
        refreshControl={<RefreshControl tintColor={colors.accent} refreshing={refreshing} onRefresh={() => { void hot.refetch(); void upcoming.refetch(); void cats.refetch(); }} />}
      >
        <Container style={{ gap: space.lg }}>
          <View style={styles.topRow}>
            <Logo height={28} />
            <View>
              <IconButton icon="bell" label={unread.data ? `Notifications, ${unread.data} unread` : 'Notifications'} variant="outline" onPress={() => router.push(token ? '/notifications' : '/sign-in')} />
              {unread.data ? <View style={styles.badge}><Text variant="caption" weight="bold" color={colors.white} style={styles.badgeText}>{unread.data > 9 ? '9+' : unread.data}</Text></View> : null}
            </View>
          </View>

          <View style={{ gap: 2 }}>
            {firstName ? <Text variant="small" color={colors.muted}>Hi {firstName}, what&apos;s on in</Text> : <Text variant="small" color={colors.muted}>Discover what&apos;s on in</Text>}
            <Pressable accessibilityRole="button" accessibilityLabel={`City: ${city?.city ?? 'Everywhere'}. Change city`} onPress={() => router.push('/city')} style={styles.city} hitSlop={6}>
              <Icon name="pin" size={20} color={colors.accent} />
              <Text variant="heading">{city?.city ?? 'Everywhere'}</Text>
              <Icon name="chevronDown" size={18} />
            </Pressable>
          </View>

          <Pressable accessibilityRole="search" accessibilityLabel="Search events" onPress={() => router.push({ pathname: '/(tabs)/explore', params: { focus: String(Date.now()) } })} style={styles.search}>
            <Icon name="search" size={20} color={colors.muted} />
            <Text variant="body" color={colors.placeholder} style={{ flex: 1 }}>Search events, artists, venues…</Text>
            <View style={styles.searchFilter}><Icon name="filter" size={18} color={colors.white} /></View>
          </Pressable>
        </Container>

        {/* Trending — a swipeable banner, full width of the content column. */}
        <View style={{ marginTop: space.xl }}>
          {hot.isLoading ? (
            <Container><Skeleton height={tablet ? 260 : 210} round={radius.xl} /></Container>
          ) : leads.length ? (
            <Trending events={leads} chosen={Boolean(hot.data?.chosen)} width={tablet ? columnWidth(2, space.lg) : inner} isSaved={isSaved} flip={flip} height={tablet ? 260 : 210} />
          ) : null}
        </View>

        {cats.data?.length ? (
          <Container style={{ marginTop: space.xl }}>
            <Section title="Explore Categories" action="See all" onAction={() => router.push('/(tabs)/explore')} />
          </Container>
        ) : null}
        {cats.data?.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.cats, { paddingHorizontal: gutter }]}>
            {cats.data.map((c, i) => (
              <Animated.View key={c.slug} entering={FadeInDown.delay(i * 40).duration(260)}>
                <Pressy accessibilityRole="button" accessibilityLabel={c.label} onPress={() => router.push({ pathname: '/(tabs)/explore', params: { category: c.slug } })} style={styles.catCell}>
                  <Cover uri={c.imageUrl} title={c.label} scrim style={styles.cat}>
                    <Text variant="small" weight="bold" color={colors.white} style={styles.catLabel} numberOfLines={2}>{c.label}</Text>
                  </Cover>
                </Pressy>
              </Animated.View>
            ))}
          </ScrollView>
        ) : null}

        <Container style={{ marginTop: space.xl }}>
          <Section title={city ? `Upcoming in ${city.city}` : 'Upcoming events'} action="See all" onAction={() => router.push('/(tabs)/explore')} />
        </Container>

        {upcoming.isLoading ? (
          <Container style={{ gap: space.md }}>
            {tablet ? <Grid min={240}>{[0, 1, 2].map((i) => <CardSkeleton key={i} />)}</Grid> : [0, 1, 2].map((i) => <RowSkeleton key={i} />)}
          </Container>
        ) : upcoming.isError ? (
          <Failed message={messageFor(upcoming.error)} onRetry={() => { void upcoming.refetch(); }} />
        ) : !rest.length && !leads.length ? (
          <Empty
            icon="calendar"
            title={city ? `Nothing on in ${city.city} yet` : 'Nothing on yet'}
            body="Try another city, or explore everything on Eventsli."
            action="Change city"
            onAction={() => router.push('/city')}
          />
        ) : (
          <>
            {carousel.length ? (
              <FlatList
                horizontal
                data={carousel}
                keyExtractor={(e) => e.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.posters, { paddingHorizontal: gutter }]}
                snapToInterval={232}
                decelerationRate="fast"
                renderItem={({ item }) => <EventPoster event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} width={220} />}
              />
            ) : null}
            {list.length ? (
              <Container style={{ gap: space.md, marginTop: carousel.length ? space.xl : 0 }}>
                {carousel.length ? <Section title="More to discover" style={{ marginBottom: 0 }} /> : null}
                {tablet ? (
                  <Grid min={240} gap={space.lg}>
                    {list.map((e) => <EventPoster key={e.id} event={e} saved={isSaved(e.id)} onHeart={() => flip(e.id)} />)}
                  </Grid>
                ) : list.map((e, i) => (
                  <Animated.View key={e.id} entering={FadeInDown.delay(Math.min(i, 6) * 50).duration(260)}>
                    <EventRow event={e} saved={isSaved(e.id)} onHeart={() => flip(e.id)} />
                  </Animated.View>
                ))}
              </Container>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** The banner carousel, with dots under it when there is more than one. */
function Trending({ events, chosen, width, height, isSaved, flip }: {
  events: EventCard[]; chosen: boolean; width: number; height: number;
  isSaved: (id: string) => boolean; flip: (id: string) => void;
}) {
  const { gutter } = useLayout();
  const [page, setPage] = useState(0);
  const step = width + space.lg;
  return (
    <View style={{ gap: space.md }}>
      <FlatList
        horizontal
        data={events}
        keyExtractor={(e) => e.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: gutter, gap: space.lg }}
        onMomentumScrollEnd={(ev) => setPage(Math.round(ev.nativeEvent.contentOffset.x / step))}
        renderItem={({ item }) => (
          <EventTile event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} height={height} badge={chosen ? 'Trending' : 'Coming up'} style={{ width }} />
        )}
      />
      {events.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {events.map((e, i) => <View key={e.id} style={[styles.dot, i === page && styles.dotOn]} />)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    position: 'absolute', top: -2, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontSize: 10, lineHeight: 12 },
  city: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 54,
    paddingLeft: space.lg, paddingRight: 6, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  searchFilter: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  cats: { gap: space.md, paddingHorizontal: space.lg },
  catCell: { borderRadius: radius.lg, overflow: 'hidden' },
  cat: { width: 104, height: 104, borderRadius: radius.lg },
  catLabel: { position: 'absolute', left: 10, right: 8, bottom: 10 },
  posters: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.accent, width: 20 },
});
